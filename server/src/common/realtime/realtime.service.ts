import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/** 房间命名（契约 §6 的投递边界） */
export const rooms = {
  channel: (channelId: string) => `channel:${channelId}`,
  thread: (rootId: string | bigint) => `thread:${rootId.toString()}`,
  user: (userId: string) => `user:${userId}`,
} as const;

/**
 * 广播出口：REST 与 WS 共用。
 * 单实例直接投递；多实例由 @socket.io/redis-adapter 自动跨进程 fan-out（见 ws.gateway afterInit）。
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  get attached(): boolean {
    return this.server !== null;
  }

  emitToChannel(channelId: string, event: string, payload: unknown): void {
    this.server?.to(rooms.channel(channelId)).emit(event, payload);
  }

  emitToThread(rootId: string | bigint, event: string, payload: unknown): void {
    this.server?.to(rooms.thread(rootId)).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(rooms.user(userId)).emit(event, payload);
  }

  emitToRoom(room: string, event: string, payload: unknown): void {
    this.server?.to(room).emit(event, payload);
  }

  broadcast(event: string, payload: unknown): void {
    this.server?.emit(event, payload);
  }

  /** 在线连接数（/metrics 与运维排障用） */
  get connectionCount(): number {
    return this.server?.engine.clientsCount ?? 0;
  }

  /**
   * 该用户是否有活跃 WS 连接（推送决策用）。
   * 多实例时 fetchSockets 经 redis adapter 聚合所有实例的连接。
   */
  async hasUserConnection(userId: string): Promise<boolean> {
    if (!this.server) return false;
    try {
      const sockets = await this.server.in(rooms.user(userId)).fetchSockets();
      return sockets.length > 0;
    } catch {
      return false;
    }
  }
}
