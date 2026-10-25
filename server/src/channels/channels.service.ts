import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ChannelAccessService, type ResolvedChannel } from '../common/guards/channel-access.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReadReceiptService } from '../common/realtime/read-receipt.service';
import { RealtimeService, rooms } from '../common/realtime/realtime.service';
import type { AuthUser } from '../common/types/context';
import type { ChannelRole, GlobalRole } from '../common/types/enums';
import { assertCheck, canCreateChannel, canEditChannel, isGlobalAdmin, toViewer } from '../common/utils/permissions';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import type {
  AddMemberDto,
  CreateChannelDto,
  UpdateChannelDto,
  UpdateMemberDto,
} from './channels.dto';

export interface ChannelView {
  id: string;
  name: string;
  slug: string;
  topic: string | null;
  visibility: 'public' | 'private';
  /** 组织专属频道 ID；普通频道为 null */
  organizationId: string | null;
  position: number;
  archived: boolean;
  memberCount: number;
  /** 是否已加入；owner/admin 可见的私密频道元数据行 joined=false 且 unread=0 */
  joined: boolean;
  myRole: ChannelRole | null;
  notifyLevel: 'all' | 'mentions' | 'none';
  lastReadSeq: string;
  unread: number;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface MemberView {
  userId: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  role: ChannelRole;
  notifyLevel: 'all' | 'mentions' | 'none';
  mutedUntil: string | null;
  lastReadSeq: string;
  joinedAt: string;
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
    private readonly readReceipts: ReadReceiptService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  /** GET /channels：可见频道 + 未读 + 成员数（契约 §3 直接 count，不做缓存） */
  async list(user: AuthUser): Promise<{ channels: ChannelView[] }> {
    const { channels, memberChannelIds } = await this.channelAccess.visibleChannels(user);
    const ids = channels.map((channel) => channel.id);

    const [members, counts, lastMessages] = await Promise.all([
      this.prisma.channelMember.findMany({
        where: { userId: user.id, channelId: { in: ids } },
        select: { channelId: true, role: true, notifyLevel: true, lastReadSeq: true },
      }),
      this.prisma.channelMember.groupBy({
        by: ['channelId'],
        where: { channelId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.message.groupBy({
        by: ['channelId'],
        where: { channelId: { in: ids }, deletedAt: null },
        _max: { createdAt: true },
      }),
    ]);

    const memberMap = new Map(members.map((m) => [m.channelId, m]));
    const countMap = new Map(counts.map((c) => [c.channelId, c._count._all]));
    const lastMap = new Map(lastMessages.map((m) => [m.channelId, m._max.createdAt]));

    const unreadEntries = await Promise.all(
      channels.map(async (channel) => {
        const member = memberMap.get(channel.id);
        if (!member || !memberChannelIds.has(channel.id)) return [channel.id, 0] as const;
        const unread = await this.prisma.message.count({
          where: {
            channelId: channel.id,
            id: { gt: member.lastReadSeq },
            deletedAt: null,
            senderId: { not: user.id },
          },
        });
        return [channel.id, unread] as const;
      }),
    );
    const unreadMap = new Map(unreadEntries);

    return {
      channels: channels.map((channel) => {
        const member = memberMap.get(channel.id);
        return {
          id: channel.id,
          name: channel.name,
          slug: channel.slug,
          topic: channel.topic,
          visibility: channel.visibility,
          organizationId: channel.organizationId,
          position: channel.position,
          archived: channel.archivedAt !== null,
          memberCount: countMap.get(channel.id) ?? 0,
          joined: member !== undefined,
          myRole: member?.role ?? null,
          notifyLevel: member?.notifyLevel ?? 'all',
          lastReadSeq: (member?.lastReadSeq ?? 0n).toString(),
          unread: unreadMap.get(channel.id) ?? 0,
          lastMessageAt: lastMap.get(channel.id)?.toISOString() ?? null,
          createdAt: channel.createdAt.toISOString(),
        };
      }),
    };
  }

  /** POST /channels：owner/admin 建频道，创建者自动成为频道 moderator */
  async create(user: AuthUser, dto: CreateChannelDto): Promise<ChannelView> {
    assertCheck(canCreateChannel(toViewer(user)));

    const channel = await this.prisma.withTransaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          topic: dto.topic ?? null,
          visibility: dto.visibility,
          position: dto.position ?? 1000,
          createdBy: user.id,
        },
      });
      await tx.channelMember.create({
        data: { channelId: created.id, userId: user.id, role: 'moderator' },
      });
      return created;
    });

