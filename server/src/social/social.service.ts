import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import { ExpService } from './exp.service';
import { EXP_REWARDS, MAX_LEVEL, levelOf, progressOf } from './level';

/** 风纪委员身份标签（固定字符串，不带方括号） */
export const CLERK_TAG = '风纪委员';

export interface UserCard {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  tags: string[];
  level: number;
  isFollowing: boolean;
}

export interface PostSummary {
  id: string;
  title: string | null;
  body: string;
  board: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  coverFileId: string | null;
}

const CARD_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  avatarFileId: true,
  tags: true,
  exp: true,
} satisfies Prisma.UserSelect;

type CardRow = Prisma.UserGetPayload<{ select: typeof CARD_SELECT }>;

const SUMMARY_SELECT = {
  id: true,
  title: true,
  body: true,
  board: true,
  createdAt: true,
  coverFileId: true,
  _count: { select: { likes: true, comments: true } },
} satisfies Prisma.PostSelect;

type SummaryRow = Prisma.PostGetPayload<{ select: typeof SUMMARY_SELECT }>;

const SEARCH_LIMIT = 12;

/** 帖子游标 = base64url(`${createdAt.toISOString()}|${id}`)，不透明 */
function encodePostsCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodePostsCursor(cursor: string): { createdAt: Date; id: string } {
  const invalid = (): AppError =>
    new AppError(ErrorCode.VALIDATION_FAILED, '游标格式非法', { field: 'cursor' });
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!iso || !id) throw invalid();
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) throw invalid();
  return { createdAt, id };
}

