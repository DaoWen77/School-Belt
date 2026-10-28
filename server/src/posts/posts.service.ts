import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { clampLimit, decodeKeyCursor, encodeKeyCursor } from '../common/utils/cursor';
import type { AuthUser } from '../common/types/context';
import type { CreateCommentDto, CreatePostDto, ListCommentsQuery, ListPostsQuery } from './posts.dto';

export interface PostAuthorView {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
}

export interface PostView {
  id: string;
  body: string;
  fileIds: string[];
  createdAt: string;
  author: PostAuthorView;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

export interface PostCommentView {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  author: PostAuthorView;
}

const AUTHOR_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  avatarFileId: true,
} as const;

const POST_SELECT = {
  id: true,
  body: true,
  fileIds: true,
  createdAt: true,
  author: { select: AUTHOR_SELECT },
  _count: { select: { likes: true, comments: true } },
} as const;

type PostRow = {
  id: string;
  body: string;
  fileIds: Prisma.JsonValue;
  createdAt: Date;
  author: PostAuthorView;
  _count: { likes: number; comments: number };
};

/**
 * 朋友圈（Sprint4）：
 * - 发帖 / 软删均走 `Prisma.$transaction`；
 * - 点赞 `createMany(skipDuplicates)` 幂等，计数实时返回；
 * - 列表用 `(createdAt, id)` 复合游标，倒序分页。
 */
@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListPostsQuery): Promise<{ posts: PostView[]; nextCursor: string | null }> {
    const limit = clampLimit(query.limit, 20, 50);
    let cursorFilter: Prisma.PostWhereInput = {};
    if (query.cursor) {
      const [createdAtMsRaw, id] = decodeKeyCursor(query.cursor, 2) as [string, string];
      const createdAt = new Date(Number(createdAtMsRaw));
      if (!/^\d{10,16}$/.test(createdAtMsRaw) || Number.isNaN(createdAt.getTime())) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '游标格式非法', { field: 'cursor' });
      }
      cursorFilter = {
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
      };
    }

    const rows = (await this.prisma.post.findMany({
      // 内网朋友圈只允许 internal + moments；环塔帖子由 /belt/posts 单独查询。
      where: { deletedAt: null, surface: 'internal', board: 'moments', ...cursorFilter },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: POST_SELECT,
    })) as PostRow[];

    const page = rows.slice(0, limit);
    const likedRows = await this.prisma.postLike.findMany({
      where: { userId: user.id, postId: { in: page.map((row) => row.id) } },
      select: { postId: true },
    });
    const liked = new Set(likedRows.map((row) => row.postId));
    const nextCursor =
      rows.length > limit && page.length > 0
        ? encodeKeyCursor([page[page.length - 1]!.createdAt.getTime(), page[page.length - 1]!.id])
        : null;

    return { posts: page.map((row) => this.toView(row, user.id, liked)), nextCursor };
  }

  /** 发帖：Prisma.$transaction 创建（fileIds 以 JSON 数组落库） */
  async create(user: AuthUser, dto: CreatePostDto): Promise<PostView> {
    const fileIds = dto.fileIds ?? [];
    const row = (await this.prisma.$transaction((tx) =>
      tx.post.create({
        data: {
          authorId: user.id,
          surface: 'internal',
          board: 'moments',
          body: dto.body,
          fileIds: fileIds as Prisma.InputJsonValue,
        },
        select: POST_SELECT,
      }),
    )) as PostRow;
    return this.toView(row, user.id, new Set());
  }

  /** 软删：仅作者本人；事务内只置 deleted_at，不物理删 */
  async remove(user: AuthUser, postId: string): Promise<{ id: string; deleted: true }> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null, surface: 'internal', board: 'moments' },
      select: { id: true, authorId: true },
    });
    if (!post) throw new AppError(ErrorCode.VALIDATION_FAILED, '动态不存在', { postId });
    if (post.authorId !== user.id) {
      throw new AppError(ErrorCode.FORBIDDEN, '仅作者本人可删除该动态', { postId });
    }
    await this.prisma.$transaction((tx) =>
      tx.post.update({ where: { id: postId }, data: { deletedAt: new Date() } }),
    );
    return { id: postId, deleted: true };
  }

  /** 点赞：登录即可，幂等（重复点赞不报错、计数不变） */
  async like(user: AuthUser, postId: string): Promise<{ postId: string; liked: boolean; likeCount: number }> {
    await this.assertPostVisible(postId);
    await this.prisma.postLike.createMany({
      data: [{ postId, userId: user.id }],
      skipDuplicates: true,
    });
    const likeCount = await this.prisma.postLike.count({ where: { postId } });
    return { postId, liked: true, likeCount };
  }

  /** 取消点赞：幂等（未点赞也返回 liked=false） */
  async unlike(user: AuthUser, postId: string): Promise<{ postId: string; liked: boolean; likeCount: number }> {
    await this.assertPostVisible(postId);
    await this.prisma.postLike.deleteMany({ where: { postId, userId: user.id } });
    const likeCount = await this.prisma.postLike.count({ where: { postId } });
    return { postId, liked: false, likeCount };
  }

  async listComments(postId: string, query: ListCommentsQuery): Promise<{ comments: PostCommentView[] }> {
    await this.assertPostVisible(postId);
    const limit = clampLimit(query.limit, 50, 100);
    const rows = await this.prisma.postComment.findMany({
      where: { postId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, postId: true, body: true, createdAt: true, author: { select: AUTHOR_SELECT } },
    });
    return { comments: rows.map((row) => this.toCommentView(row)) };
  }

  async addComment(user: AuthUser, postId: string, dto: CreateCommentDto): Promise<PostCommentView> {
    await this.assertPostVisible(postId);
    const row = await this.prisma.postComment.create({
      data: { postId, authorId: user.id, body: dto.body },
      select: { id: true, postId: true, body: true, createdAt: true, author: { select: AUTHOR_SELECT } },
    });
    return this.toCommentView(row);
  }

  private async assertPostVisible(postId: string): Promise<void> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null, surface: 'internal', board: 'moments' },
      select: { id: true },
    });
    if (!post) throw new AppError(ErrorCode.VALIDATION_FAILED, '动态不存在', { postId });
  }

  private toView(row: PostRow, viewerId: string, liked: Set<string>): PostView {
    return {
      id: row.id,
      body: row.body,
      fileIds: parseFileIds(row.fileIds),
      createdAt: row.createdAt.toISOString(),
      author: row.author,
      likeCount: row._count.likes,
      commentCount: row._count.comments,
      likedByMe: liked.has(row.id) && viewerId.length > 0,
    };
  }

  private toCommentView(row: {
    id: string;
    postId: string;
    body: string;
    createdAt: Date;
    author: PostAuthorView;
  }): PostCommentView {
    return {
      id: row.id,
      postId: row.postId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      author: row.author,
    };
  }
}

/** file_ids 只接受字符串数组；异常数据按空数组处理（不抛错导致整页 500） */
function parseFileIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
