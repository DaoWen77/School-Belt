import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EXP_REWARDS, levelOf } from './level';

/** 与 Prisma enum ExpReason 同名小写；单独声明避免业务层 import 生成的枚举 */
export type ExpReason = 'post' | 'comment' | 'like_received' | 'task_done' | 'daily_login' | 'admin';

export interface AwardOptions {
  /** 幂等键：`post:<id>`、`report:<id>`、`login:<userId>:<YYYY-MM-DD>`
   *  allowlist: 唯一
   */
  idempotencyKey: string;
  refType?: string;
  refId?: string;
  /** 覆盖默认奖励（违规扣分为负数） */
  delta?: number;
}

/**
 * EXP 发放（模块二）。
 * - 幂等：exp_logs.idempotency_key 唯一，重复发放静默返回 false；
 * - 必须在事务里与业务写入同生共死时，把 tx 传进来（不要嵌套 $transaction）；
 * - 失败只 warn，绝不影响发帖/评论/点赞/投票主流程。
 */
@Injectable()
export class ExpService {
  private readonly logger = new Logger(ExpService.name);

  constructor(private readonly prisma: PrismaService) {}

  async award(
    userId: string,
    reason: ExpReason,
    options: AwardOptions,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const delta = options.delta ?? EXP_REWARDS[reason as keyof typeof EXP_REWARDS] ?? 0;
    if (!Number.isInteger(delta) || delta === 0) {
      this.logger.warn(`EXP 发放跳过：delta=${delta}（${options.idempotencyKey}）`);
      return false;
    }
    try {
      const client = tx ?? this.prisma;
      if (tx) return await this.write(client, userId, reason, delta, options);
      return await this.prisma.withTransaction((inner) =>
        this.write(inner, userId, reason, delta, options),
      );
    } catch (error) {
      this.logger.warn(`EXP 发放失败（${reason}/${options.idempotencyKey}）：${(error as Error).message}`);
      return false;
    }
  }

  private async write(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    reason: ExpReason,
    delta: number,
    options: AwardOptions,
  ): Promise<boolean> {
    // createMany + skipDuplicates = ON CONFLICT DO NOTHING：重复发放不会撞唯一键，
    // 也不会把外层事务打成 aborted（P2002 在事务里会让后续语句全失败）。
    const inserted = await client.expLog.createMany({
      data: [
        {
          userId,
          delta,
          reason,
          refType: options.refType ?? null,
          refId: options.refId ?? null,
          idempotencyKey: options.idempotencyKey,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return false;

    // 原子加减，并让 level 缓存跟 exp 同步；GREATEST 保证 EXP 不为负。
    const rows = await client.$queryRaw<Array<{ exp: number }>>`
      UPDATE users
      SET exp = GREATEST(0, exp + ${delta}), updated_at = now()
      WHERE id = ${userId}::uuid
      RETURNING exp`;
    const row = rows[0];
    if (!row) return false;
    await client.user.update({ where: { id: userId }, data: { level: levelOf(row.exp) } });
    return true;
  }
}
