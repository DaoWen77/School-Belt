import { describe, expect, it, vi } from 'vitest';
import { RssService } from '../src/rss/rss.service';
import { createRssSourceSchema } from '../src/rss/rss.dto';

describe('RSS DTO', () => {
  it('接受 http/https 源并拒绝非 http 协议', () => {
    expect(createRssSourceSchema.safeParse({ name: '36Kr', url: 'https://36kr.com/feed' }).success).toBe(true);
    expect(createRssSourceSchema.safeParse({ name: 'x', url: 'ftp://example.com/feed' }).success).toBe(false);
    expect(createRssSourceSchema.safeParse({ name: '', url: 'https://example.com' }).success).toBe(false);
  });
});

describe('RssService 源管理', () => {
  const user = { id: '11111111-1111-4111-8111-111111111111' };
  const row = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Mock Wire',
    url: 'https://example.com/feed',
    enabled: true,
    createdBy: user.id,
    lastFetchedAt: null,
    lastItemCount: 0,
    lastError: null,
    createdAt: new Date('2026-10-25T00:00:00Z'),
    updatedAt: new Date('2026-10-25T00:00:00Z'),
    _count: { items: 0 },
  };

  it('创建后返回统一 SourceView，并规范化 URL', async () => {
    const prisma = {
      rssSource: {
        create: vi.fn(async () => row),
        findMany: vi.fn(async () => [row]),
        findUnique: vi.fn(async () => row),
        update: vi.fn(async () => row),
        delete: vi.fn(async () => row),
      },
    };
    const service = new RssService(prisma as never);
    const view = await service.create(user as never, { name: 'Mock Wire', url: 'https://example.com/feed' });
    expect(view.name).toBe('Mock Wire');
    expect(prisma.rssSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Mock Wire',
        url: 'https://example.com/feed',
        createdBy: user.id,
      }),
    });
  });

  it('停用/删除源不触碰抓取账本之外的业务表', async () => {
    const prisma = {
      rssSource: {
        findUnique: vi.fn(async () => row),
        update: vi.fn(async () => ({ ...row, enabled: false })),
        delete: vi.fn(async () => row),
        findMany: vi.fn(async () => [{ ...row, enabled: false }]),
      },
    };
    const service = new RssService(prisma as never);
    const updated = await service.update(user as never, row.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    await expect(service.remove(user as never, row.id)).resolves.toEqual({ deleted: true });
    expect(prisma.rssSource.delete).toHaveBeenCalledWith({ where: { id: row.id } });
  });
});