/** 上海时区的日历日（登录奖励按此日切分），格式 YYYY-MM-DD */
export function shanghaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exp: ExpService,
  ) {}

  /** 唯一呼号搜索：handle 前缀优先，displayName 兜底，固定 12 条 */
  async search(viewer: AuthUser, q: string): Promise<{ users: UserCard[] }> {
    const term = q.trim();
    if (term.length === 0) return { users: [] };

    const prefixRows = await this.prisma.user.findMany({
      where: { status: 'active', handle: { startsWith: term, mode: 'insensitive' } },
      orderBy: { handle: 'asc' },
      take: SEARCH_LIMIT,
      select: CARD_SELECT,
    });
    let rows: CardRow[] = prefixRows;
    if (rows.length < SEARCH_LIMIT) {
      const rest = await this.prisma.user.findMany({
        where: {
          status: 'active',
          id: { notIn: rows.map((row) => row.id) },
          displayName: { contains: term, mode: 'insensitive' },
        },
        orderBy: { handle: 'asc' },
        take: SEARCH_LIMIT - rows.length,
        select: CARD_SELECT,
      });
      rows = [...rows, ...rest];
    }
    return { users: await this.toCards(viewer, rows) };
  }

  async profile(viewer: AuthUser, handle: string) {
    const row = await this.prisma.user.findUnique({
      where: { handle },
      select: {
        id: true,
        handle: true,
        displayName: true,
        avatarFileId: true,
        statusPrefix: true,
        tags: true,
        globalRole: true,
        exp: true,
        createdAt: true,
      },
    });
    if (!row) throw new AppError(ErrorCode.USER_NOT_FOUND);

    const [followers, following, likesReceived, posts, commissions, services, followedByRows, application] =
      await Promise.all([
        this.prisma.follow.count({ where: { followingId: row.id } }),
        this.prisma.follow.count({ where: { followerId: row.id } }),
        this.prisma.postLike.count({
          where: { post: { authorId: row.id, status: 'published', deletedAt: null } },
        }),
        this.prisma.post.count({
          where: { authorId: row.id, surface: 'belt', status: 'published', deletedAt: null },
        }),
        this.prisma.task.count({ where: { creatorId: row.id } }),
        this.prisma.service.count({ where: { userId: row.id } }),
        this.prisma.follow.findFirst({
          where: { followerId: row.id, followingId: viewer.id },
          select: { id: true },
        }),
        this.prisma.clerkApplication.findFirst({
          where: { userId: row.id },
          orderBy: { createdAt: 'desc' },
          select: { status: true },
        }),
      ]);
    const isFollowing = Boolean(
      await this.prisma.follow.findFirst({
        where: { followerId: viewer.id, followingId: row.id },
        select: { id: true },
      }),
    );
    const isClerk = row.tags.includes(CLERK_TAG);
    const progress = progressOf(row.exp);
    const isManager = row.globalRole === 'owner' || row.globalRole === 'admin';

    return {
      user: {
        id: row.id,
        handle: row.handle,
        displayName: row.displayName,
        avatarFileId: row.avatarFileId,
        statusPrefix: row.statusPrefix,
        tags: row.tags,
        globalRole: row.globalRole,
        exp: row.exp,
        level: progress.level,
        levelLabel: progress.levelLabel,
        expIntoLevel: progress.expIntoLevel,
        expForNextLevel: progress.expForNextLevel,
        createdAt: row.createdAt.toISOString(),
        counts: { followers, following, likesReceived, posts, commissions, services },
        isSelf: row.id === viewer.id,
        isFollowing,
        followedBy: Boolean(followedByRows),
      },
      eligibility: {
        isClerk,
        clerkApplicationStatus: application?.status ?? ('none' as const),
        moderationVisible: isClerk || isManager,
      },
    };
  }

  /** 个人主页 Tab1：只有环带已发布、未删除的帖子 */
  async posts(
    handle: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: PostSummary[]; nextCursor: string | null }> {
    const user = await this.userByHandle(handle);
    const after = cursor ? decodePostsCursor(cursor) : null;
    const cursorFilter: Prisma.PostWhereInput = after
      ? {
          OR: [
            { createdAt: { lt: after.createdAt } },
            { createdAt: after.createdAt, id: { lt: after.id } },
          ],
        }
      : {};
    const rows = await this.prisma.post.findMany({
      where: {
        authorId: user.id,
        surface: 'belt',
        status: 'published',
        deletedAt: null,
        ...cursorFilter,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SUMMARY_SELECT,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => this.toSummary(row)),
      nextCursor: rows.length > limit && last ? encodePostsCursor(last.createdAt, last.id) : null,
    };
  }

  /** 个人主页 Tab2：委托 */
  async commissions(handle: string) {
    const user = await this.userByHandle(handle);
    const rows = await this.prisma.task.findMany({
      where: { creatorId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        title: true,
        description: true,
        priceCents: true,
        status: true,
        deadline: true,
        createdAt: true,
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        priceCents: row.priceCents,
        status: row.status,
        deadline: row.deadline ? row.deadline.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** 个人主页 Tab3：服务 */
  async services(handle: string) {
    const user = await this.userByHandle(handle);
    const rows = await this.prisma.service.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        title: true,
        description: true,
        priceCents: true,
        status: true,
        createdAt: true,
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        priceCents: row.priceCents,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** 关注（幂等）：重复关注不报错 */
  async follow(viewer: AuthUser, handle: string) {
    const target = await this.userByHandle(handle);
    if (target.id === viewer.id) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '不能关注自己');
    }
    await this.prisma.follow.upsert({
      where: { followerId_followingId: { followerId: viewer.id, followingId: target.id } },
      create: { followerId: viewer.id, followingId: target.id },
      update: {},
    });
    return { following: true, followers: await this.followersOf(target.id) };
  }

  /** 取关（幂等） */
  async unfollow(viewer: AuthUser, handle: string) {
    const target = await this.userByHandle(handle);
    if (target.id === viewer.id) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '不能取关自己');
    }
    await this.prisma.follow.deleteMany({
      where: { followerId: viewer.id, followingId: target.id },
    });
    return { following: false, followers: await this.followersOf(target.id) };
  }

  /** 我的等级 + 幂等发当日登录奖励（按 Asia/Shanghai 日切） */
  async meLevel(user: AuthUser) {
    const today = shanghaiDate();
    await this.exp.award(user.id, 'daily_login', {
      refType: 'login',
      idempotencyKey: `login:${user.id}:${today}`,
    });
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { exp: true },
    });
    const exp = row?.exp ?? 0;
    const progress = progressOf(exp);
    return {
      exp,
      level: progress.level,
      levelLabel: progress.levelLabel,
      expIntoLevel: progress.expIntoLevel,
      expForNextLevel: progress.expForNextLevel,
      nextLevelAt: progress.nextLevelAt,
      cap: MAX_LEVEL,
      rewards: { ...EXP_REWARDS },
    };
  }

  private async userByHandle(handle: string): Promise<{ id: string }> {
    const row = await this.prisma.user.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (!row) throw new AppError(ErrorCode.USER_NOT_FOUND);
    return row;
  }

  private followersOf(userId: string): Promise<number> {
    return this.prisma.follow.count({ where: { followingId: userId } });
  }

  private async toCards(viewer: AuthUser, rows: CardRow[]): Promise<UserCard[]> {
    const ids = rows.map((row) => row.id);
    const followed =
      ids.length === 0
        ? new Set<string>()
        : new Set(
            (
              await this.prisma.follow.findMany({
                where: { followerId: viewer.id, followingId: { in: ids } },
                select: { followingId: true },
              })
            ).map((item) => item.followingId),
          );
    return rows.map((row) => ({
      id: row.id,
      handle: row.handle,
      displayName: row.displayName,
      avatarFileId: row.avatarFileId,
      tags: row.tags,
      level: levelOf(row.exp),
      isFollowing: followed.has(row.id),
    }));
  }

  private toSummary(row: SummaryRow): PostSummary {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      board: row.board,
      createdAt: row.createdAt.toISOString(),
      likeCount: row._count.likes,
      commentCount: row._count.comments,
      coverFileId: row.coverFileId,
    };
  }
}
