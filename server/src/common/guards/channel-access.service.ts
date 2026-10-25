import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, ChannelContext, ChannelMemberContext } from '../types/context';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { Viewer } from '../utils/permissions';
import {
  assertCheck,
  canModerateChannel,
  canReadChannel,
  canSeeChannelMetadata,
  canWriteChannel,
  isGlobalAdmin,
  type Check,
} from '../utils/permissions';

export type ChannelAccess = 'read' | 'write' | 'moderate' | 'manage';

export interface ResolvedChannel {
  channel: ChannelContext;
  member: ChannelMemberContext | null;
  viewer: Viewer;
}

/**
 * 频道级权限解析（契约 §4 判定顺序）：
 * 登录（守卫已做）→ 全站封禁 → 频道可见性 → 频道成员 → 禁言 → 业务规则。
 * 结果缓存到 request 上，避免同一请求内重复查库。
 */
@Injectable()
export class ChannelAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(channelId: string, user: AuthUser): Promise<ResolvedChannel> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        name: true,
        slug: true,
        visibility: true,
        kind: true,
        surface: true,
        organizationId: true,
        archivedAt: true,
        createdBy: true,
        organization: { select: { status: true } },
      },
    });
    // 内部频道权限服务接受 internal；bridge DM 是唯一的跨面 DM 例外。
    // 环带公开频道仍走独立的 belt 消息服务。
    if (
      !channel ||
      (channel.surface !== 'internal' &&
        !(channel.surface === 'bridge' && channel.kind === 'dm'))
    ) {
      throw new AppError(ErrorCode.CHANNEL_NOT_FOUND, '频道不存在');
    }
    if (channel.surface === 'bridge') {
      const friendship = await this.prisma.friendship.findFirst({
        where: {
          dmChannelId: channel.id,
          status: 'accepted',
          OR: [{ requesterId: user.id }, { addresseeId: user.id }],
        },
        select: { id: true },
      });
      if (!friendship) throw new AppError(ErrorCode.CHANNEL_NOT_FOUND, '频道不存在');
    }
    // 组织频道：全站 Owner/Admin 不是组织成员时也一视同仁，返回 404 隐藏存在性。
    if (channel.organizationId) {
      const orgMember = await this.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: channel.organizationId,
            userId: user.id,
          },
        },
        select: { status: true },
      });
      if (
        channel.organization?.status !== 'active' ||
        !orgMember ||
        orgMember.status !== 'active'
      ) {
        throw new AppError(ErrorCode.CHANNEL_NOT_FOUND, '频道不存在');
      }
    }

    const member = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: user.id } },
      select: {
        channelId: true,
        userId: true,
        role: true,
        notifyLevel: true,
        mutedUntil: true,
        lastReadSeq: true,
      },
    });

    const channelContext: ChannelContext = {
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      visibility: channel.visibility,
      kind: channel.kind,
      surface: channel.surface,
      organizationId: channel.organizationId,
      archived: channel.archivedAt !== null,
      createdBy: channel.createdBy,
    };

    const viewer: Viewer = {
      userId: user.id,
      globalRole: user.globalRole,
      status: user.status,
      globalMutedUntil: user.mutedUntil,
      isMember: member !== null,
      channelRole: member?.role ?? null,
      channelMutedUntil: member?.mutedUntil ?? null,
    };

    return {
      channel: channelContext,
      member: member
        ? {
            channelId: member.channelId,
            userId: member.userId,
            role: member.role,
            notifyLevel: member.notifyLevel,
            mutedUntil: member.mutedUntil,
            lastReadSeq: member.lastReadSeq,
          }
        : null,
      viewer,
    };
  }

  async assert(channelId: string, user: AuthUser, access: ChannelAccess, now = new Date()): Promise<ResolvedChannel> {
    const resolved = await this.resolve(channelId, user);
    assertCheck(this.check(resolved, access, now), { channelId });
    return resolved;
  }

  check(resolved: ResolvedChannel, access: ChannelAccess, now = new Date()): Check {
    const { viewer, channel } = resolved;
    switch (access) {
      case 'read':
        return canReadChannel(viewer, channel);
      case 'write':
        return canWriteChannel(viewer, channel, now);
      case 'moderate':
        return canModerateChannel(viewer, channel)
          ? { ok: true }
          : { ok: false, code: ErrorCode.FORBIDDEN, reason: '仅档案员可执行该操作' };
      case 'manage':
        return canModerateChannel(viewer, channel)
          ? { ok: true }
          : { ok: false, code: ErrorCode.FORBIDDEN, reason: '仅协议官或档案员可管理频道成员' };
      default: {
        const exhaustive: never = access;
        throw new Error(`未知的频道权限：${String(exhaustive)}`);
      }
    }
  }

  /**
   * GET /channels：可见频道 = 公开频道 + 我加入的频道；
   * 契约 §4 末行：owner/admin 额外可见私密频道**元数据**（名称可见、消息不可读）。
   * 契约 v1.2 §A：只有 kind='channel' 的社区频道进入该列表；DM/群聊走 GET /conversations。
   */
  async visibleChannels(user: AuthUser) {
    const memberships = await this.prisma.channelMember.findMany({
      where: { userId: user.id },
      select: { channelId: true },
    });
    const memberChannelIds = new Set(memberships.map((m) => m.channelId));
    const metadataIncludesPrivate = isGlobalAdmin(user.globalRole);
    // 组织频道只对 active 组织成员可见；全站 Owner 不是成员时也不能看元数据。
    const orgMemberships = await this.prisma.organizationMember.findMany({
      where: { userId: user.id, status: 'active', organization: { status: 'active' } },
      select: { organizationId: true },
    });
    const orgIds = orgMemberships.map((member) => member.organizationId);
    const channels = await this.prisma.channel.findMany({
      where: {
        kind: 'channel',
        surface: 'internal',
        OR: [
          { visibility: 'public', organizationId: null },
          { id: { in: [...memberChannelIds] }, organizationId: null },
          { visibility: 'private', createdBy: user.id, organizationId: null },
          ...(metadataIncludesPrivate
            ? [{ visibility: 'private' as const, organizationId: null }]
            : []),
          ...(orgIds.length > 0 ? [{ organizationId: { in: orgIds } }] : []),
        ],
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        topic: true,
        visibility: true,
        organizationId: true,
        position: true,
        archivedAt: true,
        createdAt: true,
      },
    });
    return { channels, memberChannelIds };
  }

  /** 校验并确保调用方是频道成员（WS channel:join / 已读上报） */
  assertMember(user: AuthUser, resolved: ResolvedChannel): ChannelMemberContext {
    if (!resolved.member) {
      const canRead = canReadChannel(resolved.viewer, resolved.channel);
      if (canRead.ok) {
        // owner/admin 对公开频道可读，但没有成员行，只读不产生已读游标
        throw new AppError(ErrorCode.FORBIDDEN, '请先加入频道');
      }
      throw new AppError(ErrorCode.NOT_CHANNEL_MEMBER, '非频道成员');
    }
    return resolved.member;
  }

  /** 元数据可见性（GET /channels/:id 中非成员仅能看到基础信息） */
  metadataVisible(user: AuthUser, resolved: ResolvedChannel): boolean {
    return canSeeChannelMetadata(resolved.viewer, resolved.channel).ok && Boolean(user.id);
  }
}
