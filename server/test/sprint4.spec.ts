import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardKind } from '@prisma/client';
import { PostsService } from '../src/posts/posts.service';
import { ArchiveService } from '../src/posts/archive.service';
import { ActivityService, startOfWindow } from '../src/posts/activity.service';
import { encodeKeyCursor } from '../src/common/utils/cursor';
import { createPostSchema } from '../src/posts/posts.dto';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthUser } from '../src/common/types/context';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const POST_ID = '88888888-8888-4888-8888-888888888888';
const CHANNEL_ID = '99999999-9999-4999-8999-999999999999';
const NOW = new Date('2026-10-24T04:00:00.000Z');

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: OWNER_ID,
    handle: 'owner',
    displayName: '协议官',
    globalRole: 'owner',
    status: 'active',
    sessionId: 's1',
    mutedUntil: null,
    avatarFileId: null,
    statusPrefix: null,
    ...overrides,
  };
}

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    body: '第一条动态',
    fileIds: ['file-1'],
    createdAt: NOW,
    author: { id: OWNER_ID, handle: 'owner', displayName: '协议官', avatarFileId: null },
    _count: { likes: 2, comments: 1 },
    ...overrides,
  };
}

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    postId: POST_ID,
    body: '评论',
    createdAt: NOW,
    author: { id: OTHER_ID, handle: 'chen', displayName: '陈工', avatarFileId: null },
    ...overrides,
  };
}

function postsService(prisma: unknown): PostsService {
  return new PostsService(prisma as PrismaService);
}

describe('Sprint4 发帖（事务）', () => {
  it('POST /posts：Prisma.$transaction 创建，fileIds 以 JSON 数组落库', async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => postRow({ fileIds: data.fileIds, body: data.body }));
    const tx = { post: { create } };
    const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
    const view = await postsService(prisma).create(authUser(), { body: '第一条动态', fileIds: ['file-1'] });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({ authorId: OWNER_ID, body: '第一条动态', fileIds: ['file-1'] });
    expect(view).toMatchObject({ id: POST_ID, body: '第一条动态', fileIds: ['file-1'], likedByMe: false });
  });

  it('DTO 限制 body 1..4000、fileIds ≤9', () => {
    expect(createPostSchema.safeParse({ body: 'x'.repeat(4000), fileIds: Array.from({ length: 9 }, () => '11111111-1111-4111-8111-111111111111') }).success).toBe(true);
    expect(createPostSchema.safeParse({ body: '' }).success).toBe(false);
    expect(createPostSchema.safeParse({ body: 'x'.repeat(4001) }).success).toBe(false);
    expect(
      createPostSchema.safeParse({
        body: 'ok',
        fileIds: Array.from({ length: 10 }, () => '11111111-1111-4111-8111-111111111111'),
      }).success,
    ).toBe(false);
  });
});

