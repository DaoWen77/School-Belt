import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';

export interface WalletView {
  balanceCents: number;
  recent: Array<{
    id: string;
    amountCents: number;
    balanceAfterCents: number;
    kind: string;
    memo: string | null;
    createdAt: string;
  }>;
}

export interface TipResult {
  tippedCents: number;
  myBalanceCents: number;
  groupId: string;
}

/**
 * 环塔商券：余额在 users.balance_cents，流水在 ledger_entries。
 * 打赏全程单事务：条件扣款（balance_cents >= x）→ 入账 → 写两条同 group 流水。
 */
@Injectable()
export class BeltWalletService {
  constructor(private readonly prisma: PrismaService) {}

  async wallet(actor: AuthUser): Promise<WalletView> {
    const [user, rows] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { balanceCents: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { userId: actor.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          amountCents: true,
          balanceAfterCents: true,
          kind: true,
          memo: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      balanceCents: user?.balanceCents ?? 0,
      recent: rows.map((row) => ({
        id: row.id,
        amountCents: row.amountCents,
        balanceAfterCents: row.balanceAfterCents,
        kind: row.kind as string,
        memo: row.memo,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async tip(
    actor: AuthUser,
    postId: string,
    amountCents: number,
    idempotencyKey?: string,
  ): Promise<TipResult> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, surface: 'belt', status: 'published', deletedAt: null },
      select: { id: true, authorId: true },
    });
    if (!post) throw new AppError(ErrorCode.VALIDATION_FAILED, '帖子不存在', { postId });
    if (post.authorId === actor.id) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '不能打赏自己的帖子');
    }

    const key = idempotencyKey?.trim() || randomUUID();
    const outKey = `tip:${key}:out`;
    const inKey = `tip:${key}:in`;

    const existing = await this.prisma.ledgerEntry.findUnique({
      where: { idempotencyKey: outKey },
      select: { amountCents: true, groupId: true },
    });
    if (existing) return this.tipResult(actor.id, existing.amountCents, existing.groupId);

    const groupId = randomUUID();
    const memo = `打赏帖子 ${post.id.slice(0, 8)}`;
    try {
      return await this.prisma.withTransaction(async (tx) => {
        let myBalance: number;
        try {
          // 条件扣款：余额不足时行不匹配（P2025），避免先查后改的竞态。
          const debited = await tx.user.update({
            where: { id: actor.id, balanceCents: { gte: amountCents } },
            data: { balanceCents: { decrement: amountCents } },
            select: { balanceCents: true },
          });
          myBalance = debited.balanceCents;
        } catch (error) {
          if (PrismaService.isNotFound(error)) {
            throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, '商券余额不足');
          }
          throw error;
        }
        const credited = await tx.user.update({
          where: { id: post.authorId },
          data: { balanceCents: { increment: amountCents } },
          select: { balanceCents: true },
        });
        await tx.ledgerEntry.createMany({
          data: [
            {
              userId: actor.id,
              amountCents: -amountCents,
              balanceAfterCents: myBalance,
              kind: 'tip_out',
              refType: 'post',
              refId: post.id,
              groupId,
              idempotencyKey: outKey,
              memo,
            },
            {
              userId: post.authorId,
              amountCents,
              balanceAfterCents: credited.balanceCents,
              kind: 'tip_in',
              refType: 'post',
              refId: post.id,
              groupId,
              idempotencyKey: inKey,
              memo,
            },
          ],
        });
        return { tippedCents: amountCents, myBalanceCents: myBalance, groupId };
      });
    } catch (error) {
      // 同 idempotencyKey 并发：唯一键兜底，冲突方读回已入账结果。
      if (!PrismaService.isUniqueViolation(error)) throw error;
      const duplicate = await this.prisma.ledgerEntry.findUnique({
        where: { idempotencyKey: outKey },
        select: { amountCents: true, groupId: true },
      });
      if (!duplicate) throw error;
      return this.tipResult(actor.id, duplicate.amountCents, duplicate.groupId);
    }
  }

  private async tipResult(
    userId: string,
    tippedCents: number,
    groupId: string,
  ): Promise<TipResult> {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balanceCents: true },
    });
    return { tippedCents, myBalanceCents: me?.balanceCents ?? 0, groupId };
  }
}
