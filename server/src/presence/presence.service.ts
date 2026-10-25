import { Injectable } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { PrismaService } from '../common/prisma/prisma.service';

export interface PresenceEntry {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
}

/**
 * 在线状态（契约 §6 presence:update / §7 GET /presence）：
 * Redis TTL 键（默认 90s）+ WS 心跳刷新；断开时清除并广播 offline。
 * 未启用 Redis 时降级为进程内存，单实例语义一致。
 */
@Injectable()
export class PresenceService {
  constructor(
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  /** presence:ping / WS 连接建立时刷新 */
  async touch(userId: string): Promise<string> {
    const at = new Date();
    await this.redis.touchPresence(userId, at);
    return at.toISOString();
  }

  async markOnline(userId: string): Promise<void> {
    const at = await this.touch(userId);
    this.realtime.broadcast('presence:update', {
      userId,
      status: 'online',
      lastSeenAt: at,
    });
  }

  async markOffline(userId: string): Promise<void> {
    await this.redis.clearPresence(userId);
    const at = new Date().toISOString();
    await this.prisma.user
      .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    this.realtime.broadcast('presence:update', {
      userId,
      status: 'offline',
      lastSeenAt: at,
    });
  }

  async isOnline(userId: string): Promise<boolean> {
    return this.redis.isOnline(userId);
  }

  /** GET /presence：批量查在线，未指定 ids 时返回最近活跃的 200 个用户 */
  async list(ids: readonly string[]): Promise<{ presence: PresenceEntry[] }> {
    const userIds =
      ids.length > 0
        ? ids
        : (
            await this.prisma.user.findMany({
              where: { status: 'active' },
              orderBy: { lastSeenAt: 'desc' },
              take: 200,
              select: { id: true },
            })
          ).map((user) => user.id);

    const online = await this.redis.onlineAmong(userIds);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, lastSeenAt: true },
    });
    const lastSeen = new Map(users.map((user) => [user.id, user.lastSeenAt]));

    return {
      presence: userIds.map((userId) => ({
        userId,
        online: online[userId] ?? false,
        lastSeenAt: lastSeen.get(userId)?.toISOString() ?? null,
      })),
    };
  }
}
