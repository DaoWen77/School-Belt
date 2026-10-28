import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import {
  DING_DAILY_LIMIT,
  DING_QUOTA_EXHAUSTED,
  MENTION_MAX,
  dingQuota,
  parseMentionHandles,
  shanghaiDayStart,
} from './im-utils';

export interface DingQuotaView {
  limit: number;
  used: number;
  remaining: number;
}

/**
 * 模块六 IM 辅助能力：@提及解析、单用户隐藏、拉黑、DING 配额。
 * 不持有频道/私聊访问判定（各业务 service 自带），避免循环依赖。
 */
@Injectable()
export class BeltImService {
  constructor(private readonly prisma: PrismaService) {}

  /** 今日 DING 用量（上海自然日，跨频道共享） */
  async dingQuota(user: AuthUser): Promise<DingQuotaView> {
    const used = await this.prisma.message.count({
      where: { senderId: user.id, ding: true, createdAt: { gte: shanghaiDayStart() } },
    });
    return dingQuota(used, DING_DAILY_LIMIT);
  }

  /** 可发送 DING 的剩余次数；为 0 时抛 429（统一文案） */
  async assertDingAvailable(user: AuthUser): Promise<DingQuotaView> {
    const quota = await this.dingQuota(user);
    if (quota.remaining <= 0) throw new AppError(ErrorCode.RATE_LIMITED, DING_QUOTA_EXHAUSTED);
    return quota;
  }

  /**
   * 隐藏消息：只影响自己的列表，幂等 upsert。
   * 访问权由调用方（频道/私聊 service）先行判定。
   */
  async hideMessage(user: AuthUser, messageId: string): Promise<{ hidden: true }> {
    if (!/^\d+$/.test(messageId)) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在');
    const id = BigInt(messageId);
    const message = await this.prisma.message.findUnique({
      where: { id },
      select: { id: true, channelId: true },
    });
    if (!message) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在');
    const channel = await this.prisma.channel.findUnique({
      where: { id: message.channelId },
      select: { surface: true, kind: true, archivedAt: true, organizationId: true },
    });
    if (!channel || channel.surface !== 'belt' || channel.archivedAt) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在');
    }
    // 私聊 / 组织频道必须先是成员；公开频道对环塔用户可见
    if (channel.kind === 'dm' || channel.organizationId !== null) {
      const member = await this.prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId: message.channelId, userId: user.id } },
        select: { userId: true },
      });
      if (!member) throw new AppError(ErrorCode.CHANNEL_NOT_FOUND, '消息不存在');
    }
    await this.prisma.messageHide.upsert({
      where: { messageId_userId: { messageId: id, userId: user.id } },
      create: { messageId: id, userId: user.id },
      update: {},
    });
    return { hidden: true };
  }

  /** 拉黑 / 取消拉黑（幂等；禁自己） */
  async setBlocked(actor: AuthUser, handle: string, blocked: boolean): Promise<{ blocked: boolean }> {
    const target = await this.prisma.user.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (!target) throw new AppError(ErrorCode.USER_NOT_FOUND, '用户不存在');
    if (target.id === actor.id) throw new AppError(ErrorCode.VALIDATION_FAILED, '不能拉黑自己');

    if (blocked) {
      await this.prisma.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId: actor.id, blockedId: target.id } },
        create: { blockerId: actor.id, blockedId: target.id },
        update: {},
      });
    } else {
      await this.prisma.userBlock.deleteMany({
        where: { blockerId: actor.id, blockedId: target.id },
      });
    }
    return { blocked };
  }

  /** 任一方向存在拉黑（DM 建链直接拒绝） */
  async hasBlockBetween(a: string, b: string): Promise<boolean> {
    const row = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { blockerId: true },
    });
    return row !== null;
  }

  /** @handle → 该会话成员 userId（去重、最多 20、忽略非成员） */
  async resolveMentionIds(channelId: string, body: string | null | undefined): Promise<string[]> {
    const handles = parseMentionHandles(body);
    if (handles.length === 0) return [];
    /* 公开环塔频道没有 channel_members 行（全员可访问），此时允许提及任意现存用户；
       组织私有频道仍严格按成员行过滤。 */
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { surface: true, organizationId: true },
    });
    const publicBeltChannel = channel?.surface === 'belt' && channel.organizationId === null;
    const members = await this.prisma.channelMember.findMany({
      where: { channelId, user: { handle: { in: handles } } },
      select: { userId: true, user: { select: { handle: true } } },
    });
    const idByHandle = new Map(
      members.map((member) => [member.user.handle.toLowerCase(), member.userId]),
    );
    if (publicBeltChannel) {
      const others = await this.prisma.user.findMany({
        where: { handle: { in: handles.filter((handle) => !idByHandle.has(handle)) } },
        select: { id: true, handle: true },
      });
      for (const user of others) idByHandle.set(user.handle.toLowerCase(), user.id);
    }
    return handles
      .map((handle) => idByHandle.get(handle))
      .filter((id): id is string => Boolean(id))
      .slice(0, MENTION_MAX);
  }

  /** userIds → handle 映射（批量，避免 N+1） */
  async mentionHandleMap(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, handle: true },
    });
    return new Map(users.map((user) => [user.id, user.handle]));
  }
}
