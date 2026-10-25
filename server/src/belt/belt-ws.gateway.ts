import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { isAppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../common/prisma/prisma.service';
import { extractSocketToken } from '../common/utils/http';
import type { AuthUser } from '../common/types/context';
import { BeltRealtimeService } from './belt-realtime.service';
import { BeltWsAuthService } from './belt-ws-auth.service';

/**
 * 文明环带 WS（/ws/belt）。
 * 只负责实时投递；发消息走 REST，保证限流、校验、持久化只有一条路径。
 */
@Injectable()
@WebSocketGateway({
  namespace: '/ws/belt',
  transports: ['websocket'],
})
export class BeltWsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(BeltWsGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly auth: BeltWsAuthService,
    private readonly realtime: BeltRealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
    server.use(async (socket, next) => {
      try {
        const token = extractSocketToken(socket.handshake.auth);
        const user = await this.auth.authenticate(token);
        socket.data.user = user;
        next();
      } catch (error) {
        const code = isAppError(error) ? error.code : ErrorCode.AUTH_INVALID;
        this.logger.warn(`环带 WS 握手失败: ${code}`);
        const failure = new Error(code) as Error & { data?: Record<string, unknown> };
        failure.data = { code };
        next(failure);
      }
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const user = socket.data.user as AuthUser | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    await socket.join(`belt:user:${user.id}`);
    const channels = await this.prisma.channel.findMany({
      where: {
        surface: 'belt',
        kind: 'channel',
        archivedAt: null,
        OR: [
          { organizationId: null },
          { members: { some: { userId: user.id } } },
        ],
      },
      select: { id: true },
    });
    for (const channel of channels) {
      await socket.join(`belt:channel:${channel.id}`);
    }
    socket.emit('belt:ready', {
      user: {
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        isInternal: user.isInternal,
      },
      channels: channels.map((channel) => channel.id),
      serverTime: new Date().toISOString(),
    });
  }
}