    this.realtime.broadcast('channel:created', {
      channel: { id: channel.id, name: channel.name, slug: channel.slug, visibility: channel.visibility },
    });
    this.logger.log(`频道 ${channel.slug} 已创建（by ${user.handle}）`);
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.CHANNEL_CREATE,
      targetKind: 'channel',
      targetId: channel.id,
      meta: { slug: channel.slug, visibility: channel.visibility },
    });
    return this.viewOf(channel, 1, true, 'moderator', 'all', 0n, 0, null);
  }

  /** GET /channels/:id */
  async get(user: AuthUser, channelId: string): Promise<ChannelView> {
    const resolved = await this.channelAccess.assert(channelId, user, 'read');
    const [channel, memberCount, member, lastMessage] = await Promise.all([
      this.prisma.channel.findUniqueOrThrow({
        where: { id: channelId },
        select: {
          topic: true,
          position: true,
          organizationId: true,
          archivedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.channelMember.count({ where: { channelId } }),
      this.prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId: user.id } },
        select: { role: true, notifyLevel: true, lastReadSeq: true },
      }),
      this.prisma.message.findFirst({
        where: { channelId, deletedAt: null },
        orderBy: { id: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const unread = member
      ? await this.prisma.message.count({
          where: {
            channelId,
            id: { gt: member.lastReadSeq },
            deletedAt: null,
            senderId: { not: user.id },
          },
        })
      : 0;

    return this.viewOf(
      {
        id: resolved.channel.id,
        name: resolved.channel.name,
        slug: resolved.channel.slug,
        topic: channel.topic,
        visibility: resolved.channel.visibility,
        organizationId: channel.organizationId,
        position: channel.position,
        archivedAt: channel.archivedAt,
        createdAt: channel.createdAt,
      },
      memberCount,
      member !== null,
      member?.role ?? null,
      member?.notifyLevel ?? 'all',
      member?.lastReadSeq ?? 0n,
      unread,
      lastMessage?.createdAt ?? null,
    );
  }

  /** PATCH /channels/:id */
  async update(user: AuthUser, channelId: string, dto: UpdateChannelDto): Promise<{ id: string }> {
    const resolved = await this.channelAccess.assert(channelId, user, 'read');
    this.assertCommunityChannel(resolved);
    assertCheck(canEditChannel(toViewer(user, resolved.member), resolved.channel));

    const channel = await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.topic !== undefined ? { topic: dto.topic } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
      },
    });

    this.realtime.broadcast('channel:updated', {
      channel: {
        id: channel.id,
        name: channel.name,
        slug: channel.slug,
        topic: channel.topic,
        visibility: channel.visibility,
        position: channel.position,
      },
    });
    return { id: channel.id };
  }

  /** DELETE /channels/:id：软归档（owner/admin） */
  async archive(user: AuthUser, channelId: string): Promise<{ id: string; archivedAt: string }> {
    assertCheck(canCreateChannel(toViewer(user)));
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, kind: 'channel', archivedAt: null },
    });
    if (!channel) throw new AppError(ErrorCode.CHANNEL_NOT_FOUND);
    if (channel.organizationId) {
      const member = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: channel.organizationId, userId: user.id } },
      });
      if (!member || member.status !== 'active' || (member.role !== 'owner' && member.role !== 'admin')) {
        throw new AppError(ErrorCode.FORBIDDEN, '仅组织 Owner/管理员可归档该私有频道');
      }
    }
    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { archivedAt: new Date() },
    });
    this.realtime.broadcast('channel:updated', {
      channel: { id: channel.id, name: channel.name, archived: true },
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.CHANNEL_ARCHIVE,
      targetKind: 'channel',
      targetId: channelId,
      meta: { slug: channel.slug },
    });
    return { id: channelId, archivedAt: (channel.archivedAt ?? new Date()).toISOString() };
  }

  /** GET /channels/:id/members */
  async listMembers(user: AuthUser, channelId: string): Promise<{ members: MemberView[] }> {
    await this.channelAccess.assert(channelId, user, 'read');
    const members = await this.prisma.channelMember.findMany({
      where: { channelId },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, handle: true, displayName: true, avatarFileId: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      members: members.map((member) => {
        const info = userMap.get(member.userId);
        return {
          userId: member.userId,
          handle: info?.handle ?? 'unknown',
          displayName: info?.displayName ?? '未知成员',
          avatarFileId: info?.avatarFileId ?? null,
          role: member.role,
          notifyLevel: member.notifyLevel,
          mutedUntil: member.mutedUntil?.toISOString() ?? null,
          lastReadSeq: member.lastReadSeq.toString(),
          joinedAt: member.joinedAt.toISOString(),
        };
      }),
    };
  }

  /** POST /channels/:id/members */
  async addMember(user: AuthUser, channelId: string, dto: AddMemberDto): Promise<MemberView> {
    const resolved = await this.channelAccess.assert(channelId, user, 'manage');
    this.assertCommunityChannel(resolved);
    this.assertCanManageRole(user, dto.role);

    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, handle: true, displayName: true, avatarFileId: true, status: true },
    });
    if (!target) throw new AppError(ErrorCode.VALIDATION_FAILED, '用户不存在', { userId: dto.userId });
    if (target.status === 'suspended') throw new AppError(ErrorCode.FORBIDDEN, '目标用户已被封禁');

    const member = await this.prisma.channelMember.upsert({
      where: { channelId_userId: { channelId, userId: dto.userId } },
      create: {
        channelId,
        userId: dto.userId,
        role: dto.role,
        notifyLevel: dto.notifyLevel ?? 'all',
      },
      update: {
        role: dto.role,
        ...(dto.notifyLevel ? { notifyLevel: dto.notifyLevel } : {}),
      },
    });

    this.realtime.emitToRoom(rooms.channel(channelId), 'member:updated', {
      channelId,
      userId: member.userId,
      role: member.role,
      notifyLevel: member.notifyLevel,
    });
    this.realtime.emitToUser(member.userId, 'channel:created', {
      channel: { id: resolved.channel.id, name: resolved.channel.name, slug: resolved.channel.slug },
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.CHANNEL_MEMBER_ADD,
      targetKind: 'channel_member',
      targetId: `${channelId}:${member.userId}`,
      meta: { role: member.role, notifyLevel: member.notifyLevel },
    });

    return {
      userId: member.userId,
      handle: target.handle,
      displayName: target.displayName,
      avatarFileId: target.avatarFileId,
      role: member.role,
      notifyLevel: member.notifyLevel,
      mutedUntil: member.mutedUntil?.toISOString() ?? null,
      lastReadSeq: member.lastReadSeq.toString(),
      joinedAt: member.joinedAt.toISOString(),
    };
  }

  /** PATCH /channels/:id/members/:userId */
  async updateMember(
    user: AuthUser,
    channelId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ): Promise<{ channelId: string; userId: string; role: ChannelRole; notifyLevel: string }> {
    const resolved = await this.channelAccess.assert(channelId, user, 'manage');
    this.assertCommunityChannel(resolved);
    const target = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: targetUserId } },
      select: { role: true },
    });
    if (!target) throw new AppError(ErrorCode.VALIDATION_FAILED, '成员不存在', { userId: targetUserId });

    this.assertCanManageRole(user, target.role);
    if (dto.role) this.assertCanManageRole(user, dto.role);

    const updated = await this.prisma.channelMember.update({
      where: { channelId_userId: { channelId, userId: targetUserId } },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.notifyLevel !== undefined ? { notifyLevel: dto.notifyLevel } : {}),
        ...(dto.mutedUntil !== undefined
          ? { mutedUntil: dto.mutedUntil === null ? null : new Date(dto.mutedUntil) }
          : {}),
      },
    });

    this.realtime.emitToRoom(rooms.channel(channelId), 'member:updated', {
      channelId,
      userId: targetUserId,
      role: updated.role,
      notifyLevel: updated.notifyLevel,
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.CHANNEL_MEMBER_UPDATE,
      targetKind: 'channel_member',
      targetId: `${channelId}:${targetUserId}`,
      meta: {
        role: updated.role,
        previousRole: target.role,
        notifyLevel: updated.notifyLevel,
        mutedUntil: updated.mutedUntil?.toISOString() ?? null,
      },
    });
    return {
      channelId,
      userId: targetUserId,
      role: updated.role,
      notifyLevel: updated.notifyLevel,
    };
  }

  /** DELETE /channels/:id/members/:userId */
  async removeMember(user: AuthUser, channelId: string, targetUserId: string): Promise<{ removed: boolean }> {
    const resolved = await this.channelAccess.assert(channelId, user, 'manage');
    this.assertCommunityChannel(resolved);
    const target = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: targetUserId } },
      select: { role: true },
    });
    if (!target) throw new AppError(ErrorCode.VALIDATION_FAILED, '成员不存在', { userId: targetUserId });

    this.assertCanManageRole(user, target.role);
    await this.prisma.channelMember.delete({
      where: { channelId_userId: { channelId, userId: targetUserId } },
    });

    this.realtime.emitToRoom(rooms.channel(channelId), 'member:updated', {
      channelId,
      userId: targetUserId,
      role: null,
      notifyLevel: null,
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.CHANNEL_MEMBER_REMOVE,
      targetKind: 'channel_member',
      targetId: `${channelId}:${targetUserId}`,
      meta: { role: target.role },
    });
    return { removed: true };
  }

  /** POST /channels/:id/read：进入服务端 300ms 合并窗口 */
  async markRead(user: AuthUser, channelId: string, seq: bigint): Promise<{ channelId: string; seq: string; accepted: true }> {
    const resolved = await this.channelAccess.assert(channelId, user, 'read');
    if (!resolved.member) throw new AppError(ErrorCode.NOT_CHANNEL_MEMBER, '非频道成员，无法上报已读');
    if (seq < 0n) throw new AppError(ErrorCode.VALIDATION_FAILED, 'seq 不能为负');
    this.readReceipts.submit(user.id, channelId, seq);
    return { channelId, seq: seq.toString(), accepted: true };
  }

  /**
   * 契约 v1.2 §A：DM / 群聊复用 channels 行，但元数据与成员只允许走 /conversations 接口。
   * 这样 owner/admin 也不能借「频道成员管理」越权改动他人私聊 / 群聊。
   */
  private assertCommunityChannel(resolved: ResolvedChannel): void {
    if (resolved.channel.kind !== 'channel') {
      throw new AppError(
        ErrorCode.CONVERSATION_KIND_INVALID,
        '会话请使用 /conversations 接口管理',
      );
    }
  }

  /** 频道 moderator 不可管理同级 moderator（契约 §4 规则 3） */
  private assertCanManageRole(actor: AuthUser, targetRole: ChannelRole | GlobalRole): void {    if (isGlobalAdmin(actor.globalRole)) return;
    if (targetRole === 'moderator' || targetRole === 'admin' || targetRole === 'owner') {
      throw new AppError(ErrorCode.FORBIDDEN, '档案员不可管理同级或更高角色');
    }
  }

  private viewOf(
    channel: {
      id: string;
      name: string;
      slug: string;
      topic: string | null;
      visibility: 'public' | 'private';
      organizationId: string | null;
      position: number;
      archivedAt: Date | null;
      createdAt: Date;
    },
    memberCount: number,
    joined: boolean,
    myRole: ChannelRole | null,
    notifyLevel: 'all' | 'mentions' | 'none',
    lastReadSeq: bigint,
    unread: number,
    lastMessageAt: Date | null,
  ): ChannelView {
    return {
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      topic: channel.topic,
      visibility: channel.visibility,
      organizationId: channel.organizationId,
      position: channel.position,
      archived: channel.archivedAt !== null,
      memberCount,
      joined,
      myRole,
      notifyLevel,
      lastReadSeq: lastReadSeq.toString(),
      unread,
      lastMessageAt: lastMessageAt?.toISOString() ?? null,
      createdAt: channel.createdAt.toISOString(),
    };
  }
}
