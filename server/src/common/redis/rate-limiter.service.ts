import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

export interface RateRule {
  /** 窗口内允许的最大次数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
}

/**
 * 用户级滑动窗口限流（契约 §9：发送 5 条/秒突发、60 条/分钟/用户；搜索 10/分钟）。
 * **只走 Redis**：ZSET 滑动窗口（ZREMRANGEBYSCORE + ZADD + ZCARD + PEXPIRE），多实例共享。
 * 不保留进程内降级；Redis 不可用时命令直接抛错（启动阶段已 fail fast）。
 * 超限抛 RATE_LIMITED，带 retryAfterMs。
 */
@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  /** 消息发送：5/s 突发 + 60/min（REST 与 WS 共用，因为都走 MessagesService.send） */
  async assertMessageSend(userId: string): Promise<void> {
    await this.consume(`ratelimit:msg:${userId}`, [
      { limit: 5, windowMs: 1_000 },
      { limit: 60, windowMs: 60_000 },
    ]);
  }

  /** 搜索：10 次/分钟/用户（契约 §9 + docs/09 口径） */
  async assertSearch(userId: string): Promise<void> {
    await this.consume(`ratelimit:search:${userId}`, [{ limit: 10, windowMs: 60_000 }]);
  }

  async consume(key: string, rules: readonly RateRule[]): Promise<void> {
    for (const rule of rules) {
      const allowed = await this.hit(key, rule);
      if (!allowed) {
        throw new AppError(ErrorCode.RATE_LIMITED, '操作过于频繁，请稍后再试', {
          retryAfterMs: rule.windowMs,
          limit: rule.limit,
          windowMs: rule.windowMs,
        });
      }
    }
  }

  private async hit(key: string, rule: RateRule): Promise<boolean> {
    const now = Date.now();
    const client = this.redis.getClient();
    const redisKey = this.redis.keyOf(`${key}:${rule.windowMs}`);

    const pipeline = client.multi();
    pipeline.zremrangebyscore(redisKey, 0, now - rule.windowMs);
    pipeline.zadd(redisKey, now, `${now}-${randomUUID()}`);
    pipeline.zcard(redisKey);
    pipeline.pexpire(redisKey, rule.windowMs);
    const results = await pipeline.exec();
    const countRow = results?.[2];
    const count = countRow ? Number(countRow[1]) : 0;
    return count <= rule.limit;
  }
}
