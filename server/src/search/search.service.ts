import { Injectable } from '@nestjs/common';
import { Prisma, type Card } from '@prisma/client';
import { ChannelAccessService } from '../common/guards/channel-access.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RateLimiterService } from '../common/redis/rate-limiter.service';
import type { AuthUser } from '../common/types/context';
import { clampLimit, decodeSeqCursor, encodeSeqCursor } from '../common/utils/cursor';
import type { MessageView } from '../common/utils/message-view';
import { toMessageView } from '../common/utils/message-view';
import { isGlobalAdmin } from '../common/utils/permissions';
import type { ChannelSearchQuery, SearchQuery } from './search.dto';

interface MessageSearchRow {
  id: bigint;
  channel_id: string;
  sender_id: string;
  kind: string;
  body: string | null;
  client_msg_id: string;
  parent_id: bigint | null;
  thread_root_id: bigint | null;
  reply_to_id: bigint | null;
  card_id: string | null;
  mentions: string[];
  thread_reply_count: number;
  last_reply_at: Date | null;
  edited_at: Date | null;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Date;
}

export interface CardSearchHit {
  id: string;
  channelId: string;
  kind: string;
  title: string;
  snippet: string | null;
  tags: string[];
  status: string;
  updatedAt: string;
}

/**
 * 搜索（契约 §7 search）：
 * - 消息：tsvector（simple 配置）+ pg_trgm 中文子串兜底，权限在 SQL 层过滤；
 * - 卡片：标题/正文 ILIKE + 标签精确匹配，先取可见频道再过滤。
 * 私密频道对 owner/admin 默认不可见（契约 §4 规则 2），因此 admin 的 SQL 兜底只放开 public 频道。
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async search(user: AuthUser, query: SearchQuery) {
    await this.rateLimiter.assertSearch(user.id);
    if (query.channelId) {
      await this.channelAccess.assert(query.channelId, user, 'read');
    }
    const limit = clampLimit(query.limit, 30);

    const messages =
      query.type === 'card'
        ? []
        : await this.searchMessages(user, query.q, query.channelId ?? null, query.cursor, limit);
    const cards =
      query.type === 'message' ? [] : await this.searchCards(user, query.q, query.channelId ?? null, limit);

    const last = messages[messages.length - 1];
    return {
      messages,
      cards,
      nextCursor: messages.length === limit && last ? encodeSeqCursor(last.id) : null,
    };
  }

  async searchInChannel(user: AuthUser, channelId: string, query: ChannelSearchQuery) {
    await this.rateLimiter.assertSearch(user.id);
    await this.channelAccess.assert(channelId, user, 'read');
    const limit = clampLimit(query.limit, 30);
    const [messages, cards] = await Promise.all([
      this.searchMessages(user, query.q, channelId, undefined, limit),
      this.searchCards(user, query.q, channelId, limit),
    ]);
    return { messages, cards };
  }

  private async searchMessages(
    user: AuthUser,
    q: string,
    channelId: string | null,
    cursor: string | undefined,
    limit: number,
  ): Promise<MessageView[]> {
    const isAdmin = isGlobalAdmin(user.globalRole);
    const cursorSeq = cursor ? decodeSeqCursor(cursor) : null;
    const pattern = `%${q}%`;

    const rows = await this.prisma.$queryRaw<MessageSearchRow[]>(Prisma.sql`
      SELECT
        m.id,
        m.channel_id,
        m.sender_id,
        m.kind::text AS kind,
        m.body,
        m.client_msg_id,
        m.parent_id,
        m.thread_root_id,
        m.reply_to_id,
        m.card_id,
        m.mentions::text[] AS mentions,
        m.thread_reply_count,
        m.last_reply_at,
        m.edited_at,
        m.deleted_at,
        m.deleted_by,
        m.created_at
      FROM messages m
      WHERE m.deleted_at IS NULL
        AND (m.search_vector @@ plainto_tsquery('simple', ${q}) OR m.body ILIKE ${pattern})
        ${channelId ? Prisma.sql`AND m.channel_id = ${channelId}::uuid` : Prisma.empty}
        ${cursorSeq !== null ? Prisma.sql`AND m.id < ${cursorSeq}::bigint` : Prisma.empty}
        AND (
          EXISTS (
            SELECT 1 FROM channel_members cm
            WHERE cm.channel_id = m.channel_id AND cm.user_id = ${user.id}::uuid
          )
          ${
            isAdmin
              ? Prisma.sql`OR EXISTS (
                  SELECT 1 FROM channels c
                  WHERE c.id = m.channel_id AND c.visibility = 'public'
                )`
              : Prisma.empty
          }
        )
      ORDER BY m.id DESC
      LIMIT ${limit}
    `);

    return rows.map((row) =>
      toMessageView({
        id: row.id,
        channelId: row.channel_id,
        senderId: row.sender_id,
        kind: row.kind,
        body: row.body,
        clientMsgId: row.client_msg_id,
        parentId: row.parent_id,
        threadRootId: row.thread_root_id,
        replyToId: row.reply_to_id,
        cardId: row.card_id,
        mentions: row.mentions,
        threadReplyCount: row.thread_reply_count,
        lastReplyAt: row.last_reply_at,
        editedAt: row.edited_at,
        deletedAt: row.deleted_at,
        deletedBy: row.deleted_by,
        createdAt: row.created_at,
      }),
    );
  }

  private async searchCards(
    user: AuthUser,
    q: string,
    channelId: string | null,
    limit: number,
  ): Promise<CardSearchHit[]> {
    const channelIds = channelId ? [channelId] : await this.accessibleChannelIds(user);
    if (channelIds.length === 0) return [];

    const cards = await this.prisma.card.findMany({
      where: {
        channelId: { in: channelIds },
        deletedAt: null,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { body: { contains: q, mode: 'insensitive' } },
          { tags: { has: q } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return cards.map((card) => this.toCardHit(card, q));
  }

  /** 可见频道 id：我加入的全部频道；owner/admin 追加全部公开频道 */
  private async accessibleChannelIds(user: AuthUser): Promise<string[]> {
    const memberships = await this.prisma.channelMember.findMany({
      where: { userId: user.id },
      select: { channelId: true },
    });
    const internalChannels = await this.prisma.channel.findMany({
      where: {
        id: { in: memberships.map((member) => member.channelId) },
        surface: 'internal',
      },
      select: { id: true },
    });
    const ids = new Set(internalChannels.map((channel) => channel.id));
    if (isGlobalAdmin(user.globalRole)) {
      const publicChannels = await this.prisma.channel.findMany({
        where: { visibility: 'public', surface: 'internal' },
        select: { id: true },
      });
      for (const channel of publicChannels) ids.add(channel.id);
    }
    return [...ids];
  }

  private toCardHit(card: Card, q: string): CardSearchHit {
    const body = card.body ?? '';
    const index = body.toLowerCase().indexOf(q.toLowerCase());
    const snippet =
      index >= 0
        ? body.slice(Math.max(0, index - 30), Math.min(body.length, index + q.length + 60))
        : body.slice(0, 90) || null;
    return {
      id: card.id,
      channelId: card.channelId,
      kind: card.kind,
      title: card.title,
      snippet,
      tags: card.tags,
      status: card.status,
      updatedAt: card.updatedAt.toISOString(),
    };
  }
}
