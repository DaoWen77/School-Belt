import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ChannelKind } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { IdentityService } from '../common/identity/identity.service';
import type { AuthUser } from '../common/types/context';
import type { ChannelRole } from '../common/types/enums';
import { WsServerEvent } from '../ws/ws.events';
import {
  canAddConversationMembers,
  canDissolveConversation,
  canEditAnnouncement,
  canReadConversation,
  canRemoveConversationMember,
  canRenameConversation,
  checkAnnouncement,
  checkGroupMemberGrowth,
  checkGroupMembers,
  checkGroupName,
  dmKeyOf,
  dmSlugOf,
  groupSlugOf,
  lastMessagePreview,
  normalizeAnnouncement,
  normalizeGroupMemberIds,
  normalizeGroupName,
  type ConversationCheck,
  type ConversationKind,
  type ConversationMemberRole,
} from './conversation-rules';
import type {
  AddConversationMembersDto,
  CreateDmDto,
  CreateGroupDto,
  RenameConversationDto,
  UpdateAnnouncementDto,
} from './conversations.dto';

/** 会话行（channels 表在 DM/群聊语境下的投影） */
interface ConversationRow {
  id: string;
  name: string;
  slug: string;
  kind: ChannelKind;
  surface: 'internal' | 'belt' | 'bridge';
  dmKey: string | null;
  announcement: string | null;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  createdBy: string;
}

const CONVERSATION_SELECT = {
  id: true,
  name: true,
  slug: true,
  kind: true,
  surface: true,
  dmKey: true,
  announcement: true,
  archivedAt: true,
  lastMessageAt: true,
  createdAt: true,
  createdBy: true,
} as const;

export interface ConversationMemberView {
  userId: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  role: ConversationMemberRole;
  lastReadSeq: string;
  joinedAt: string;
}

export interface ConversationPeerView {
  userId: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
}

/** 契约 v1.2 §B 的会话列表/详情视图 */
export interface ConversationView {
  id: string;
  kind: ConversationKind;
  name: string;
  slug: string;
  members: ConversationMemberView[];
  peer: ConversationPeerView | null;
  announcement: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  myRole: ConversationMemberRole | null;
  createdAt: string;
  createdBy: string;
  surface: 'internal' | 'belt' | 'bridge';
}

export interface ConversationUserView {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  prefixes: string[];
}

