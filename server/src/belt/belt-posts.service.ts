import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdentityService } from '../common/identity/identity.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { clampLimit, decodeKeyCursor, encodeKeyCursor } from '../common/utils/cursor';
import { ExpService, type ExpReason } from '../social/exp.service';
import type { AuthUser } from '../common/types/context';
import type { BeltBoard, CreateBeltPostDto } from './belt.dto';

export interface BeltPostAuthorView {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  prefixes: string[];
}

export interface BeltPostView {
  id: string;
  board: 'bulletin' | 'bounty' | 'daily' | 'telegraph';
  title: string;
  body: string;
  source: 'user' | 'official' | 'rss' | 'system';
  sourceUrl: string | null;
  sourceName: string | null;
  category: 'tech' | 'world' | 'campus' | 'game' | null;
  coverUrl: string | null;
  coverFileId: string | null;
  coverMime: string | null;
  publishedAt: string;
  pinnedAt: string | null;
  status: 'published' | 'hidden' | 'removed';
  bountyStatus: 'open' | 'in_talk' | 'closed' | null;
  bountyReward: string | null;
  bountyDeadline: string | null;
  createdAt: string;
  author: BeltPostAuthorView;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

export interface BeltCommentView {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  author: BeltPostAuthorView;
}

const POST_SELECT = {
  id: true,
  board: true,
  title: true,
  body: true,
  source: true,
  sourceUrl: true,
  sourceName: true,
  category: true,
  coverUrl: true,
  coverFileId: true,
  coverMime: true,
  publishedAt: true,
  pinnedAt: true,
  status: true,
  bountyStatus: true,
  bountyReward: true,
  bountyDeadline: true,
  createdAt: true,
  author: { select: { id: true, handle: true, displayName: true, avatarFileId: true } },
  _count: { select: { likes: true, comments: true } },
} satisfies Prisma.PostSelect;

type PostRow = Prisma.PostGetPayload<{ select: typeof POST_SELECT }>;

@Injectable()
export class BeltPostsService {
  private readonly logger = new Logger(BeltPostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly exp: ExpService,
  ) {}

  async list(
    viewer: AuthUser | null,
    board: BeltBoard,
    limit: number,
    cursor?: string,
  ): Promise<{ posts: BeltPostView[]; nextCursor: string | null }> {
    const take = clampLimit(limit, 30, 50);
    let cursorFilter: Prisma.PostWhereInput = {};
    if (cursor) {
      const [msRaw, id] = decodeKeyCursor(cursor, 2) as [string, string];
      const date = new Date(Number(msRaw));
      if (!/^\d{10,16}$/.test(msRaw) || Number.isNaN(date.getTime())) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '游标格式非法', { field: 'cursor' });
      }
      cursorFilter = {
        OR: [{ publishedAt: { lt: date } }, { publishedAt: date, id: { lt: id } }],
      };
    }

    const rows = await this.prisma.post.findMany({
      where: {
        surface: 'belt',
        board,
        status: 'published',
        deletedAt: null,
        ...cursorFilter,
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: POST_SELECT,
    });
    const page = rows.slice(0, take);
    const liked = await this.likedSet(viewer, page.map((row) => row.id));
    const prefixes = await this.authorPrefixes(page);
    const nextCursor =
      rows.length > take && page.length > 0
        ? encodeKeyCursor([
            page[page.length - 1]!.publishedAt.getTime(),
            page[page.length - 1]!.id,
          ])
        : null;

    return {
      posts: page.map((row) => this.toView(row, viewer, liked, prefixes)),
      nextCursor,
    };
  }

  async get(viewer: AuthUser | null, postId: string): Promise<BeltPostView> {
    const row = await this.prisma.post.findFirst({
      where: {
        id: this.postId(postId),
        surface: 'belt',
        status: 'published',
        deletedAt: null,
      },
      select: POST_SELECT,
    });
    if (!row) throw new AppError(ErrorCode.VALIDATION_FAILED, '帖子不存在', { postId });
    const liked = await this.likedSet(viewer, [row.id]);
    const prefixes = await this.authorPrefixes([row]);
    return this.toView(row, viewer, liked, prefixes);
  }

