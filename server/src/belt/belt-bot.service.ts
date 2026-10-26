import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { BeltRealtimeService } from '../belt/belt-realtime.service';
import { AiConfigService } from '../ai/ai-config.service';
import type { AuthUser } from '../common/types/context';

interface BotMember {
  botUserId: string;
  botHandle: string;
  systemPrompt: string | null;
  model: string | null;
}

/**
 * 文明环带 Bot 驻场（功能大搬家）：外网频道/群聊里 @Bot 呼号即触发。
 * 与内网 AiChatService 解耦：直接读 bot_profiles + channel_members，
 * 用 AiConfigService.globalDefaults() 取全局 baseUrl/model/key，
 * 最近 10 条频道消息做上下文，非流式补全，写入 bot 消息并经 BeltRealtimeService 广播。
 */
@Injectable()
export class BeltBotService {
  private readonly logger = new Logger(BeltBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiConfig: AiConfigService,
    private readonly beltRealtime: BeltRealtimeService,
  ) {}

  /** 发送消息后异步调用；命中 @Bot 才执行，不阻塞主发送链路。 */
  async maybeReply(user: AuthUser, channelId: string, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed || !trimmed.includes('@')) return;

    const bots = await this.channelBots(channelId);
    if (bots.length === 0) return;

    const mentioned = bots.find((bot) =>
      trimmed.toLowerCase().includes(`@${bot.botHandle.toLowerCase()}`),
    );
    if (!mentioned) return;

    const defaults = await this.aiConfig.globalDefaults();
    if (!defaults.baseUrl) return;

    const history = await this.prisma.message.findMany({
      where: { channelId, deletedAt: null },
      orderBy: { id: 'desc' },
      take: 10,
      select: { body: true, senderId: true },
    });
    const lines = history
      .reverse()
      .filter((row) => typeof row.body === 'string' && row.body.trim().length > 0)
      .map((row) => row.body as string);

    const prompt = [
      mentioned.systemPrompt?.trim() || '你是文明环带的驻场助手，用简洁中文回答。',
      '--- 最近频道消息 ---',
      ...lines,
      '---',
      `请回应 @${mentioned.botHandle} 的这条消息（最多 200 字）：${trimmed}`,
    ].join('\n');

    let replyText: string;
    try {
      replyText = await this.complete(
        defaults.baseUrl,
        mentioned.model || defaults.model || 'gpt-4o-mini',
        defaults.apiKey ?? '',
        prompt,
      );
    } catch (error) {
      this.logger.warn(`环带 Bot 补全失败：${(error as Error).message}`);
      return;
    }

    await this.prisma.withTransaction(async (tx) => {
      await tx.message.create({
        data: {
          channelId,
          senderId: mentioned.botUserId,
          kind: 'text',
          body: replyText,
          clientMsgId: randomUUID(),
        },
      });
      await tx.channel.update({
        where: { id: channelId },
        data: { lastMessageAt: new Date() },
      });
    });

    this.beltRealtime.emitToBeltChannel(channelId, 'belt:message', {
      channelId,
      message: { body: replyText, senderId: mentioned.botUserId },
    });
  }

  private async channelBots(channelId: string): Promise<BotMember[]> {
    const members = await this.prisma.channelMember.findMany({
      where: { channelId, user: { isBot: true, status: 'active' } },
      select: {
        user: {
          select: {
            id: true,
            handle: true,
            botProfile: { select: { enabled: true, systemPrompt: true, model: true } },
          },
        },
      },
    });
    return members
      .filter((member) => member.user.botProfile?.enabled)
      .map((member) => ({
        botUserId: member.user.id,
        botHandle: member.user.handle,
        systemPrompt: member.user.botProfile?.systemPrompt ?? null,
        model: member.user.botProfile?.model ?? null,
      }));
  }

  private async complete(baseUrl: string, model: string, apiKey: string, prompt: string): Promise<string> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`上游 HTTP ${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() || '（空回复）';
  }
}
