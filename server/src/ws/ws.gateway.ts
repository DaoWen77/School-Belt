import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppConfig } from '../config/config.module';
import { AppError, isAppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ChannelAccessService } from '../common/guards/channel-access.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReadReceiptService } from '../common/realtime/read-receipt.service';
import { RealtimeService, rooms } from '../common/realtime/realtime.service';
import { RedisService } from '../common/redis/redis.service';
import { extractSocketToken } from '../common/utils/http';
import type { AuthUser } from '../common/types/context';
import { ChannelsService } from '../channels/channels.service';
import { MessagesService } from '../messages/messages.service';
import { wsSendMessageSchema, type SendMessageDto } from '../messages/messages.dto';
import { PresenceService } from '../presence/presence.service';
import { WsAuthService } from './ws-auth.service';
import { installRtcNamespace } from './rtc-namespace';
import {
  WsClientEvent,
  WsServerEvent,
  channelJoinSchema,
  channelLeaveSchema,
  messageReadSchema,
  threadSchema,
  typingSchema,
  type WsAck,
} from './ws.events';

/**
 * 全域广播 WS 网关（契约 §6，namespace `/ws`）。
 *
 * 连接：握手中间件校验 access token → 失败 connect_error(AUTH_INVALID)
 * 投递：channel:<id> / thread:<id> / user:<id> 三类房间
 * 多实例：afterInit 挂 @socket.io/redis-adapter，REST 侧 emit 也会跨进程 fan-out
 * ack：所有客户端事件都返回 ack；服务端持久化成功后才 ack（契约 §6）
 */
