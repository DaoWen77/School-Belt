import { Global, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../../config/config.module';

/**
 * Redis 访问层（**无内存降级**）。
 *
 * 职责：presence（TTL）、typing（TTL）、限流窗口、Socket.IO Redis adapter 的 pub/sub 客户端。
 * - `REDIS_URL` 必填（env 校验阶段就拒绝空值）；
 * - 启动时建立 cmd/pub/sub 三条连接并 PING，任一失败直接抛错，进程不启动（fail fast）；
 * - 运行期命令失败按错误上抛，由调用方决定语义；`/readyz` 用真实 PING 判定。
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private pubClient!: Redis;
  private subClient!: Redis;

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.redis.url;
    try {
      this.client = await this.connect('client', url);
      this.pubClient = await this.connect('pub', url);
      this.subClient = await this.connect('sub', url);
      this.logger.log(`Redis 已连接：${this.sanitize(url)}（cmd/pub/sub 三连接，PING 通过）`);
    } catch (error) {
      await this.disconnectAll();
      const message = error instanceof Error ? error.message : String(error);
      // 明确失败：不降级、不吞错
      throw new Error(
        `Redis 连接失败（REDIS_URL=${this.sanitize(url)}）：${message}。请先启动 Redis（本机 Memurai 服务）并检查 REDIS_URL`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnectAll();
  }

  /** 连接失败/超时都在 ~3s 内暴露，不做无限重试 */
  private async connect(name: string, url: string): Promise<Redis> {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
      retryStrategy: () => null,
      connectionName: `dijiang-${name}`,
    });
    client.on('error', (error: Error) => {
      this.logger.warn(`Redis[${name}] 错误: ${error.message}`);
    });
    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') {
      throw new Error(`Redis[${name}] PING 返回 ${pong}`);
    }
    return client;
  }

  private async disconnectAll(): Promise<void> {
    const clients = [this.client, this.pubClient, this.subClient].filter(
      (client): client is Redis => client instanceof Redis,
    );
    this.client = undefined as unknown as Redis;
    this.pubClient = undefined as unknown as Redis;
    this.subClient = undefined as unknown as Redis;
    await Promise.all(
      clients.map(async (client) => {
        try {
          await client.quit();
        } catch {
          client.disconnect();
        }
      }),
    );
  }

  /** 隐藏连接串里的密码，避免写进日志 */
  private sanitize(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) parsed.password = '***';
      return parsed.toString();
    } catch {
      return '<invalid-url>';
    }
  }

  /** Socket.IO Redis adapter 所需的 pub/sub 双客户端 */
  adapterPair(): { pubClient: Redis; subClient: Redis } {
    return { pubClient: this.pubClient, subClient: this.subClient };
  }

  /** 裸客户端：限流 / 计数等通用用途 */
  getClient(): Redis {
    return this.client;
  }

  private key(key: string): string {
    return `${this.config.redis.keyPrefix}${key}`;
  }

  async setWithTtl(key: string, value: string, ttlMs: number): Promise<void> {
    await this.client.set(this.key(key), value, 'PX', Math.max(1, Math.floor(ttlMs)));
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(this.key(key));
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(this.key(key))) > 0;
  }

  /** 固定窗口计数：用于登录/邀请核验等短时限流（契约 §9） */
  async incrWithWindow(key: string, windowSec: number): Promise<number> {
    const fullKey = this.key(key);
    const count = await this.client.incr(fullKey);
    if (count === 1) await this.client.expire(fullKey, windowSec);
    return count;
  }

  /** /readyz 探活（真实 PING，失败返回 false 由 health 决定 503） */
  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch (error) {
      this.logger.warn(`Redis 探活失败: ${(error as Error).message}`);
      return false;
    }
  }

  // ── presence（契约 §7 /presence、§6 presence:update）──────────────────
  private presenceKey(userId: string): string {
    return `presence:user:${userId}`;
  }

  async touchPresence(userId: string, at: Date = new Date()): Promise<void> {
    await this.setWithTtl(
      this.presenceKey(userId),
      at.toISOString(),
      this.config.redis.presenceTtlSec * 1000,
    );
  }

  async clearPresence(userId: string): Promise<void> {
    await this.del(this.presenceKey(userId));
  }

  async isOnline(userId: string): Promise<boolean> {
    return this.exists(this.presenceKey(userId));
  }

  /** 批量在线状态（GET /presence） */
  async onlineAmong(userIds: readonly string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    if (userIds.length === 0) return result;
    const pipeline = this.client.pipeline();
    for (const id of userIds) pipeline.exists(this.key(this.presenceKey(id)));
    const replies = await pipeline.exec();
    userIds.forEach((id, index) => {
      const row = replies?.[index];
      result[id] = Array.isArray(row) && row[0] === null ? Number(row[1]) > 0 : false;
    });
    return result;
  }

  // ── typing（契约 §9：3000ms 自动过期）─────────────────────────────────
  private typingKey(channelId: string, userId: string): string {
    return `typing:${channelId}:${userId}`;
  }

  async setTyping(channelId: string, userId: string, active: boolean): Promise<void> {
    if (!active) {
      await this.del(this.typingKey(channelId, userId));
      return;
    }
    await this.setWithTtl(
      this.typingKey(channelId, userId),
      '1',
      Math.min(this.config.redis.typingTtlMs, 3000),
    );
  }

  /** 供限流器等外部组件复用统一的键前缀 */
  keyOf(key: string): string {
    return this.key(key);
  }

  get keyPrefix(): string {
    return this.config.redis.keyPrefix;
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
