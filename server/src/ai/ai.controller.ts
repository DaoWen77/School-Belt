import { Controller, Get, HttpCode, Post, Put, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AiConfigService } from './ai-config.service';
import { AiChatService, type AiStreamSink } from './ai-chat.service';
import { BotsService } from './bots.service';
import { aiChatSchema, aiConfigSchema, aiReportSchema, type AiChatDto, type AiConfigDto, type AiReportDto } from './ai.dto';
import { clearContextSchema, summarizeSchema, translateSchema, type ClearContextDto, type SummarizeDto, type TranslateDto } from './bots.dto';
import { CurrentUser, RawResponse, Roles } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import { ErrorCode } from '../common/errors/error-codes';
import { isAppError } from '../common/errors/app-error';
import type { AuthUser } from '../common/types/context';

/**
 * AI 能力（Sprint3）：
 * - 配置管理：仅 owner/admin（RolesGuard + 服务层兜底）；
 * - `chat` / `report`：登录即可，但必须是目标频道成员；响应为 SSE（event: delta / done / error）。
 */
@Controller('ai')
export class AiController {
  constructor(
    private readonly config: AiConfigService,
    private readonly aiChat: AiChatService,
    private readonly bots: BotsService,
  ) {}

  /** 配置只读视图：绝不含明文 key，只返回末 4 位掩码 */
  @Get('config')
  @Roles('owner', 'admin')
  async getConfig(@CurrentUser() user: AuthUser) {
    return this.config.adminGet(user);
  }

  /** 保存配置：apiKey 省略 = 保留旧值；baseUrl 必须 http(s) */
  @Put('config')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async putConfig(@CurrentUser() user: AuthUser, @ZBody(aiConfigSchema) dto: AiConfigDto) {
    return this.config.adminPut(user, dto);
  }

  /** 连通性测试：调 `${baseUrl}/models`（8s 超时），返回 ok/latency/status，不含 key */
  @Post('test')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async test(@CurrentUser() user: AuthUser) {
    return this.config.adminTest(user);
  }

  /** @Bot 对话（SSE）：最近 20 条上下文 → 流式 delta → 落库 bot 消息 → done */
  @Post('chat')
  @RawResponse()
  async chat(
    @CurrentUser() user: AuthUser,
    @ZBody(aiChatSchema) dto: AiChatDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.withSse(reply, (sink, signal) => this.aiChat.streamChat(user, dto, sink, signal));
  }

  /** 频道巡检播报（SSE）：近 7 天统计 → 协议官叙事 → 落库 bot 消息 → done */
  @Post('report')
  @RawResponse()
  async report(
    @CurrentUser() user: AuthUser,
    @ZBody(aiReportSchema) dto: AiReportDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.withSse(reply, (sink, signal) => this.aiChat.streamReport(user, dto, sink, signal));
  }

  /** 清空与指定 Bot 的上下文（只写 ai_channel_contexts.cleared_at，不删聊天记录） */
  @Post('clear')
  @HttpCode(200)
  async clear(@CurrentUser() user: AuthUser, @ZBody(clearContextSchema) dto: ClearContextDto) {
    return this.bots.clearContext(user, dto.channelId, dto.botId);
  }

  /** 最近 50 条消息总结（SSE） */
  @Post('summarize')
  @RawResponse()
  async summarize(
    @CurrentUser() user: AuthUser,
    @ZBody(summarizeSchema) dto: SummarizeDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.withSse(reply, (sink, signal) => this.aiChat.streamSummarize(user, dto, sink, signal));
  }

  /** 翻译指定消息（SSE） */
  @Post('translate')
  @RawResponse()
  async translate(
    @CurrentUser() user: AuthUser,
    @ZBody(translateSchema) dto: TranslateDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.withSse(reply, (sink, signal) => this.aiChat.streamTranslate(user, dto, sink, signal));
  }

  /** SSE 基础设施：劫持 Fastify 响应，事件写原始流；客户端断开 → abort 上游 */
  private async withSse(
    reply: FastifyReply,
    run: (sink: AiStreamSink, signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.flushHeaders?.();

    const controller = new AbortController();
    const onClose = (): void => controller.abort();
    reply.raw.on('close', onClose);

    const sink: AiStreamSink = {
      event: (name, data) => {
        if (reply.raw.writableEnded) return;
        reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      },
    };

    try {
      await run(sink, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        sink.event('error', {
          code: isAppError(error) ? error.code : ErrorCode.INTERNAL,
          message: error instanceof Error ? error.message : 'AI 流式响应失败',
        });
      }
    } finally {
      reply.raw.off('close', onClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  }
}
