import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { ChannelAccessService } from '../common/guards/channel-access.service';
import { toMessageView } from '../common/utils/message-view';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import { AiConfigService } from './ai-config.service';
import type { AiChatDto, AiReportDto } from './ai.dto';
import type { SummarizeDto, TranslateDto } from './bots.dto';
import { BotsService, type BotIdentity } from './bots.service';
import {
  BOT_MESSAGE_PREFIX,
  BOT_USER_ID,
  CHAT_CONTEXT_MESSAGES,
  PROTOCOL_OFFICER_PROMPT,
  REPORT_WINDOW_DAYS,
} from './bot.constants';

/** SSE 输出口（控制器写 HTTP 流；单测直接收集事件） */
export interface AiStreamSink {
  event(name: string, data: unknown): void;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ResolvedRuntime {
  botId: string;
  systemPrompt: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 上下文起点（null=不过滤） */
  clearedAt: Date | null;
}

/**
 * @Bot 的 SSE 业务流（与 HTTP 解耦，便于单测）：
 * - `streamChat`：最近 20 条频道消息作上下文 → OpenAI 兼容流式补全 → 落库 bot 消息；
 * - `streamReport`：过去 7 天频道统计 → 协议官叙事播报 → 落库 bot 消息；
 * - `streamSummarize`：最近 50 条消息总结；
 * - `streamTranslate`：翻译指定消息；
 * - 落库与 `channels.last_message_at` 同事务；成功后 `message:new` 广播 + `done` 事件。
 *
 * 多 Bot：`bots` 注入后按 bot_profiles 的 prompt/model/key（空回退全局）执行，
 * 上下文按 `ai_channel_contexts.cleared_at` 过滤，落库 senderId = 该 Bot user id。
 * 未注入 `bots` 时保持 Sprint3 的单 Bot 全局行为（兼容旧单测）。
 */
@Injectable()
export class AiChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
    private readonly realtime: RealtimeService,
    private readonly config: AiConfigService,
    private readonly bots?: BotsService,
  ) {}

  async streamChat(
    user: AuthUser,
    dto: AiChatDto,
    sink: AiStreamSink,
    signal: AbortSignal,
  ): Promise<void> {
    await this.channelAccess.assert(dto.channelId, user, 'read');
    const runtime = await this.resolveRuntime(user, dto.channelId, dto.botId, dto.body);

    const history = await this.prisma.message.findMany({
      where: {
        channelId: dto.channelId,
        deletedAt: null,
        ...(runtime.clearedAt ? { createdAt: { gte: runtime.clearedAt } } : {}),
      },
      orderBy: { id: 'desc' },
      take: CHAT_CONTEXT_MESSAGES,
      select: { senderId: true, body: true },
    });
    const messages: ChatMessage[] = [
      { role: 'system', content: runtime.systemPrompt },
      ...history
        .slice()
        .reverse()
        .filter((row) => typeof row.body === 'string' && row.body.trim().length > 0)
        .map<ChatMessage>((row) => ({
          role: row.senderId === runtime.botId ? 'assistant' : 'user',
          content: row.body as string,
        })),
      { role: 'user', content: dto.body },
    ];

    const fullText = await this.streamCompletion(runtime, messages, sink, signal);
    if (signal.aborted) return;
    if (fullText.trim().length === 0) {
      throw new AppError(ErrorCode.INTERNAL, 'AI 返回为空，请稍后重试');
    }

    const message = await this.persistBotMessage(dto.channelId, runtime.botId, fullText);
    sink.event('done', { messageId: message.id.toString(), seq: message.id.toString() });
  }

  async streamReport(
    user: AuthUser,
    dto: AiReportDto,
    sink: AiStreamSink,
    signal: AbortSignal,
  ): Promise<void> {
    const resolved = await this.channelAccess.assert(dto.channelId, user, 'read');
    const runtime = await this.resolveRuntime(user, dto.channelId, dto.botId);

    const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [messageCount, activeUsers, taskCards] = await Promise.all([
      this.prisma.message.count({
        where: { channelId: dto.channelId, deletedAt: null, createdAt: { gte: since } },
      }),
      this.prisma.message.groupBy({
        by: ['senderId'],
        where: { channelId: dto.channelId, deletedAt: null, createdAt: { gte: since } },
      }),
      this.prisma.card.findMany({
        where: { channelId: dto.channelId, kind: 'task', deletedAt: null },
        select: { taskStatus: true },
      }),
    ]);

    const taskTotal = taskCards.length;
    const taskDone = taskCards.filter((card) => card.taskStatus === 'done').length;
    const doneRate = taskTotal === 0 ? 0 : Math.round((taskDone / taskTotal) * 100);
    const prompt = [
      `请生成本频道近 ${REPORT_WINDOW_DAYS} 天的巡检播报。`,
      `频道：#${resolved.channel.name}`,
      `消息数：${messageCount}`,
      `活跃用户数：${activeUsers.length}`,
      `任务总数：${taskTotal}，已完成：${taskDone}，完成率：${doneRate}%`,
      '请以「终末地工业高级协议官」的口吻，按「态势 / 风险 / 行动建议」三段输出，不超过 300 字。',
    ].join('\n');

    const fullText = await this.streamCompletion(
      runtime,
      [
        { role: 'system', content: runtime.systemPrompt },
        { role: 'user', content: prompt },
      ],
      sink,
      signal,
    );
    if (signal.aborted) return;
    if (fullText.trim().length === 0) {
      throw new AppError(ErrorCode.INTERNAL, 'AI 返回为空，请稍后重试');
    }

    const message = await this.persistBotMessage(dto.channelId, runtime.botId, fullText);
    sink.event('done', { messageId: message.id.toString(), seq: message.id.toString() });
  }

  /** 近 50 条消息总结（可跨 cleared_at，按最近 50 条） */
  async streamSummarize(
    user: AuthUser,
    dto: SummarizeDto,
    sink: AiStreamSink,
    signal: AbortSignal,
  ): Promise<void> {
    this.requireBots();
    await this.channelAccess.assert(dto.channelId, user, 'read');
    const runtime = await this.resolveRuntime(user, dto.channelId, dto.botId);

    const rows = await this.prisma.message.findMany({
      where: { channelId: dto.channelId, deletedAt: null },
      orderBy: { id: 'desc' },
      take: 50,
      select: { senderId: true, body: true },
    });
    const lines = rows
      .slice()
      .reverse()
      .filter((row) => typeof row.body === 'string' && row.body.trim().length > 0)
      .map((row) => row.body as string);
    if (lines.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, '频道消息为空，无法总结');

    const prompt = [
      '请总结以下频道消息，按「要点 / 决议 / 待办」三段输出，不超过 250 字。',
      '---',
      ...lines,
    ].join('\n');
    const fullText = await this.streamCompletion(
      runtime,
      [
        { role: 'system', content: runtime.systemPrompt },
        { role: 'user', content: prompt },
      ],
      sink,
      signal,
    );
    if (signal.aborted) return;
    if (fullText.trim().length === 0) throw new AppError(ErrorCode.INTERNAL, 'AI 返回为空，请稍后重试');

    const message = await this.persistBotMessage(dto.channelId, runtime.botId, fullText);
    sink.event('done', { messageId: message.id.toString(), seq: message.id.toString() });
  }

  /** 翻译指定消息；非本频道/已删 → VALIDATION_FAILED */
  async streamTranslate(
    user: AuthUser,
    dto: TranslateDto,
    sink: AiStreamSink,
    signal: AbortSignal,
  ): Promise<void> {
    this.requireBots();
    await this.channelAccess.assert(dto.channelId, user, 'read');
    const runtime = await this.resolveRuntime(user, dto.channelId, dto.botId);

    const message = await this.prisma.message.findUnique({
      where: { id: BigInt(dto.messageId) },
      select: { id: true, channelId: true, body: true, deletedAt: true },
    });
    if (!message || message.channelId !== dto.channelId || message.deletedAt || !message.body) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在、已删除或不属于该频道', {
        messageId: dto.messageId,
      });
    }

    const prompt = `请把下面这条消息翻译成中文（若原文已是中文则翻译成英文），只输出译文：\n${message.body}`;
    const fullText = await this.streamCompletion(
      runtime,
      [
        { role: 'system', content: runtime.systemPrompt },
        { role: 'user', content: prompt },
      ],
      sink,
      signal,
    );
    if (signal.aborted) return;
    if (fullText.trim().length === 0) throw new AppError(ErrorCode.INTERNAL, 'AI 返回为空，请稍后重试');

    const saved = await this.persistBotMessage(dto.channelId, runtime.botId, fullText);
    sink.event('done', { messageId: saved.id.toString(), seq: saved.id.toString() });
  }

  /** 解析运行时配置：多 Bot 模式走 bot_profiles（缺省回退全局），否则保持单 Bot 全局 */
  private async resolveRuntime(
    user: AuthUser,
    channelId: string,
    botId?: string,
    body?: string,
  ): Promise<ResolvedRuntime> {
    if (!this.bots) {
      const settings = await this.config.runtimeSettings();
      return {
        botId: BOT_USER_ID,
        systemPrompt: PROTOCOL_OFFICER_PROMPT,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        clearedAt: null,
      };
    }

    const bot: BotIdentity = await this.bots.resolveBot(channelId, botId, body);
    const settings = await this.bots.effectiveSettings(bot);
    const context = await this.prisma.aiChannelContext.findUnique({
      where: { channelId_botId: { channelId, botId: bot.id } },
      select: { clearedAt: true },
    });
    return {
      botId: bot.id,
      systemPrompt: bot.systemPrompt.trim().length > 0 ? bot.systemPrompt : PROTOCOL_OFFICER_PROMPT,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
      clearedAt: context?.clearedAt ?? null,
    };
  }

  private requireBots(): void {
    if (!this.bots) {
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, '该能力需要多 Bot 模式');
    }
  }

  /** OpenAI 兼容 `chat/completions` 流式调用：逐块回 `delta`，返回完整文本 */
  private async streamCompletion(
    runtime: ResolvedRuntime,
    messages: ChatMessage[],
    sink: AiStreamSink,
    signal: AbortSignal,
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${runtime.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${runtime.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: runtime.model, messages, stream: true }),
        signal,
      });
    } catch (error) {
      if (signal.aborted || (error as Error).name === 'AbortError') return '';
      throw new AppError(ErrorCode.INTERNAL, '无法连接 AI 服务，请稍后重试');
    }
    if (!response.ok || !response.body) {
      throw new AppError(ErrorCode.INTERNAL, `AI 服务返回 HTTP ${response.status}`, {
        status: response.status,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (raw.length === 0 || raw === '[DONE]') continue;
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              continue;
            }
            const delta = extractDelta(parsed);
            if (delta.length > 0) {
              fullText += delta;
              // delta 为主字段；text 为兼容别名（前端任一取值都可）
              sink.event('delta', { delta, text: delta });
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return fullText;
  }

  /** 落库 bot 消息 + 同事务更新 channels.last_message_at；提交后广播 message:new */
  private async persistBotMessage(channelId: string, senderId: string, text: string) {
    const body = `${BOT_MESSAGE_PREFIX} ${text.trim()}`;
    const clientMsgId = randomUUID();
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { channelId, senderId, kind: 'text', body, clientMsgId },
      });
      await tx.channel.update({
        where: { id: channelId },
        data: { lastMessageAt: created.createdAt },
      });
      return created;
    });
    this.realtime.emitToChannel(channelId, 'message:new', { message: toMessageView(message) });
    return message;
  }
}

/** 从 OpenAI chunk 里取 delta.content（兼容 content 为字符串/数组两种形态） */
function extractDelta(payload: unknown): string {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const delta = (choices[0] as { delta?: { content?: unknown } })?.delta;
  const content = delta?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        typeof item === 'object' && item !== null && 'text' in item
          ? String((item as { text: unknown }).text)
          : '',
      )
      .join('');
  }
  return '';
}
