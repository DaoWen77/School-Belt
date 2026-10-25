import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthUser } from '../src/common/types/context';
import { StickersService } from '../src/stickers/stickers.service';
import { UsersService } from '../src/users/users.service';
import { createCardSchema } from '../src/cards/cards.dto';
import { CARD_KINDS } from '../src/common/types/enums';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const STICKER_ID = '55555555-5555-4555-8555-555555555555';
const CHANNEL_ID = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-10-24T02:00:00.000Z');

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: OWNER_ID,
    handle: 'owner',
    displayName: '群主',
    globalRole: 'member',
    status: 'active',
    sessionId: 's1',
    mutedUntil: null,
    avatarFileId: null,
    statusPrefix: null,
    ...overrides,
  };
}

function readyImage(overrides: Record<string, unknown> = {}) {
  return { id: FILE_ID, ownerId: OWNER_ID, kind: 'image', status: 'ready', ...overrides };
}

function stickerRow(overrides: Record<string, unknown> = {}) {
  return { id: STICKER_ID, fileId: FILE_ID, name: '点赞', createdAt: NOW, ...overrides };
}

function stickersPrisma(file: Record<string, unknown> | null, stickerOps: Record<string, unknown> = {}) {
  return {
    file: { findUnique: vi.fn(async () => file) },
    sticker: {
      create: vi.fn(async () => stickerRow()),
      findUnique: vi.fn(async () => stickerRow()),
      findMany: vi.fn(async () => [stickerRow()]),
      delete: vi.fn(async () => stickerRow()),
      ...stickerOps,
    },
  };
}

function service(prisma: unknown): StickersService {
  return new StickersService(prisma as PrismaService);
}