@Injectable()
@WebSocketGateway({
  namespace: '/ws',
  transports: ['websocket'],
  // CORS 白名单由 ConfiguredIoAdapter 在 createIOServer 时按 config.http.corsOrigins 注入
})
export class WsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WsGateway.name);
  /** 底层 Socket.IO Server（afterInit 的入参是 /ws 命名空间） */
  private rootServer: Server | null = null;

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
    private readonly readReceipts: ReadReceiptService,
    private readonly presence: PresenceService,
    private readonly channels: ChannelsService,
    private readonly messages: MessagesService,
  ) {}

  private get rtcEnabled(): boolean {
    return this.config.rtc.enabled;
  }

  /** Socket.IO 服务端就绪：记录底层 Server + 注册握手中间件（Redis adapter 在 bootstrap 阶段挂载） */
  afterInit(server: Server): void {
    this.realtime.attach(server);
    // 注意：afterInit 拿到的是**命名空间**（/ws），adapter 必须设在底层 Server 上
    this.rootServer = (server as unknown as { server?: Server }).server ?? server;

    server.use(async (socket, next) => {
      try {
        const token = extractSocketToken(socket.handshake.auth);
        const user = await this.wsAuth.authenticate(token);
        socket.data.user = user;
        next();
      } catch (error) {
        const code = isAppError(error) ? error.code : ErrorCode.AUTH_INVALID;
        this.logger.warn(`WS 握手失败: ${code}`);
        const failure = new Error(code) as Error & { data?: Record<string, unknown> };
        failure.data = { code };
        next(failure);
      }
    });

    installRtcNamespace(server, this.rtcEnabled, this.logger, this.wsAuth);
  }

  /**
   * Redis adapter 必须在所有 provider 的 onModuleInit（Redis PING）之后挂载，
   * 因此放在 onApplicationBootstrap（仍在 listen 之前，不会漏连接）。
   */
  onApplicationBootstrap(): void {
    const root = this.rootServer;
    if (!root) {
      this.logger.warn('Socket.IO Server 尚未就绪，跳过 Redis adapter 挂载');
      return;
    }
    const pair = this.redis.adapterPair();
    root.adapter(createAdapter(pair.pubClient, pair.subClient));
    this.logger.log('Socket.IO Redis adapter 已启用（多实例广播）');
  }

  /** 连接建立：加入 user 房间、刷新 presence、下发 ready 快照 */
  async handleConnection(socket: Socket): Promise<void> {
    const user = socket.data.user as AuthUser | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    await socket.join(rooms.user(user.id));
    this.registerHandlers(socket, user);

    try {
      await this.presence.markOnline(user.id);
      const { channels } = await this.channels.list(user);
      socket.emit(WsServerEvent.READY, {
        user: {
          id: user.id,
          handle: user.handle,
          displayName: user.displayName,
          globalRole: user.globalRole,
          avatarFileId: user.avatarFileId,
          statusPrefix: user.statusPrefix,
        },
        serverTime: new Date().toISOString(),
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          lastReadSeq: channel.lastReadSeq,
          unread: channel.unread,
          myRole: channel.myRole,
          visibility: channel.visibility,
        })),
      });
    } catch (error) {
      this.logger.error(`下发 ready 失败: ${(error as Error).message}`);
    }
  }

  /** 断开：该用户已无其他连接时广播 offline */
  async handleDisconnect(socket: Socket): Promise<void> {
    const user = socket.data.user as AuthUser | undefined;
    if (!user) return;
    try {
      const remaining = await socket.nsp.in(rooms.user(user.id)).fetchSockets();
      if (remaining.filter((item) => item.id !== socket.id).length === 0) {
        await this.presence.markOffline(user.id);
      }
    } catch (error) {
      this.logger.warn(`断开清理失败: ${(error as Error).message}`);
    }
  }

  // ── 事件注册 ─────────────────────────────────────────────────────────

  private registerHandlers(socket: Socket, user: AuthUser): void {
    socket.on(WsClientEvent.CHANNEL_JOIN, (payload: unknown, ack?: WsAck) => {
      this.run(ack, async () => {
        const data = this.parse(channelJoinSchema, payload);
        await this.channelAccess.assert(data.channelId, user, 'read');
        await socket.join(rooms.channel(data.channelId));
        return { ok: true, channelId: data.channelId };
      });
    });

    socket.on(WsClientEvent.CHANNEL_LEAVE, (payload: unknown, ack?: WsAck) => {
      this.run(ack, async () => {
        const data = this.parse(channelLeaveSchema, payload);
        await socket.leave(rooms.channel(data.channelId));
        return { ok: true };
      });
    });

    socket.on(WsClientEvent.MESSAGE_SEND, (payload: unknown, ack?: WsAck) => {
      this.run(ack, async () => {
        const parsed = this.parse(wsSendMessageSchema, payload);
        const { channelId, ...rest } = parsed;
        const result = await this.messages.send(user, channelId, rest as SendMessageDto);
        return {
          ok: true,
          message: result.message,
          dup: result.dup,
          ...(result.dup ? { code: ErrorCode.DUPLICATE_MESSAGE } : {}),
        };
      });
    });

    socket.on(WsClientEvent.MESSAGE_READ, (payload: unknown, ack?: WsAck) => {
      this.run(ack, async () => {
        const data = this.parse(messageReadSchema, payload);
        const resolved = await this.channelAccess.assert(data.channelId, user, 'read');
        if (!resolved.member) {
          throw new AppError(ErrorCode.NOT_CHANNEL_MEMBER, '非频道成员，无法上报已读');
        }
        this.readReceipts.submit(user.id, data.channelId, data.seq);
        return { ok: true };
      });
    });

    socket.on(WsClientEvent.TYPING, (payload: unknown, ack?: WsAck) => {
      this.run(ack, async () => {
        const data = this.parse(typingSchema, payload);
        await this.channelAccess.assert(data.channelId, user, 'read');
        await this.redis.setTyping(data.channelId, user.id, data.state === 'start');
        // 契约 §6 未定义 typing 的服务端事件，v1.0 仅记录状态，不广播
        return { ok: true };
      });
    });

    socket.on(WsClientEvent.THREAD_JOIN, (payload: unknown, ack?: WsAck) => {
      this.run(ack, async () => {
        const { rootId } = this.parse(threadSchema, payload);
        const root = await this.prisma.message.findUnique({
          where: { id: rootId },
          select: { channelId: true },
        });
        if (!root) throw new AppError(ErrorCode.VALIDATION_FAILED, '线程根不存在');
        await this.channelAccess.assert(root.channelId, user, 'read');
        await socket.join(rooms.thread(rootId));
        return { ok: true };
      });
    });

    socket.on(WsClientEvent.THREAD_LEAVE, (payload: unknown, ack?: WsAck) => {
      this.run(ack, async () => {
        const { rootId } = this.parse(threadSchema, payload);
        await socket.leave(rooms.thread(rootId));
        return { ok: true };
      });
    });

    socket.on(WsClientEvent.PRESENCE_PING, (_payload: unknown, ack?: WsAck) => {
      this.run(ack, async () => {
        const at = await this.presence.touch(user.id);
        return { ok: true, serverTime: at };
      });
    });

    socket.on(WsClientEvent.RTC_SIGNAL, (_payload: unknown, ack?: WsAck) => {
      this.run(ack, async () => ({
        ok: false,
        code: ErrorCode.NOT_IMPLEMENTED,
        message: '音视频信令为预留能力（契约 §11）',
      }));
    });
  }

  /** 统一 ack：成功回写 response，失败翻译成 { ok:false, code, message } */
  private run(ack: WsAck | undefined, handler: () => Promise<Record<string, unknown>>): void {
    const reply: WsAck = typeof ack === 'function' ? ack : () => undefined;
    handler()
      .then((response) => reply(response))
      .catch((error: unknown) => {
        if (isAppError(error)) {
          reply({ ok: false, code: error.code, message: error.message, ...error.details });
          return;
        }
        this.logger.error(`WS 事件处理失败: ${(error as Error).message}`, (error as Error).stack);
        reply({ ok: false, code: ErrorCode.INTERNAL, message: '服务内部错误' });
      });
  }

  private parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, payload: unknown): T {
    const result = schema.safeParse(payload ?? {});
    if (!result.success) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '字段校验未通过', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
