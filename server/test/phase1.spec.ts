import { describe, expect, it, vi } from 'vitest';
import { resolveS3PublicEndpoint } from '../../ops/e2e/lib/s3-endpoint.mjs';
import { FilesService } from '../src/files/files.service';
import { checkReplyTarget } from '../src/messages/reply-rules';
import {
  buildReplyToSummary,
  REPLY_SNIPPET_MAX,
  toMessageView,
  type MessageRowLike,
} from '../src/common/utils/message-view';
import { AppError } from '../src/common/errors/app-error';
import { ErrorCode } from '../src/common/errors/error-codes';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { S3Service } from '../src/files/s3.service';
import type { ChannelAccessService } from '../src/common/guards/channel-access.service';
import type { AuthUser } from '../src/common/types/context';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_CHANNEL_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-10-24T06:00:00.000Z');

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: OWNER_ID,
    handle: 'founder',
    displayName: '建立者',
    globalRole: 'member',
    status: 'active',
    sessionId: 's1',
    mutedUntil: null,
    avatarFileId: null,
    statusPrefix: null,
    ...overrides,
  };
}

describe('Phase1 S3 publicEndpoint：LAN 自动推导', () => {
  it('显式 S3_PUBLIC_ENDPOINT 最优先', () => {
    expect(
      resolveS3PublicEndpoint({
        explicit: 'https://files.example.com',
        endpoint: 'http://127.0.0.1:9000',
        apiHost: '0.0.0.0',
        lanIps: ['192.168.1.9'],
      }),
    ).toBe('https://files.example.com');
  });

  it('API_HOST=0.0.0.0 且有 LAN IP → 用 LAN IP + S3 端口', () => {
    expect(
      resolveS3PublicEndpoint({
        explicit: undefined,
        endpoint: 'http://127.0.0.1:9000',
        apiHost: '0.0.0.0',
        lanIps: ['192.168.1.9', '10.0.0.2'],
      }),
    ).toBe('http://192.168.1.9:9000');
  });

  it('仅监听 127.0.0.1 或无 LAN IP → 回退 S3_ENDPOINT', () => {
    const base = { explicit: undefined, endpoint: 'http://127.0.0.1:9000' };
    expect(resolveS3PublicEndpoint({ ...base, apiHost: '127.0.0.1', lanIps: ['192.168.1.9'] })).toBe(
      'http://127.0.0.1:9000',
    );
    expect(resolveS3PublicEndpoint({ ...base, apiHost: '0.0.0.0', lanIps: [] })).toBe(
      'http://127.0.0.1:9000',
    );
  });
});