describe('Sprint2 贴纸：收藏校验', () => {
  it('本人 ready 图片可收藏，返回 sticker 视图', async () => {
    const prisma = stickersPrisma(readyImage());
    const result = await service(prisma).create(user(), { fileId: FILE_ID, name: '点赞' });
    expect(result).toEqual({ id: STICKER_ID, fileId: FILE_ID, name: '点赞', createdAt: NOW.toISOString() });
    expect(prisma.sticker.create).toHaveBeenCalledWith({
      data: { ownerId: OWNER_ID, fileId: FILE_ID, name: '点赞' },
      select: { id: true, fileId: true, name: true, createdAt: true },
    });
  });

  it('非本人文件 → FORBIDDEN', async () => {
    const prisma = stickersPrisma(readyImage({ ownerId: OTHER_ID }));
    await expect(service(prisma).create(user(), { fileId: FILE_ID, name: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(prisma.sticker.create).not.toHaveBeenCalled();
  });

  it('非图片 → FILE_TYPE_NOT_ALLOWED；未就绪 → FILE_NOT_READY', async () => {
    await expect(
      service(stickersPrisma(readyImage({ kind: 'file' }))).create(user(), { fileId: FILE_ID, name: 'x' }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    await expect(
      service(stickersPrisma(readyImage({ status: 'pending' }))).create(user(), { fileId: FILE_ID, name: 'x' }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_READY' });
  });

  it('文件不存在 → VALIDATION_FAILED', async () => {
    await expect(
      service(stickersPrisma(null)).create(user(), { fileId: FILE_ID, name: 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('重复收藏（唯一键冲突）→ 幂等返回已有贴纸', async () => {
    const unique = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    const create = vi.fn(async () => {
      throw unique;
    });
    const findUnique = vi.fn(async () => stickerRow({ name: '已有' }));
    const prisma = stickersPrisma(readyImage(), { create, findUnique });
    const result = await service(prisma).create(user(), { fileId: FILE_ID, name: '新的' });
    expect(result.name).toBe('已有');
    expect(create).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { ownerId_fileId: { ownerId: OWNER_ID, fileId: FILE_ID } },
      select: { id: true, fileId: true, name: true, createdAt: true },
    });
  });
});

describe('Sprint2 贴纸：列表与删除', () => {
  it('列表只查本人贴纸，按 createdAt desc', async () => {
    const prisma = stickersPrisma(readyImage());
    const result = await service(prisma).list(user());
    expect(prisma.sticker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: OWNER_ID },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(result.stickers).toHaveLength(1);
  });

  it('删除：非本人 → FORBIDDEN；不存在 → VALIDATION_FAILED；本人 → 删除成功', async () => {
    const otherSticker = stickersPrisma(readyImage(), {
      findUnique: vi.fn(async () => ({ id: STICKER_ID, ownerId: OTHER_ID })),
    });
    await expect(service(otherSticker).remove(user(), STICKER_ID)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(otherSticker.sticker.delete).not.toHaveBeenCalled();

    const missing = stickersPrisma(readyImage(), { findUnique: vi.fn(async () => null) });
    await expect(service(missing).remove(user(), STICKER_ID)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    const owned = stickersPrisma(readyImage(), {
      findUnique: vi.fn(async () => ({ id: STICKER_ID, ownerId: OWNER_ID })),
    });
    await expect(service(owned).remove(user(), STICKER_ID)).resolves.toEqual({ id: STICKER_ID });
    expect(owned.sticker.delete).toHaveBeenCalledWith({ where: { id: STICKER_ID } });
  });
});

describe('Sprint2 /me/tasks', () => {
  it('查询条件覆盖指派/未完成/open/未归档，并按 dueAt asc nulls last', async () => {
    const rows = [
      {
        id: 'card-1',
        title: '出图',
        kind: 'task',
        taskStatus: 'doing',
        dueAt: new Date('2026-10-25T00:00:00.000Z'),
        updatedAt: NOW,
        channel: { id: CHANNEL_ID, name: '素材工坊' },
      },
      {
        id: 'card-2',
        title: '无期限任务',
        kind: 'task',
        taskStatus: 'todo',
        dueAt: null,
        updatedAt: NOW,
        channel: { id: CHANNEL_ID, name: '素材工坊' },
      },
    ];
    const findMany = vi.fn(async () => rows);
    const users = new UsersService(
      { card: { findMany } } as unknown as PrismaService,
      undefined as never,
      undefined as never,
    );

    const result = await users.listMyTasks(OWNER_ID);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'open',
          taskStatus: { not: 'done' },
          deletedAt: null,
          channel: { archivedAt: null },
          assignees: { some: { userId: OWNER_ID } },
        },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
    );
    expect(result.tasks[0]).toEqual({
      cardId: 'card-1',
      title: '出图',
      taskStatus: 'doing',
      dueAt: '2026-10-25T00:00:00.000Z',
      channelId: CHANNEL_ID,
      channelName: '素材工坊',
      kind: 'task',
      updatedAt: NOW.toISOString(),
    });
    expect(result.tasks[1]?.dueAt).toBeNull();
  });
});

describe('Sprint2 music / chart 卡片类型', () => {
  it('CARD_KINDS 包含 music 与 chart', () => {
    expect(CARD_KINDS).toContain('music');
    expect(CARD_KINDS).toContain('chart');
  });

  it('POST /cards 允许 music：data 存 url/title/artist/coverUrl', () => {
    const parsed = createCardSchema.parse({
      channelId: CHANNEL_ID,
      kind: 'music',
      title: '夜航',
      data: { url: 'https://example.com/a.mp3', title: '夜航', artist: '帝江', coverUrl: 'https://example.com/a.png' },
    });
    expect(parsed.kind).toBe('music');
    expect(parsed.data?.url).toBe('https://example.com/a.mp3');
  });

  it('POST /cards 允许 chart：data 存 chartType/series', () => {
    const parsed = createCardSchema.parse({
      channelId: CHANNEL_ID,
      kind: 'chart',
      title: '本周产能',
      data: { chartType: 'bar', series: [{ label: '周一', value: 12 }] },
    });
    expect(parsed.kind).toBe('chart');
    expect(parsed.data?.chartType).toBe('bar');
  });

  it('未知 kind 仍被拒绝', () => {
    expect(() =>
      createCardSchema.parse({ channelId: CHANNEL_ID, kind: 'audio', title: 'x' }),
    ).toThrow();
  });
});
