import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * 环塔 WS 的独立广播出口。
 * 不能复用内部 RealtimeService：它 attach 的是 /ws 命名空间，环塔走 /ws/belt。
 */
@Injectable()
export class BeltRealtimeService {
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  get attached(): boolean {
    return this.server !== null;
  }

  emitToBeltChannel(channelId: string, event: string, payload: unknown): void {
    this.server?.to(`belt:channel:${channelId}`).emit(event, payload);
  }

  emitToBeltUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`belt:user:${userId}`).emit(event, payload);
  }

  emitConversation(userIds: readonly string[], conversation: unknown): void {
    for (const userId of new Set(userIds)) {
      this.emitToBeltUser(userId, 'belt:conversation', { conversation });
    }
  }
}
