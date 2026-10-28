import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdentityService } from '../common/identity/identity.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { BeltRealtimeService } from './belt-realtime.service';
import { toMessageView } from '../common/utils/message-view';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { dmKeyOf, dmSlugOf } from '../conversations/conversation-rules';
import { BeltImService } from './belt-im.service';
import type { AuthUser } from '../common/types/context';

export interface BeltDmConversationView {
  id: string;
  channelId: string;
  surface: 'belt' | 'bridge';
  peer: {
    id: string;
    handle: string;
    displayName: string;
    avatarFileId: string | null;
    prefixes: string[];
  };
  lastMessage: {
    id: string;
    body: string | null;
    senderId: string;
    createdAt: string;
  } | null;
  unread: number;
  updatedAt: string | null;
  /** 兼容旧前端字段 */
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
}

interface DmMessageRow {
  id: bigint;
  channelId: string;
  senderId: string;
  body: string | null;
  createdAt: Date;
  kind: string;
  clientMsgId: string;
  parentId: bigint | null;
  threadRootId: bigint | null;
  replyToId: bigint | null;
  cardId: string | null;
  mentions: string[];
  threadReplyCount: number;
  lastReplyAt: Date | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

/** 环塔私聊：关注即可发起（好友体系已废弃，成员关系即访问权） */
@Injectable()
export class BeltDirectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly realtime: RealtimeService,
    private readonly beltRealtime: BeltRealtimeService,
    private readonly im: BeltImService,
  ) {}

  /** 关注即可私聊：dm_key = 排序后的两个 userId，已存在直接返回 */
  async create(actor: AuthUser, handle: string): Promise<{ channelId: string; created: boolean }> {
    const target = await this.prisma.user.findUnique({
      where: { handle },
      select: { id: true, displayName: true, status: true },
    });
    if (!target) throw new AppError(ErrorCode.USER_NOT_FOUND, '用户不存在');
    if (target.id === actor.id) throw new AppError(ErrorCode.VALIDATION_FAILED, '不能和自己私信');
    if (target.status === 'suspended') throw new AppError(ErrorCode.FORBIDDEN, '对方已被封禁');
    // 拉黑：任一方向存在即拒绝建链（模块六）
    if (await this.im.hasBlockBetween(actor.id, target.id)) {
      throw new AppError(ErrorCode.FORBIDDEN, '对方已拒绝与你建立链路');
    }

    const follow = await this.prisma.follow.findFirst({
      where: {
        OR: [
          { followerId: actor.id, followingId: target.id },
          { followerId: target.id, followingId: actor.id },
        ],
      },
      select: { id: true },
    });
    if (!follow) throw new AppError(ErrorCode.FORBIDDEN, '先关注对方才能私信');

    const dmKey = dmKeyOf(actor.id, target.id);
    // dm_key 唯一确定一对用户；已有 DM（含 bridge）直接复用
    const existing = await this.prisma.channel.findFirst({
      where: { dmKey, kind: 'dm' },
      select: { id: true },
    });
    if (existing) return { channelId: existing.id, created: false };

    try {
      const created = await this.prisma.withTransaction(async (tx) => {
        const channel = await tx.channel.create({
          data: {
            name: target.displayName.slice(0, 60),
            slug: dmSlugOf(dmKey, 'belt'),
            visibility: 'private',
            kind: 'dm',
            surface: 'belt',
            dmKey,
            createdBy: actor.id,
          },
          select: { id: true },
        });
        await tx.channelMember.createMany({
          data: [
            { channelId: channel.id, userId: actor.id },
            { channelId: channel.id, userId: target.id },
          ],
          skipDuplicates: true,
        });
        return channel;
      });
      return { channelId: created.id, created: true };
    } catch (error) {
      // 并发建同一条 DM：dm_key 唯一索引兜底，冲突后读回既有会话。
      if (!PrismaService.isUniqueViolation(error)) throw error;
      const raced = await this.prisma.channel.findFirst({
        where: { dmKey, kind: 'dm' },
        select: { id: true },
      });
      if (!raced) throw error;
      return { channelId: raced.id, created: false };
    }
  }

  async list(actor: AuthUser): Promise<{ conversations: BeltDmConversationView[] }> {
    const memberships = await this.prisma.channelMember.findMany({
      where: {
        userId: actor.id,
        channel: { kind: 'dm', surface: 'belt', archivedAt: null },
      },
      orderBy: { channel: { lastMessageAt: 'desc' } },
      select: {
        lastReadSeq: true,
        channel: { select: { id: true, surface: true, lastMessageAt: true } },
      },
    });

    const conversations: BeltDmConversationView[] = [];
    for (const membership of memberships) {
      const channel = membership.channel;
      const peerMember = await this.prisma.channelMember.findFirst({
        where: { channelId: channel.id, userId: { not: actor.id } },
        select: {
          user: {
            select: {
              id: true,
              handle: true,
              displayName: true,
              avatarFileId: true,
              tags: true,
              globalRole: true,
            },
          },
        },
      });
      if (!peerMember) continue;
      const peer = peerMember.user;
      const [last, unread, prefixes] = await Promise.all([
        this.prisma.message.findFirst({
          where: { channelId: channel.id, deletedAt: null },
          orderBy: { id: 'desc' },
          select: { id: true, body: true, senderId: true, createdAt: true },
        }),
        this.prisma.message.count({
          where: {
            channelId: channel.id,
            deletedAt: null,
            senderId: { not: actor.id },
            id: { gt: membership.lastReadSeq },
          },
        }),
        this.identity.prefixesForMany([peer]),
      ]);
      const lastMessage = last
        ? {
            id: last.id.toString(),
            body: last.body,
            senderId: last.senderId,
            createdAt: last.createdAt.toISOString(),
          }
        : null;
      const updatedAt = last?.createdAt.toISOString() ?? channel.lastMessageAt?.toISOString() ?? null;
      conversations.push({
        id: channel.id,
        channelId: channel.id,
        surface: channel.surface as 'belt' | 'bridge',
        peer: {
          id: peer.id,
          handle: peer.handle,
          displayName: peer.displayName,
          avatarFileId: peer.avatarFileId,
          prefixes: prefixes[peer.id] ?? [],
        },
        lastMessage,
        unread,
        updatedAt,
        lastMessageAt: updatedAt,
        lastMessagePreview: last?.body ? last.body.slice(0, 80) : null,
        unreadCount: unread,
      });
    }
    return { conversations };
  }

  async messages(
    actor: AuthUser,
    channelId: string,
  ): Promise<{ messages: Array<ReturnType<typeof toMessageView> & { card?: unknown }> }> {
    await this.access(actor, channelId);
    const cleared = await this.prisma.directClear.findUnique({
      where: { channelId_userId: { channelId, userId: actor.id } },
      select: { clearedAt: true },
    });
    // 单用户隐藏：只影响自己的列表
    const hidden = await this.prisma.messageHide.findMany({
      where: { userId: actor.id, message: { channelId } },
      select: { messageId: true },
    });
    const hiddenIds = hidden.map((row) => row.messageId);
    const rows = await this.prisma.message.findMany({
      where: {
        channelId,
        deletedAt: null,
        ...(cleared ? { createdAt: { gt: cleared.clearedAt } } : {}),
        ...(hiddenIds.length ? { id: { notIn: hiddenIds } } : {}),
      },
      orderBy: { id: 'desc' },
      take: 100,
      select: {
        id: true,
        channelId: true,
        senderId: true,
        body: true,
        kind: true,
        clientMsgId: true,
        parentId: true,
        threadRootId: true,
        replyToId: true,
        cardId: true,
        mentions: true,
        threadReplyCount: true,
        lastReplyAt: true,
        editedAt: true,
        deletedAt: true,
        deletedBy: true,
        createdAt: true,
      },
    });
    const ordered = rows.reverse();
    const cardIds = [
      ...new Set(ordered.map((row) => row.cardId).filter((id): id is string => Boolean(id))),
    ];
    const cards = cardIds.length
      ? await this.prisma.card.findMany({
          where: { id: { in: cardIds }, deletedAt: null },
          select: { id: true, title: true, body: true, data: true },
        })
      : [];
    const cardMap = new Map(cards.map((card) => [card.id, card]));
    // @提及呼号（批量解析）
    const mentionIds = [...new Set(ordered.flatMap((row) => row.mentions))];
    const mentionHandles = await this.im.mentionHandleMap(mentionIds);
    return {
      messages: ordered.map((row) => ({
        ...toMessageView(
          row,
          [],
          null,
          row.mentions.map((id) => mentionHandles.get(id)).filter((handle): handle is string => Boolean(handle)),
        ),
        card: row.cardId ? cardMap.get(row.cardId) ?? null : null,
      })),
    };
  }

  async clear(actor: AuthUser, channelId: string): Promise<{ clearedAt: string }> {
    await this.access(actor, channelId);
    const row = await this.prisma.directClear.upsert({
      where: { channelId_userId: { channelId, userId: actor.id } },
      create: { channelId, userId: actor.id },
      update: { clearedAt: new Date() },
      select: { clearedAt: true },
    });
    return { clearedAt: row.clearedAt.toISOString() };
  }

  async deleteMessage(
    actor: AuthUser,
    channelId: string,
    messageId: string,
  ): Promise<{ deleted: true }> {
    await this.access(actor, channelId);
    if (!/^\d+$/.test(messageId)) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在');
    const row = await this.prisma.message.findFirst({
      where: { id: BigInt(messageId), channelId, deletedAt: null },
      select: { id: true, senderId: true },
    });
    if (!row) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在');
    if (row.senderId !== actor.id) throw new AppError(ErrorCode.FORBIDDEN, '只能撤回自己的消息');
    await this.prisma.message.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedBy: actor.id },
    });
    return { deleted: true };
  }

  /** 分享电文到私聊：Card + card message。 */
  async share(
    actor: AuthUser,
    channelId: string,
    postId: string,
  ): Promise<ReturnType<typeof toMessageView> & { card: unknown }> {
    const channel = await this.access(actor, channelId);
    const post = await this.prisma.post.findFirst({
      where: { id: postId, surface: 'belt', status: 'published', deletedAt: null },
      select: { id: true, title: true, body: true, sourceName: true, category: true },
    });
    if (!post) throw new AppError(ErrorCode.VALIDATION_FAILED, '帖子不存在');
    const clientMsgId = randomUUID();
    const row = await this.prisma.withTransaction(async (tx) => {
      const card = await tx.card.create({
        data: {
          channelId,
          kind: 'artwork',
          title: (post.title ?? '未命名电文').slice(0, 120),
          body: (post.body ?? '').replace(/\s+/g, ' ').slice(0, 300),
          data: {
            type: 'news_share',
            postId: post.id,
            url: `/belt/posts/${post.id}`,
            sourceName: post.sourceName,
            category: post.category,
          },
          createdBy: actor.id,
        },
        select: { id: true },
      });
      const created = await tx.message.create({
        data: { channelId, senderId: actor.id, kind: 'card', body: null, clientMsgId, cardId: card.id },
      });
      await tx.channel.update({ where: { id: channelId }, data: { lastMessageAt: created.createdAt } });
      return { created, card };
    });
    const view = {
      ...toMessageView(row.created),
      card: { id: row.card.id, title: post.title, body: null, data: { ...post } },
    };
    await this.emitDm(channel, view);
    return view;
  }

  async send(
    actor: AuthUser,
    channelId: string,
    body: string,
    clientMsgId?: string,
  ): Promise<ReturnType<typeof toMessageView>> {
    const channel = await this.access(actor, channelId);
    const id = clientMsgId ?? randomUUID();
    const mentions = await this.im.resolveMentionIds(channelId, body);
    let row: DmMessageRow;
    try {
      row = await this.prisma.withTransaction(async (tx) => {
        const created = await tx.message.create({
          data: { channelId, senderId: actor.id, kind: 'text', body, clientMsgId: id, mentions },
        });
        await tx.channel.update({ where: { id: channelId }, data: { lastMessageAt: created.createdAt } });
        return created;
      });
    } catch (error) {
      if (!PrismaService.isUniqueViolation(error)) throw error;
      const existing = await this.prisma.message.findFirst({
        where: { channelId, senderId: actor.id, clientMsgId: id },
      });
      if (!existing) throw error;
      row = existing;
    }

    const mentionHandles = await this.im.mentionHandleMap(row.mentions);
    const view = toMessageView(
      row,
      [],
      null,
      row.mentions.map((id) => mentionHandles.get(id)).filter((handle): handle is string => Boolean(handle)),
    );
    await this.emitDm(channel, view);
    return view;
  }

  /** 私聊访问权 = channel_members 成员关系（成员之外一律 404）。 */
  private async access(actor: AuthUser, channelId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, kind: true, surface: true, archivedAt: true },
    });
    if (!channel || channel.kind !== 'dm' || channel.archivedAt) {
      throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
    }
    const member = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: actor.id } },
      select: { userId: true },
    });
    if (!member) throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
    return channel;
  }

  private async emitDm(
    channel: { id: string; surface: string },
    view: ReturnType<typeof toMessageView>,
  ): Promise<void> {
    const members = await this.prisma.channelMember.findMany({
      where: { channelId: channel.id },
      select: { userId: true },
    });
    const payload = { channelId: channel.id, message: view };
    for (const member of members) {
      this.beltRealtime.emitToBeltUser(member.userId, 'belt:dm:message', payload);
    }
    // bridge DM：内部侧需要实时消息。
    if (channel.surface === 'bridge') {
      this.realtime.emitToChannel(channel.id, 'message:new', { message: view });
    }
  }
}