describe('Phase1 头像文件 ACL', () => {
  function filesHarness(options: {
    file: Record<string, unknown>;
    avatarLookup: { id: string } | null;
    assertImpl?: () => Promise<unknown>;
  }) {
    const file = {
      id: FILE_ID,
      channelId: CHANNEL_ID,
      ownerId: OTHER_ID,
      status: 'ready',
      storageKey: 'files/a.png',
      previewKey: null,
      ...options.file,
    };
    const prisma = {
      file: { findUnique: vi.fn(async () => file) },
      user: { findFirst: vi.fn(async () => options.avatarLookup) },
    };
    const s3 = {
      presignGet: vi.fn(async (key: string) => `https://s3.example.com/${key}?sig=1`),
      presignExpiresSec: 900,
    };
    const channelAccess = {
      assert:
        options.assertImpl ??
        (async () => {
          throw new AppError(ErrorCode.NOT_CHANNEL_MEMBER, '不是频道成员');
        }),
    };
    const service = new FilesService(
      prisma as unknown as PrismaService,
      s3 as unknown as S3Service,
      channelAccess as unknown as ChannelAccessService,
    );
    return { service, prisma, s3, file };
  }

  it('频道读权限失败但 fileId 是任意用户头像 → 放行并返回签名 URL', async () => {
    const { service, prisma } = filesHarness({
      file: { channelId: CHANNEL_ID },
      avatarLookup: { id: OTHER_ID },
    });
    const result = await service.url(authUser(), FILE_ID, { variant: 'original' });
    expect(result.url).toContain('files/a.png');
    expect(result.expiresIn).toBe(900);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { avatarFileId: FILE_ID },
      select: { id: true },
    });
  });

  it('非头像文件在频道读权限失败时仍 403', async () => {
    const { service } = filesHarness({ file: { channelId: CHANNEL_ID }, avatarLookup: null });
    await expect(service.url(authUser(), FILE_ID, { variant: 'original' })).rejects.toMatchObject({
      code: 'NOT_CHANNEL_MEMBER',
    });
  });

  it('有频道读权限时正常放行，且不触发头像回退查询', async () => {
    const { service, prisma } = filesHarness({
      file: { channelId: CHANNEL_ID },
      avatarLookup: null,
      assertImpl: async () => ({ channel: { id: CHANNEL_ID } }),
    });
    await expect(service.url(authUser(), FILE_ID, { variant: 'original' })).resolves.toMatchObject({
      id: FILE_ID,
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('Phase1 引用摘要 replyTo', () => {
  it('bodySnippet ≤120 字；已删消息用「（已删除）」且 deletedAt 非空', () => {
    const long = buildReplyToSummary(
      { id: 42n, senderId: OTHER_ID, body: `  ${'字'.repeat(300)}  `, deletedAt: null },
      '问道',
    );
    expect(long.bodySnippet.length).toBeLessThanOrEqual(REPLY_SNIPPET_MAX + 1);
    expect(long.bodySnippet.endsWith('…')).toBe(true);
    expect(long).toMatchObject({ id: '42', senderId: OTHER_ID, displayName: '问道', deletedAt: null });

    const deleted = buildReplyToSummary(
      { id: 43n, senderId: OTHER_ID, body: '原文', deletedAt: NOW },
      '问道',
    );
    expect(deleted.bodySnippet).toBe('（已删除）');
    expect(deleted.deletedAt).toBe(NOW.toISOString());
  });

  it('toMessageView 第三参数写入 replyTo（发送 ack/列表/线程/WS 同一投影）', () => {
    const row: MessageRowLike = {
      id: 100n,
      channelId: CHANNEL_ID,
      senderId: OWNER_ID,
      kind: 'text',
      body: '收到',
      clientMsgId: 'c1',
      parentId: null,
      threadRootId: null,
      replyToId: 42n,
      cardId: null,
      mentions: [],
      threadReplyCount: 0,
      lastReplyAt: null,
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: NOW,
    };
    const replyTo = buildReplyToSummary(
      { id: 42n, senderId: OTHER_ID, body: '请确认素材', deletedAt: null },
      '问道',
    );
    const view = toMessageView(row, [], replyTo);
    expect(view.replyToId).toBe('42');
    expect(view.replyTo).toMatchObject({ id: '42', displayName: '问道', bodySnippet: '请确认素材' });
    expect(toMessageView(row, []).replyTo).toBeNull();
  });

  it('replyToId 校验：必须存在、同频道、未删除', () => {
    expect(checkReplyTarget({ id: 1n, channelId: CHANNEL_ID, deletedAt: null }, CHANNEL_ID)).toEqual({
      ok: true,
    });
    expect(checkReplyTarget(null, CHANNEL_ID).ok).toBe(false);
    const cross = checkReplyTarget({ id: 2n, channelId: OTHER_CHANNEL_ID, deletedAt: null }, CHANNEL_ID);
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.message).toContain('不属于当前频道');
    const deleted = checkReplyTarget({ id: 3n, channelId: CHANNEL_ID, deletedAt: NOW }, CHANNEL_ID);
    expect(deleted.ok).toBe(false);
    if (!deleted.ok) expect(deleted.message).toContain('已删除');
  });
});
