import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdentityService } from '../common/identity/identity.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { BeltRealtimeService } from '../belt/belt-realtime.service';
import { toMessageView } from '../common/utils/message-view';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';

export interface BeltDmConversationView {
  id: string;
  surface: 'belt' | 'bridge';
  peer: {
    id: string;
    handle: string;
    displayName: string;
    avatarFileId: string | null;
    prefixes: string[];
  };
  friendshipId: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
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

@Injectable()
export class BeltDirectService {
  private readonly logger = new Logger(BeltDirectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly realtime: RealtimeService,
    private readonly beltRealtime: BeltRealtimeService,
  ) {}

  async list(actor: AuthUser): Promise<{ conversations: BeltDmConversationView[] }> {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        dmChannelId: { not: null },
        OR: [{ requesterId: actor.id }, { addresseeId: actor.id }],
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    const conversations: BeltDmConversationView[] = [];
    for (const friendship of friendships) {
      if (!friendship.dmChannelId) continue;
      if (friendship.surface !== 'belt' && friendship.surface !== 'bridge') continue;
      const peerId = friendship.requesterId === actor.id ? friendship.addresseeId : friendship.requesterId;
      const [channel, peer, last] = await Promise.all([
        this.prisma.channel.findFirst({
          where: {
            id: friendship.dmChannelId,
            kind: 'dm',
            surface: friendship.surface,
            archivedAt: null,
          },
          select: { id: true, surface: true, lastMessageAt: true },
        }),
        this.prisma.user.findUnique({
          where: { id: peerId },
          select: { id: true, handle: true, displayName: true, avatarFileId: true, tags: true, globalRole: true },
        }),
        this.prisma.message.findFirst({
          where: { channelId: friendship.dmChannelId, deletedAt: null },
          orderBy: { id: 'desc' },
          select: { body: true },
        }),
      ]);
      if (!channel || !peer) continue;
      const prefixes = await this.identity.prefixesForMany([peer]);
      conversations.push({
        id: channel.id,
        surface: channel.surface as 'belt' | 'bridge',
        peer: {
          id: peer.id,
          handle: peer.handle,
          displayName: peer.displayName,
          avatarFileId: peer.avatarFileId,
          prefixes: prefixes[peer.id] ?? [],
        },
        friendshipId: friendship.id,
        lastMessageAt: channel.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: last?.body ? last.body.slice(0, 80) : null,
      });
    }
    return { conversations };
  }

  async messages(actor: AuthUser, channelId: string): Promise<{ messages: Array<ReturnType<typeof toMessageView> & { card?: unknown }> }> {
    await this.access(actor, channelId);
    const cleared = await this.prisma.directClear.findUnique({
      where: { channelId_userId: { channelId, userId: actor.id } },
      select: { clearedAt: true },
    });
    const rows = await this.prisma.message.findMany({
      where: {
        channelId,
        deletedAt: null,
        ...(cleared ? { createdAt: { gt: cleared.clearedAt } } : {}),
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
    const cardIds = [...new Set(ordered.map((row) => row.cardId).filter((id): id is string => Boolean(id)))];
    const cards = cardIds.length
      ? await this.prisma.card.findMany({
          where: { id: { in: cardIds }, deletedAt: null },
          select: { id: true, title: true, body: true, data: true },
        })
      : [];
    const cardMap = new Map(cards.map((card) => [card.id, card]));
    return {
      messages: ordered.map((row) => ({
        ...toMessageView(row),
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

  async deleteMessage(actor: AuthUser, channelId: string, messageId: string): Promise<{ deleted: true }> {
    await this.access(actor, channelId);
    if (!/^\d+$/.test(messageId)) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在');
    const row = await this.prisma.message.findFirst({
      where: { id: BigInt(messageId), channelId, deletedAt: null },
      select: { id: true, senderId: true },
    });
    if (!row) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在');
    if (row.senderId !== actor.id) throw new AppError(ErrorCode.FORBIDDEN, '只能撤回自己的消息');
    await this.prisma.message.update({ where: { id: row.id }, data: { deletedAt: new Date(), deletedBy: actor.id } });
    return { deleted: true };
  }

  /** 分享电文到私聊：Card + card message。 */
  async share(actor: AuthUser, channelId: string, postId: string): Promise<ReturnType<typeof toMessageView> & { card: unknown }> {
    const friendship = await this.access(actor, channelId);
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
    this.beltRealtime.emitToBeltUser(friendship.requesterId, 'belt:dm:message', { channelId, message: view });
    this.beltRealtime.emitToBeltUser(friendship.addresseeId, 'belt:dm:message', { channelId, message: view });
    return view;
  }

  async send(
    actor: AuthUser,
    channelId: string,
    body: string,
    clientMsgId?: string,
  ): Promise<ReturnType<typeof toMessageView>> {
    const friendship = await this.access(actor, channelId);
    const id = clientMsgId ?? randomUUID();
    let row: DmMessageRow;
    try {
      row = await this.prisma.withTransaction(async (tx) => {
        const created = await tx.message.create({
          data: { channelId, senderId: actor.id, kind: 'text', body, clientMsgId: id },
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

    const view = toMessageView(row);
    this.beltRealtime.emitToBeltUser(friendship.requesterId, 'belt:dm:message', { channelId, message: view });
    this.beltRealtime.emitToBeltUser(friendship.addresseeId, 'belt:dm:message', { channelId, message: view });
    // bridge DM：内部侧需要实时消息。
    if (friendship.surface === 'bridge') {
      this.realtime.emitToChannel(channelId, 'message:new', { message: view });
    }
    return view;
  }

  private async access(actor: AuthUser, channelId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        dmChannelId: channelId,
        status: 'accepted',
        surface: { in: ['belt', 'bridge'] },
        OR: [{ requesterId: actor.id }, { addresseeId: actor.id }],
      },
    });
    if (!friendship) throw new AppError(ErrorCode.FRIENDSHIP_REQUIRED);
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, kind: true, surface: true, archivedAt: true },
    });
    if (!channel || channel.kind !== 'dm' || channel.archivedAt) {
      throw new AppError(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在或已不可见');
    }
    return friendship;
  }
}