/**
 * 会话服务（契约 v1.2 §A / §B / §D）。
 *
 * 设计取舍：不新建 conversations 表 —— DM/群聊直接复用 channels 行 + channel_members，
 * 消息 / 已读 / 线程 / 附件 / 反应链路零重复；前端把会话 id 当 channelId 用。
 * 幂等：DM 的 dm_key = sha256(排序后的两个 userId 以 ':' 连接) 承担唯一键，
 * 并发创建靠部分唯一索引兜底，命中冲突后读回已有会话。
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly identity: IdentityService,
  ) {}

  // ── 读 ───────────────────────────────────────────────────────────────────

  /** GET /conversations：当前用户的 DM + 群聊，按 lastMessageAt desc nulls last */
  async list(user: AuthUser): Promise<{ conversations: ConversationView[] }> {
    const memberships = await this.prisma.channelMember.findMany({
      where: { userId: user.id },
      select: { channelId: true },
    });
    if (memberships.length === 0) return { conversations: [] };

    const channels = await this.prisma.channel.findMany({
      where: {
        id: { in: memberships.map((membership) => membership.channelId) },
        archivedAt: null,
        OR: [
          { kind: { in: ['dm', 'group'] }, surface: 'internal' },
          // bridge DM 只以 DM 形式进入内部侧栏；读取时再验 accepted 好友关系。
          { kind: 'dm', surface: 'bridge' },
        ],
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: CONVERSATION_SELECT,
    });
    const views = await this.loadViews(user.id, channels);
    return {
      conversations: channels
        .map((channel) => views.get(channel.id))
        .filter((view): view is ConversationView => view !== undefined),
    };
  }

  /** GET /conversations/:id：成员可读；非成员（含 owner/admin）一律 CONVERSATION_NOT_FOUND */
  async get(
    user: AuthUser,
    conversationId: string,
  ): Promise<{ conversation: ConversationView; members: ConversationMemberView[] }> {
    const { channel } = await this.resolve(user, conversationId);
    const views = await this.loadViews(user.id, [channel]);
    const conversation = views.get(channel.id);
    if (!conversation) throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
    return { conversation, members: conversation.members };
  }

  /** GET /conversations/users：可发起会话的用户（排除自己，按 displayName 排序） */
  async listUsers(user: AuthUser): Promise<{ users: ConversationUserView[] }> {
    const users = await this.prisma.user.findMany({
      where: { id: { not: user.id }, status: 'active', isInternal: true },
      orderBy: [{ displayName: 'asc' }, { handle: 'asc' }],
      take: 200,
      select: {
        id: true,
        handle: true,
        displayName: true,
        avatarFileId: true,
        tags: true,
        globalRole: true,
      },
    });
    const prefixes = await this.identity.prefixesForMany(users);
    return {
      users: users.map((user) => ({
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        avatarFileId: user.avatarFileId,
        prefixes: prefixes[user.id] ?? [],
      })),
    };
  }

  // ── 创建（契约 v1.2 §B / §D）─────────────────────────────────────────────

  /** POST /conversations/dm：幂等，同一对人永远同一条；不能和自己建 */
  async createDm(user: AuthUser, dto: CreateDmDto): Promise<ConversationView> {
    if (dto.userId === user.id) {
      throw new AppError(ErrorCode.DM_SELF, '不能和自己建立私聊');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, status: true, isInternal: true },
    });
    if (!target) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '用户不存在', { userId: dto.userId });
    }
    if (target.status === 'suspended') {
      throw new AppError(ErrorCode.FORBIDDEN, '目标用户已被封禁');
    }
    if (!target.isInternal) {
      throw new AppError(ErrorCode.FORBIDDEN, '内部私聊不能指向环带账号');
    }

    // Phase D：DM 由 accepted 好友链路产生，前端不能再直接建会话。
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: 'accepted',
        surface: 'internal',
        dmChannelId: { not: null },
        OR: [
          { requesterId: user.id, addresseeId: target.id },
          { requesterId: target.id, addresseeId: user.id },
        ],
      },
      select: { dmChannelId: true },
    });
    if (!friendship?.dmChannelId) {
      throw new AppError(ErrorCode.FRIENDSHIP_REQUIRED, '请先在设置 → 好友中建立好友链路');
    }
    const existing = await this.prisma.channel.findUnique({
      where: { id: friendship.dmChannelId },
      select: CONVERSATION_SELECT,
    });
    if (!existing) throw new AppError(ErrorCode.FRIENDSHIP_REQUIRED, '好友会话不存在，请重新建立链路');
    await this.ensureMembers(existing.id, [user.id, target.id]);
    return this.viewFor(user.id, existing);
  }

  /** POST /conversations/group：创建者 moderator，成员含自己、去重、≤50 */
  async createGroup(user: AuthUser, dto: CreateGroupDto): Promise<ConversationView> {
    this.assertRule(checkGroupName(dto.name));
    const rawMemberIds = dto.memberIds;
    this.assertRule(checkGroupMembers(user.id, rawMemberIds));
    const name = normalizeGroupName(dto.name);
    if (name === null) throw new AppError(ErrorCode.VALIDATION_FAILED, '群聊名称不合法');
    const memberIds = normalizeGroupMemberIds(user.id, rawMemberIds);

    await this.assertUsersJoinable(memberIds.filter((id) => id !== user.id));

    const channel = await this.prisma.withTransaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          name,
          slug: groupSlugOf(randomUUID()),
          topic: null,
          visibility: 'private',
          kind: 'group',
          surface: 'internal',
          dmKey: null,
          position: 0,
          createdBy: user.id,
        },
        select: CONVERSATION_SELECT,
      });
      await tx.channelMember.createMany({
        data: memberIds.map((userId) => ({
          channelId: created.id,
          userId,
          role: userId === user.id ? ('moderator' as const) : ('member' as const),
        })),
        skipDuplicates: true,
      });
      return created;
    });

    this.logger.log(`群聊「${name}」已创建（${memberIds.length} 人，by ${user.handle}）`);
    await this.emitConversation(memberIds, WsServerEvent.CONVERSATION_CREATED, channel);
    return this.viewFor(user.id, channel);
  }

  // ── 管理（契约 v1.2 §B / §D3）────────────────────────────────────────────

  /** PATCH /conversations/:id：仅群聊 moderator 可改名 */
  async rename(
    user: AuthUser,
    conversationId: string,
    dto: RenameConversationDto,
  ): Promise<ConversationView> {
    const { channel, member, memberIds } = await this.resolve(user, conversationId);
    this.assertRule(
      canRenameConversation(this.headerOf(channel, memberIds), user.id, member.role),
    );

    const name = normalizeGroupName(dto.name);
    if (name === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '群聊名称需为 1–60 个字符');
    }
    const updated = await this.prisma.channel.update({
      where: { id: channel.id },
      data: { name },
      select: CONVERSATION_SELECT,
    });
    await this.emitConversation(memberIds, WsServerEvent.CONVERSATION_UPDATED, updated);
    return this.viewFor(user.id, updated);
  }

  /**
   * PATCH /conversations/:id/announcement（Sprint1）：
   * 仅 kind=group 且调用者 ChannelMember.role=moderator；≤4000 字符；空串表示清除。
   */
  async updateAnnouncement(
    user: AuthUser,
    conversationId: string,
    dto: UpdateAnnouncementDto,
  ): Promise<ConversationView> {
    const { channel, member, memberIds } = await this.resolve(user, conversationId);
    this.assertRule(
      canEditAnnouncement(this.headerOf(channel, memberIds), user.id, member.role),
    );
    this.assertRule(checkAnnouncement(dto.announcement));

    const updated = await this.prisma.channel.update({
      where: { id: channel.id },
      data: { announcement: normalizeAnnouncement(dto.announcement) },
      select: CONVERSATION_SELECT,
    });
    await this.emitConversation(memberIds, WsServerEvent.CONVERSATION_UPDATED, updated);
    this.logger.log(`群公告已更新（channel=${channel.id}, by=${user.handle}）`);
    return this.viewFor(user.id, updated);
  }

  /**
   * DELETE /conversations/:id（Sprint1）：群主解散群聊。
   *
   * - 仅 kind=group；DM/普通频道 → CONVERSATION_KIND_INVALID；
   * - 仅 channel.createdBy === user.id（群主），否则 FORBIDDEN；
   * - Prisma.$transaction 内 archive（archived_at=now()），**保留消息与成员**（软归档，不物理删）；
   * - 事务提交后向所有成员 user 房间 emit conversation:removed；
   * - 列表/详情按 archived_at IS NULL 过滤（已存在），归档后不可再发消息（messages.service 的断言）。
   */
  async dissolve(
    user: AuthUser,
    conversationId: string,
  ): Promise<{ archived: true }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
      throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
    }
    const channel = await this.prisma.channel.findUnique({
      where: { id: conversationId },
      select: { ...CONVERSATION_SELECT, createdBy: true },
    });
    if (!channel || channel.surface !== 'internal' || channel.archivedAt !== null) {
      throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
    }
    if (channel.kind !== 'group') {
      throw new AppError(ErrorCode.CONVERSATION_KIND_INVALID, '仅群聊支持解散');
    }
    if (channel.createdBy !== user.id) {
      throw new AppError(ErrorCode.FORBIDDEN, '仅群主可解散群聊');
    }

    const members = await this.prisma.channelMember.findMany({
      where: { channelId: channel.id },
      select: { userId: true },
    });
    const memberIds = members.map((member) => member.userId);

    // 事务：只置 archived_at；messages / channel_members 原样保留（软归档，不可逆物理删）
    await this.prisma.$transaction(async (tx) => {
      await tx.channel.update({
        where: { id: channel.id },
        data: { archivedAt: new Date() },
      });
    });

    for (const memberId of memberIds) {
      this.realtime.emitToUser(memberId, WsServerEvent.CONVERSATION_REMOVED, {
        conversationId: channel.id,
        reason: 'dissolved',
      });
    }
    this.logger.log(`群聊已解散归档（channel=${channel.id}, by=${user.handle}, members=${memberIds.length}）`);
    return { archived: true };
  }

  /** POST /conversations/:id/members：仅群聊 moderator 可加人 */
  async addMembers(
    user: AuthUser,
    conversationId: string,
    dto: AddConversationMembersDto,
  ): Promise<ConversationView> {
    const { channel, member, memberIds } = await this.resolve(user, conversationId);
    this.assertRule(
      canAddConversationMembers(this.headerOf(channel, memberIds), user.id, member.role),
    );

    const existing = new Set(memberIds);
    const additions = [...new Set(dto.userIds)].filter((id) => !existing.has(id));
    if (additions.length > 0) {
      this.assertRule(checkGroupMemberGrowth(memberIds, additions));
      await this.assertUsersJoinable(additions);
      await this.prisma.channelMember.createMany({
        data: additions.map((userId) => ({ channelId: channel.id, userId, role: 'member' })),
        skipDuplicates: true,
      });
      // 新成员拿到 conversation:created（否则其侧栏不会出现该会话）
      await this.emitConversation(additions, WsServerEvent.CONVERSATION_CREATED, channel);
    }
    // 既有成员收到成员变化
    await this.emitConversation(memberIds, WsServerEvent.CONVERSATION_UPDATED, channel);
    return this.viewFor(user.id, channel);
  }

  /**
   * DELETE /conversations/:id/members/:userId：本人退出 / moderator 移除。
   * DM 退出时清空 dm_key（会话行保留、旧历史对留下的一方可见，契约 v1.2 §D4；
   * 幂等槽位释放，之后同一对人可重新发起新私聊）。
   */
  async removeMember(
    user: AuthUser,
    conversationId: string,
    targetUserId: string,
  ): Promise<{ conversationId: string; userId: string; reason: 'left' | 'removed' }> {
    const { channel, member, memberIds } = await this.resolve(user, conversationId);
    this.assertRule(
      canRemoveConversationMember(
        this.headerOf(channel, memberIds),
        user.id,
        targetUserId,
        member.role,
      ),
    );
    if (!memberIds.includes(targetUserId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '目标用户不在该会话中', {
        userId: targetUserId,
      });
    }

    const reason: 'left' | 'removed' = targetUserId === user.id ? 'left' : 'removed';
    await this.prisma.withTransaction(async (tx) => {
      await tx.channelMember.delete({
        where: { channelId_userId: { channelId: channel.id, userId: targetUserId } },
      });
      if (channel.kind === 'dm') {
        // 释放幂等槽位，允许同一对人重新发起（契约 v1.2 §D4「重新发起需要新建」）
        await tx.channel.update({ where: { id: channel.id }, data: { dmKey: null } });
      }
    });

    const remaining = memberIds.filter((id) => id !== targetUserId);
    this.realtime.emitToUser(targetUserId, WsServerEvent.CONVERSATION_REMOVED, {
      conversationId: channel.id,
      reason,
    });
    if (remaining.length > 0) {
      await this.emitConversation(remaining, WsServerEvent.CONVERSATION_UPDATED, channel);
    }
    this.logger.log(`会话成员移除（channel=${channel.id}, user=${targetUserId}, ${reason}）`);
    return { conversationId: channel.id, userId: targetUserId, reason };
  }

  // ── 内部 ─────────────────────────────────────────────────────────────────

  /** 会话解析：只认 kind=dm/group 且调用方是成员；否则 CONVERSATION_NOT_FOUND */
  private async resolve(
    user: AuthUser,
    conversationId: string,
  ): Promise<{
    channel: ConversationRow;
    member: { role: ChannelRole };
    memberIds: string[];
  }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
      throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
    }
    const channel = await this.prisma.channel.findUnique({
      where: { id: conversationId },
      select: CONVERSATION_SELECT,
    });
    if (
      !channel ||
      channel.kind === 'channel' ||
      (channel.surface !== 'internal' && !(channel.surface === 'bridge' && channel.kind === 'dm')) ||
      channel.archivedAt !== null
    ) {
      throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
    }
    const member = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId: user.id } },
      select: { role: true },
    });
    if (!member) {
      // 契约 v1.2 §D1：DM/群聊仅成员可读，owner/admin 不可越权
      throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
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
      if (!friendship) {
        throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
      }
    }
    const members = await this.prisma.channelMember.findMany({
      where: { channelId: channel.id },
      select: { userId: true },
    });
    return { channel, member, memberIds: members.map((row) => row.userId) };
  }

  private headerOf(channel: ConversationRow, memberIds: readonly string[]) {
    return {
      id: channel.id,
      kind: channel.kind as ConversationKind,
      memberIds,
    };
  }

  private assertRule(check: ConversationCheck): void {
    if (check.ok) return;
    throw new AppError(check.code, check.reason);
  }

  /** 目标用户必须存在且未封禁（群聊建群/加人） */
  private async assertUsersJoinable(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, status: true, isInternal: true },
    });
    const found = new Map(users.map((row) => [row.id, row]));
    const missing = [...new Set(userIds)].filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '存在不存在的用户', { userIds: missing });
    }
    const suspended = [...new Set(userIds)].filter((id) => found.get(id)?.status === 'suspended');
    if (suspended.length > 0) {
      throw new AppError(ErrorCode.FORBIDDEN, '存在被封禁的用户', { userIds: suspended });
    }
    const external = [...new Set(userIds)].filter((id) => !found.get(id)?.isInternal);
    if (external.length > 0) {
      throw new AppError(ErrorCode.FORBIDDEN, '内部会话不能包含环带账号', { userIds: external });
    }
  }

  private async ensureMembers(channelId: string, userIds: readonly string[]): Promise<void> {
    await this.prisma.channelMember.createMany({
      data: [...new Set(userIds)].map((userId) => ({ channelId, userId })),
      skipDuplicates: true,
    });
  }

  /** 单个成员视角的完整会话视图 */
  private async viewFor(userId: string, channel: ConversationRow): Promise<ConversationView> {
    const views = await this.loadViews(userId, [channel]);
    const view = views.get(channel.id);
    if (!view) throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
    return view;
  }

  /** 按接收者逐个计算视图（unreadCount / myRole 因人而异）后推 user:<id> 房间 */
  private async emitConversation(
    memberIds: readonly string[],
    event: string,
    channel: ConversationRow,
  ): Promise<void> {
    for (const memberId of new Set(memberIds)) {
      let view: ConversationView | undefined;
      try {
        view = (await this.loadViews(memberId, [channel])).get(channel.id);
      } catch (error) {
        this.logger.warn(
          `会话事件视图构建失败（channel=${channel.id}, user=${memberId}）: ${(error as Error).message}`,
        );
      }
      if (view) this.realtime.emitToUser(memberId, event, { conversation: view });
    }
  }

  /**
   * 批量构建会话视图：成员、角色、对方、最后一条消息摘要、未读数。
   * 未读数沿用契约 §3 口径：count(id > last_read_seq AND deleted_at IS NULL AND sender <> me)。
   */
  private async loadViews(
    viewerId: string,
    channels: readonly ConversationRow[],
  ): Promise<Map<string, ConversationView>> {
    const result = new Map<string, ConversationView>();
    if (channels.length === 0) return result;
    const channelIds = channels.map((channel) => channel.id);

    const [members, lastGroups] = await Promise.all([
      this.prisma.channelMember.findMany({
        where: { channelId: { in: channelIds } },
        orderBy: [{ joinedAt: 'asc' }],
        select: {
          channelId: true,
          userId: true,
          role: true,
          lastReadSeq: true,
          joinedAt: true,
        },
      }),
      // 每个会话最后一条消息：先 groupBy 取 max(id)，再按 id 回表（避免 DISTINCT ON 与 orderBy 的方言耦合）
      this.prisma.message.groupBy({
        by: ['channelId'],
        where: { channelId: { in: channelIds }, deletedAt: null },
        _max: { id: true },
      }),
    ]);

    const lastIds = lastGroups
      .map((row) => row._max.id)
      .filter((id): id is bigint => id !== null);
    const lastMessages =
      lastIds.length === 0
        ? []
        : await this.prisma.message.findMany({
            where: { id: { in: lastIds } },
            select: { channelId: true, body: true, createdAt: true },
          });

    const memberIds = [...new Set(members.map((row) => row.userId))];
    const users =
      memberIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: memberIds } },
            select: { id: true, handle: true, displayName: true, avatarFileId: true },
          });
    const userMap = new Map(users.map((user) => [user.id, user]));
    const membersByChannel = new Map<string, typeof members>();
    for (const row of members) {
      const list = membersByChannel.get(row.channelId) ?? [];
      list.push(row);
      membersByChannel.set(row.channelId, list);
    }
    const lastMessageByChannel = new Map(lastMessages.map((row) => [row.channelId, row]));

    const unreadEntries = await Promise.all(
      channels.map(async (channel) => {
        const mine = members.find(
          (row) => row.channelId === channel.id && row.userId === viewerId,
        );
        if (!mine) return [channel.id, 0] as const;
        const unread = await this.prisma.message.count({
          where: {
            channelId: channel.id,
            id: { gt: mine.lastReadSeq },
            deletedAt: null,
            senderId: { not: viewerId },
          },
        });
        return [channel.id, unread] as const;
      }),
    );
    const unreadMap = new Map(unreadEntries);

    for (const channel of channels) {
      const rows = membersByChannel.get(channel.id) ?? [];
      const memberViews: ConversationMemberView[] = rows.map((row) => {
        const info = userMap.get(row.userId);
        return {
          userId: row.userId,
          handle: info?.handle ?? 'unknown',
          displayName: info?.displayName ?? '未知成员',
          avatarFileId: info?.avatarFileId ?? null,
          role: row.role,
          lastReadSeq: row.lastReadSeq.toString(),
          joinedAt: row.joinedAt.toISOString(),
        };
      });
      const mine = memberViews.find((view) => view.userId === viewerId) ?? null;
      const peerRow =
        channel.kind === 'dm' ? rows.find((row) => row.userId !== viewerId) : undefined;
      const peerInfo = peerRow ? userMap.get(peerRow.userId) : undefined;
      const last = lastMessageByChannel.get(channel.id);
      const lastMessageAt = channel.lastMessageAt ?? last?.createdAt ?? null;

      result.set(channel.id, {
        id: channel.id,
        kind: channel.kind as ConversationKind,
        name: channel.name,
        slug: channel.slug,
        members: memberViews,
        peer: peerInfo
          ? {
              userId: peerInfo.id,
              handle: peerInfo.handle,
              displayName: peerInfo.displayName,
              avatarFileId: peerInfo.avatarFileId,
            }
          : null,
        announcement: channel.announcement,
        lastMessageAt: lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: lastMessagePreview(last?.body ?? null),
        unreadCount: unreadMap.get(channel.id) ?? 0,
        myRole: mine?.role ?? null,
        createdAt: channel.createdAt.toISOString(),
        createdBy: channel.createdBy,
        surface: channel.surface,
      });
    }

    // 只为“调用方是成员”的会话返回视图（防御：成员行可能刚被删）
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));
    const visible = new Map<string, ConversationView>();
    for (const [id, view] of result) {
      const channel = channelById.get(id);
      if (!channel) continue;
      const header = this.headerOf(channel, view.members.map((member) => member.userId));
      if (canReadConversation(header, viewerId).ok) visible.set(id, view);
    }
    return visible;
  }
}