  async create(user: AuthUser, dto: CreateBeltPostDto): Promise<BeltPostView> {
    if (dto.board === 'bulletin' && user.globalRole !== 'owner' && user.globalRole !== 'admin') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅协议官可发布环带快报');
    }
    const deadline = dto.bountyDeadline ? new Date(dto.bountyDeadline) : null;
    if (deadline && Number.isNaN(deadline.getTime())) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '截止时间格式非法', {
        field: 'bountyDeadline',
      });
    }
    if (dto.coverFileId) {
      const file = await this.prisma.file.findFirst({
        where: { id: dto.coverFileId, ownerId: user.id, status: 'ready', kind: 'image' },
        select: { id: true },
      });
      if (!file) throw new AppError(ErrorCode.FILE_NOT_READY, '封面图片未就绪或不属于你');
    }
    const row = await this.prisma.post.create({
      data: {
        authorId: user.id,
        surface: 'belt',
        board: dto.board,
        // 【干员日常】允许像朋友圈一样只发纯文字：缺标题时取正文首行。
        title: (dto.title?.trim() || dto.body.trim().split(/\r?\n/)[0] || '未命名日常信号').slice(0, 120),
        body: dto.body,
        coverUrl: dto.coverUrl ?? null,
        coverFileId: dto.coverFileId ?? null,
        coverMime: dto.coverMime ?? null,
        source: dto.board === 'bulletin' ? 'official' : 'user',
        publishedAt: new Date(),
        bountyStatus: dto.board === 'bounty' ? 'open' : null,
        bountyReward: dto.board === 'bounty' ? dto.bountyReward ?? null : null,
        bountyDeadline: dto.board === 'bounty' ? deadline : null,
      },
      select: POST_SELECT,
    });
    const prefixes = await this.authorPrefixes([row]);
    await this.awardQuietly(row.author.id, 'post', 'post', row.id, `post:${row.id}`);
    return this.toView(row, user, new Set(), prefixes);
  }

  async like(user: AuthUser, postId: string): Promise<{ liked: true; likeCount: number }> {
    const post = await this.visiblePost(postId);
    await this.prisma.postLike.createMany({
      data: [{ postId: post.id, userId: user.id }],
      skipDuplicates: true,
    });
    await this.awardQuietly(
      post.authorId,
      'like_received',
      'post',
      post.id,
      `like:${post.id}:${user.id}`,
    );
    return { liked: true, likeCount: await this.prisma.postLike.count({ where: { postId: post.id } }) };
  }

  async unlike(user: AuthUser, postId: string): Promise<{ liked: false; likeCount: number }> {
    const post = await this.visiblePost(postId);
    await this.prisma.postLike.deleteMany({ where: { postId: post.id, userId: user.id } });
    return { liked: false, likeCount: await this.prisma.postLike.count({ where: { postId: post.id } }) };
  }

  async comments(
    postId: string,
    limit = 50,
  ): Promise<{ comments: BeltCommentView[] }> {
    const post = await this.visiblePost(postId);
    const rows = await this.prisma.postComment.findMany({
      where: { postId: post.id, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: clampLimit(limit, 50, 100),
      select: {
        id: true,
        postId: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, handle: true, displayName: true, avatarFileId: true } },
      },
    });
    return { comments: await this.commentViews(rows) };
  }

  async addComment(user: AuthUser, postId: string, body: string): Promise<BeltCommentView> {
    const post = await this.visiblePost(postId);
    const row = await this.prisma.postComment.create({
      data: { postId: post.id, authorId: user.id, body },
      select: {
        id: true,
        postId: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, handle: true, displayName: true, avatarFileId: true } },
      },
    });
    await this.awardQuietly(row.author.id, 'comment', 'comment', row.id, `comment:${row.id}`);
    return (await this.commentViews([row]))[0]!;
  }

  /** 把电文分享到默认环带频道：创建 Card + card message。 */
  async share(user: AuthUser, postId: string, channelId?: string): Promise<{ channelId: string; messageId: string }> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, surface: 'belt', status: 'published', deletedAt: null },
      select: { id: true, title: true, body: true, sourceName: true, category: true },
    });
    if (!post) throw new AppError(ErrorCode.VALIDATION_FAILED, '帖子不存在', { postId });
    const channel = channelId
      ? await this.prisma.channel.findFirst({
          where: {
            id: channelId,
            surface: 'belt',
            kind: 'channel',
            visibility: 'public',
            archivedAt: null,
          },
          select: { id: true },
        })
      : await this.prisma.channel.findFirst({
          where: { surface: 'belt', kind: 'channel', slug: 'belt-channel', archivedAt: null },
          select: { id: true },
        });
    if (!channel) throw new AppError(ErrorCode.CHANNEL_NOT_FOUND, '环带频道不存在');
    const clientMsgId = randomUUID();
    const message = await this.prisma.withTransaction(async (tx) => {
      const card = await tx.card.create({
        data: {
          channelId: channel.id,
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
          createdBy: user.id,
        },
        select: { id: true },
      });
      const created = await tx.message.create({
        data: {
          channelId: channel.id,
          senderId: user.id,
          kind: 'card',
          body: null,
          clientMsgId,
          cardId: card.id,
        },
        select: { id: true },
      });
      await tx.channel.update({ where: { id: channel.id }, data: { lastMessageAt: new Date() } });
      return created;
    });
    return { channelId: channel.id, messageId: message.id.toString() };
  }

  async remove(user: AuthUser, postId: string): Promise<{ deleted: true }> {
    const post = await this.visiblePost(postId);
    if (post.authorId !== user.id && user.globalRole !== 'owner' && user.globalRole !== 'admin') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅作者或协议官可删除该帖');
    }
    await this.prisma.post.update({ where: { id: post.id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  private async visiblePost(postId: string): Promise<{ id: string; authorId: string }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '帖子不存在', { postId });
    }
    const post = await this.prisma.post.findFirst({
      where: {
        id: postId,
        surface: 'belt',
        status: 'published',
        deletedAt: null,
      },
      select: { id: true, authorId: true },
    });
    if (!post) throw new AppError(ErrorCode.VALIDATION_FAILED, '帖子不存在', { postId });
    return post;
  }

  private postId(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '帖子不存在', { postId: id });
    }
    return id;
  }

  /** EXP 钩子：奖励失败只 warn，绝不影响发帖/评论/点赞主流程 */
  private async awardQuietly(
    userId: string,
    reason: ExpReason,
    refType: string,
    refId: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      await this.exp.award(userId, reason, { refType, refId, idempotencyKey });
    } catch (error) {
      this.logger.warn(`EXP 钩子失败（${reason}）：${(error as Error).message}`);
    }
  }

  private async likedSet(viewer: AuthUser | null, postIds: string[]): Promise<Set<string>> {
    if (!viewer || postIds.length === 0) return new Set();
    const rows = await this.prisma.postLike.findMany({
      where: { userId: viewer.id, postId: { in: postIds } },
      select: { postId: true },
    });
    return new Set(rows.map((row) => row.postId));
  }

  private async authorPrefixes(rows: PostRow[]): Promise<Record<string, string[]>> {
    const ids = [...new Set(rows.map((row) => row.author.id))];
    if (ids.length === 0) return {};
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, tags: true, globalRole: true },
    });
    return this.identity.prefixesForMany(users);
  }

  private toView(
    row: PostRow,
    viewer: AuthUser | null,
    liked: Set<string>,
    prefixes: Record<string, string[]>,
  ): BeltPostView {
    return {
      id: row.id,
      board: row.board as BeltPostView['board'],
      title: row.title ?? '',
      body: row.body,
      source: row.source,
      sourceUrl: row.sourceUrl,
      sourceName: row.sourceName,
      category: row.category,
      coverUrl: row.coverUrl,
      coverFileId: row.coverFileId,
      coverMime: row.coverMime,
      publishedAt: row.publishedAt.toISOString(),
      pinnedAt: row.pinnedAt?.toISOString() ?? null,
      status: row.status,
      bountyStatus: row.bountyStatus,
      bountyReward: row.bountyReward,
      bountyDeadline: row.bountyDeadline?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      author: {
        id: row.author.id,
        handle: row.author.handle,
        displayName: row.author.displayName,
        avatarFileId: row.author.avatarFileId,
        prefixes: prefixes[row.author.id] ?? [],
      },
      likeCount: row._count.likes,
      commentCount: row._count.comments,
      likedByMe: Boolean(viewer && liked.has(row.id)),
    };
  }

  private async commentViews(
    rows: Array<{
      id: string;
      postId: string;
      body: string;
      createdAt: Date;
      author: { id: string; handle: string; displayName: string; avatarFileId: string | null };
    }>,
  ): Promise<BeltCommentView[]> {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((row) => row.author.id))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, tags: true, globalRole: true },
    });
    const prefixes = await this.identity.prefixesForMany(users);
    return rows.map((row) => ({
      id: row.id,
      postId: row.postId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      author: {
        id: row.author.id,
        handle: row.author.handle,
        displayName: row.author.displayName,
        avatarFileId: row.author.avatarFileId,
        prefixes: prefixes[row.author.id] ?? [],
      },
    }));
  }
}