describe('Sprint4 删除（作者 + 软删事务）', () => {
  it('作者删除：事务内只置 deleted_at', async () => {
    const update = vi.fn(async () => ({ id: POST_ID }));
    const prisma = {
      post: { findFirst: vi.fn(async () => ({ id: POST_ID, authorId: OWNER_ID })) },
      $transaction: vi.fn(async (fn: (tx: { post: { update: typeof update } }) => Promise<unknown>) =>
        fn({ post: { update } }),
      ),
    };
    const result = await postsService(prisma).remove(authUser(), POST_ID);
    expect(result).toEqual({ id: POST_ID, deleted: true });
    expect(update).toHaveBeenCalledWith({ where: { id: POST_ID }, data: { deletedAt: expect.any(Date) } });
  });

  it('非作者删除 → FORBIDDEN，且不开启事务', async () => {
    const prisma = {
      post: { findFirst: vi.fn(async () => ({ id: POST_ID, authorId: OTHER_ID })) },
      $transaction: vi.fn(),
    };
    await expect(postsService(prisma).remove(authUser(), POST_ID)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('不存在/已删 → VALIDATION_FAILED', async () => {
    const prisma = { post: { findFirst: vi.fn(async () => null) }, $transaction: vi.fn() };
    await expect(postsService(prisma).remove(authUser(), POST_ID)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('Sprint4 列表 + 点赞幂等与计数', () => {
  it('列表返回 author/likeCount/commentCount/likedByMe 与游标', async () => {
    const cursor = encodeKeyCursor([NOW.getTime(), POST_ID]);
    const findMany = vi.fn(async () => [postRow()]);
    const prisma = {
      post: { findMany },
      postLike: { findMany: vi.fn(async () => [{ postId: POST_ID }]) },
    };
    const result = await postsService(prisma).list(authUser(), { limit: 20, cursor });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          OR: [{ createdAt: { lt: NOW } }, { createdAt: NOW, id: { lt: POST_ID } }],
        }),
        take: 21,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result.posts[0]).toMatchObject({ likeCount: 2, commentCount: 1, likedByMe: true });
    expect(result.nextCursor).toBeNull();
  });

  it('点赞幂等：createMany(skipDuplicates) 重复调用不报错，计数实时', async () => {
    const createMany = vi.fn(async () => ({ count: 0 }));
    const count = vi.fn(async () => 3);
    const prisma = {
      post: { findFirst: vi.fn(async () => ({ id: POST_ID })) },
      postLike: { createMany, count, deleteMany: vi.fn(async () => ({ count: 1 })) },
    };
    const service = postsService(prisma);
    const first = await service.like(authUser(), POST_ID);
    const second = await service.like(authUser(), POST_ID);
    expect(first).toEqual({ postId: POST_ID, liked: true, likeCount: 3 });
    expect(second).toEqual(first);
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ postId: POST_ID, userId: OWNER_ID }],
      skipDuplicates: true,
    });
  });

  it('取消点赞幂等：deleteMany + 最新计数', async () => {
    const prisma = {
      post: { findFirst: vi.fn(async () => ({ id: POST_ID })) },
      postLike: { deleteMany: vi.fn(async () => ({ count: 0 })), count: vi.fn(async () => 0) },
    };
    const result = await postsService(prisma).unlike(authUser(), POST_ID);
    expect(result).toEqual({ postId: POST_ID, liked: false, likeCount: 0 });
    expect(prisma.postLike.deleteMany).toHaveBeenCalledWith({ where: { postId: POST_ID, userId: OWNER_ID } });
  });

  it('对已删除/不存在的动态点赞 → VALIDATION_FAILED', async () => {
    const prisma = { post: { findFirst: vi.fn(async () => null) }, postLike: { createMany: vi.fn() } };
    await expect(postsService(prisma).like(authUser(), POST_ID)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('Sprint4 评论', () => {
  it('POST 评论返回 comment（含作者信息）', async () => {
    const create = vi.fn(async ({ data }: { data: { body: string; authorId: string } }) =>
      commentRow({ body: data.body, authorId: data.authorId }),
    );
    const prisma = {
      post: { findFirst: vi.fn(async () => ({ id: POST_ID })) },
      postComment: { create },
    };
    const view = await postsService(prisma).addComment(authUser({ id: OTHER_ID, handle: 'chen', displayName: '陈工' }), POST_ID, { body: '评论' });
    expect(view).toMatchObject({
      postId: POST_ID,
      body: '评论',
      author: { id: OTHER_ID, handle: 'chen', displayName: '陈工' },
    });
    expect(create.mock.calls[0]?.[0].data).toMatchObject({ postId: POST_ID, authorId: OTHER_ID, body: '评论' });
  });

  it('GET 评论按 createdAt 正序、limit 生效', async () => {
    const findMany = vi.fn(async () => [commentRow()]);
    const prisma = {
      post: { findFirst: vi.fn(async () => ({ id: POST_ID })) },
      postComment: { findMany },
    };
    const result = await postsService(prisma).listComments(POST_ID, { limit: 50 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { postId: POST_ID },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 50,
      }),
    );
    expect(result.comments).toHaveLength(1);
  });

  it('对已删除动态评论 → VALIDATION_FAILED', async () => {
    const prisma = { post: { findFirst: vi.fn(async () => null) }, postComment: { create: vi.fn() } };
    await expect(postsService(prisma).addComment(authUser(), POST_ID, { body: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('Sprint4 archive 归档过滤', () => {
  it('只查 material/artwork/idea、未删、频道未归档、当前用户可见', async () => {
    const cards = [
      {
        id: 'card-1',
        kind: CardKind.material,
        title: '素材',
        body: '说明',
        channelId: CHANNEL_ID,
        createdAt: NOW,
        channel: { name: '素材工坊' },
      },
    ];
    const findMany = vi.fn(async () => cards);
    const prisma = {
      card: { findMany },
      attachment: { findMany: vi.fn(async () => [{ cardId: 'card-1', fileId: 'file-1' }]) },
    };
    const result = await new ArchiveService(prisma as unknown as PrismaService).list(authUser());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: { in: [CardKind.material, CardKind.artwork, CardKind.idea] },
          deletedAt: null,
          channel: {
            archivedAt: null,
            OR: [
              { visibility: 'public' },
              { createdBy: OWNER_ID },
              { members: { some: { userId: OWNER_ID } } },
            ],
          },
        },
        take: 100,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(result.items[0]).toEqual({
      id: 'card-1',
      kind: CardKind.material,
      title: '素材',
      body: '说明',
      fileIds: ['file-1'],
      channelId: CHANNEL_ID,
      channelName: '素材工坊',
      createdAt: NOW.toISOString(),
    });
  });
});

describe('Sprint4 stats/activity 7 天窗口', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('metrics 五项 + daily 固定 7 天，窗口为 UTC 7 个自然日', async () => {
    // 固定到 UTC 正午，避免本机/CI 恰逢 UTC 午夜时“1 小时前”落到前一天导致假失败。
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400_000);
    const messageFindMany = vi.fn(async () => [
      { senderId: 'u1', createdAt: new Date(now.getTime() - 3600_000) },
      { senderId: 'u2', createdAt: new Date(now.getTime() - 3600_000) },
      { senderId: 'u1', createdAt: twoDaysAgo },
    ]);
    const cardFindMany = vi.fn(async () => [{ updatedAt: new Date(now.getTime() - 7200_000) }]);
    const prisma = {
      message: { findMany: messageFindMany },
      voteBallot: { count: vi.fn(async () => 4) },
      file: { count: vi.fn(async () => 6) },
      card: { findMany: cardFindMany },
    };
    const result = await new ActivityService(prisma as unknown as PrismaService).get();

    expect(result.metrics).toEqual([
      { key: 'messages', label: '消息量', value: 3 },
      { key: 'activeUsers', label: '活跃用户', value: 2 },
      { key: 'tasksDone', label: '任务完成', value: 1 },
      { key: 'voteBallots', label: '投票参与', value: 4 },
      { key: 'files', label: '素材数', value: 6 },
    ]);
    expect(result.daily).toHaveLength(7);
    expect(result.daily.at(-1)?.date).toBe(today);
    expect(result.daily.at(-1)?.messages).toBe(2);
    expect(result.daily.at(-1)?.activeUsers).toBe(2);
    expect(result.daily.at(-1)?.tasksDone).toBe(1);
    const twoDaysAgoEntry = result.daily.find((item) => item.date === twoDaysAgo.toISOString().slice(0, 10));
    expect(twoDaysAgoEntry?.messages).toBe(1);

    const where = messageFindMany.mock.calls[0]?.[0]?.where as {
      deletedAt: null;
      createdAt: { gte: Date };
    };
    expect(where.deletedAt).toBeNull();
    expect(where.createdAt.gte.getTime()).toBe(startOfWindow(now).getTime());
    expect(cardFindMany.mock.calls[0]?.[0]?.where).toMatchObject({
      kind: CardKind.task,
      taskStatus: 'done',
      deletedAt: null,
    });
  });
});
