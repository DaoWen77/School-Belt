import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { RealtimeService } from '../src/common/realtime/realtime.service';
import type { IdentityService } from '../src/common/identity/identity.service';
import type { AuthUser } from '../src/common/types/context';
import type { User } from '@prisma/client';
import { UsersService } from '../src/users/users.service';
import { updateProfileSchema } from '../src/users/users.dto';
import { ConversationsService } from '../src/conversations/conversations.service';
import {
  canDissolveConversation,
  canEditAnnouncement,
  checkAnnouncement,
  normalizeAnnouncement,
} from '../src/conversations/conversation-rules';

const NOW = new Date('2026-10-23T10:00:00.000Z');
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: OWNER_ID,
    handle: 'owner',
    displayName: '群主',
    globalRole: 'member',
    status: 'active',
    sessionId: 'session-1',
    mutedUntil: null,
    avatarFileId: null,
    statusPrefix: null,
    ...overrides,
  };
}

function userRow(overrides: Partial<User> = {}): User {
  return {
    id: OWNER_ID,
    handle: 'owner',
    displayName: '群主',
    passwordHash: 'hash',
    avatarFileId: null,
    globalRole: 'member',
    status: 'active',
    mutedUntil: null,
    statusPrefix: null,
    createdAt: NOW,
    updatedAt: NOW,
    lastSeenAt: null,
    ...overrides,
  } as User;
}

function groupChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: '测绘图小组',
    slug: 'group-test',
    kind: 'group',
    surface: 'internal',
    dmKey: null,
    announcement: null,
    archivedAt: null,
    lastMessageAt: null,
    createdAt: NOW,
    createdBy: OWNER_ID,
    ...overrides,
  };
}

/** 最小 Prisma fake：只实现被测方法，参数用 vi.fn 捕获 */
function conversationFakes(
  channel: Record<string, unknown>,
  role: 'member' | 'moderator' = 'moderator',
) {
  const tx = {
    channel: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...channel, ...data })),
    },
    message: { deleteMany: vi.fn(), updateMany: vi.fn() },
    channelMember: { deleteMany: vi.fn(), delete: vi.fn() },
  };
  const prisma = {
    channel: {
      findUnique: vi.fn(async () => channel),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...channel, ...data })),
    },
    channelMember: {
      findUnique: vi.fn(async () => ({ role })),
      findMany: vi.fn(async () => [
        { channelId: channel.id, userId: OWNER_ID, role, lastReadSeq: 0n, joinedAt: NOW },
        { channelId: channel.id, userId: MEMBER_ID, role: 'member', lastReadSeq: 0n, joinedAt: NOW },
      ]),
    },
    user: { findMany: vi.fn(async () => []) },
    message: {
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const realtime = { emitToUser: vi.fn() };
  return { prisma, realtime, tx };
}

function serviceWith(prisma: unknown, realtime: unknown): ConversationsService {
  return new ConversationsService(
    prisma as PrismaService,
    realtime as RealtimeService,
    undefined as never,
  );
}

describe('Sprint1 纯规则（v1.2 Sprint1）', () => {
  const header = (kind: 'dm' | 'group') => ({
    id: 'c1',
    kind,
    memberIds: [OWNER_ID, MEMBER_ID],
  });

  it('群公告仅群聊 moderator 可改', () => {
    expect(canEditAnnouncement(header('group'), OWNER_ID, 'moderator').ok).toBe(true);
    expect(canEditAnnouncement(header('group'), MEMBER_ID, 'member').ok).toBe(false);
    expect(canEditAnnouncement(header('dm'), OWNER_ID, 'moderator').ok).toBe(false);
  });

  it('解散仅群主（createdBy）可执行，且仅限群聊', () => {
    expect(canDissolveConversation(header('group'), OWNER_ID, OWNER_ID).ok).toBe(true);
    const denied = canDissolveConversation(header('group'), MEMBER_ID, OWNER_ID);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('FORBIDDEN');
    const kindInvalid = canDissolveConversation(header('dm'), OWNER_ID, OWNER_ID);
    expect(kindInvalid.ok).toBe(false);
    if (!kindInvalid.ok) expect(kindInvalid.code).toBe('CONVERSATION_KIND_INVALID');
  });

  it('公告长度 ≤4000，空串归一为 null', () => {
    expect(checkAnnouncement('a'.repeat(4000)).ok).toBe(true);
    expect(checkAnnouncement('a'.repeat(4001)).ok).toBe(false);
    expect(normalizeAnnouncement('  ')).toBeNull();
    expect(normalizeAnnouncement('  公告  ')).toBe('公告');
  });
});

function identityStub() {
  return {
    prefixesFor: vi.fn(async () => ['[极光科技]']),
    prefixesForMany: vi.fn(async () => ({})),
  } as unknown as IdentityService;
}

describe('statusPrefix（PATCH /me）', () => {
  it('DTO 支持设置 / 清除 / 未传三种语义', () => {
    expect(updateProfileSchema.parse({ statusPrefix: '  加班中 ' }).statusPrefix).toBe('加班中');
    expect(updateProfileSchema.parse({ statusPrefix: null }).statusPrefix).toBeNull();
    expect(updateProfileSchema.parse({ statusPrefix: '' }).statusPrefix).toBeNull();
    expect(updateProfileSchema.parse({}).statusPrefix).toBeUndefined();
  });

  it('updateProfile 写入 statusPrefix 并在 PublicUser 中返回', async () => {
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => userRow({ ...data }));
    const prisma = { user: { update }, file: { findUnique: vi.fn() } };
    const service = new UsersService(prisma as unknown as PrismaService, undefined as never, identityStub());
    const result = await service.updateProfile(OWNER_ID, { statusPrefix: '加班中' });
    expect(update.mock.calls[0]?.[0].data).toMatchObject({ statusPrefix: '加班中' });
    expect(result.statusPrefix).toBe('加班中');
  });

  it('未传 statusPrefix 时不会清空已有值', async () => {
    const update = vi.fn(async () => userRow({ statusPrefix: '值班' }));
    const prisma = { user: { update }, file: { findUnique: vi.fn() } };
    const service = new UsersService(prisma as unknown as PrismaService, undefined as never, identityStub());
    await service.updateProfile(OWNER_ID, { displayName: '新名字' });
    expect(update.mock.calls[0]?.[0].data).not.toHaveProperty('statusPrefix');
  });
});

describe('群公告服务：权限与广播', () => {
  it('普通成员改公告 → FORBIDDEN，且不写库', async () => {
    const channel = groupChannel();
    const { prisma, realtime } = conversationFakes(channel, 'member');
    await expect(
      serviceWith(prisma, realtime).updateAnnouncement(authUser(), String(channel.id), {
        announcement: '公告',
      }),
    ).rejects.toMatchObject({ httpStatus: 403 });
    expect(prisma.channel.update).not.toHaveBeenCalled();
  });

  it('群主改公告 → 写库并返回 announcement', async () => {
    const channel = groupChannel();
    const { prisma, realtime } = conversationFakes(channel, 'moderator');
    const view = await serviceWith(prisma, realtime).updateAnnouncement(
      authUser(),
      String(channel.id),
      { announcement: '  周五归档  ' },
    );
    expect(prisma.channel.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { announcement: '周五归档' } }),
    );
    expect(view.announcement).toBe('周五归档');
  });
});

describe('解散群聊：群主 + 事务归档', () => {
  it('非群主 → FORBIDDEN，不开启事务', async () => {
    const channel = groupChannel();
    const { prisma, realtime } = conversationFakes(channel);
    await expect(
      serviceWith(prisma, realtime).dissolve(authUser({ id: MEMBER_ID }), String(channel.id)),
    ).rejects.toMatchObject({ httpStatus: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('DM 解散 → CONVERSATION_KIND_INVALID', async () => {
    const dm = groupChannel({ kind: 'dm' });
    const { prisma, realtime } = conversationFakes(dm);
    await expect(
      serviceWith(prisma, realtime).dissolve(authUser(), String(dm.id)),
    ).rejects.toMatchObject({ code: 'CONVERSATION_KIND_INVALID' });
  });

  it('群主解散：事务内只置 archived_at，保留消息/成员，并向每个成员 emit conversation:removed', async () => {
    const channel = groupChannel();
    const { prisma, realtime, tx } = conversationFakes(channel);
    const result = await serviceWith(prisma, realtime).dissolve(authUser(), String(channel.id));

    expect(result).toEqual({ archived: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.channel.update).toHaveBeenCalledWith({
      where: { id: channel.id },
      data: { archivedAt: expect.any(Date) },
    });
    // 软归档：不得物理删除消息 / 成员
    expect(tx.message.deleteMany).not.toHaveBeenCalled();
    expect(tx.channelMember.deleteMany).not.toHaveBeenCalled();
    expect(tx.channelMember.delete).not.toHaveBeenCalled();
    // 每个成员都收到 conversation:removed
    expect(realtime.emitToUser).toHaveBeenCalledTimes(2);
    expect(realtime.emitToUser).toHaveBeenCalledWith(MEMBER_ID, 'conversation:removed', {
      conversationId: channel.id,
      reason: 'dissolved',
    });
  });

  it('事务失败时不发 conversation:removed（回滚语义）', async () => {
    const channel = groupChannel();
    const { prisma, realtime, tx } = conversationFakes(channel);
    tx.channel.update.mockRejectedValueOnce(new Error('db down'));
    await expect(
      serviceWith(prisma, realtime).dissolve(authUser(), String(channel.id)),
    ).rejects.toThrow('db down');
    // 事务未提交：不能向成员广播“已移除”
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });
});

describe('归档后列表不可见', () => {
  it('list() 的查询条件必须带 archivedAt: null', async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      channelMember: { findMany: vi.fn(async () => [{ channelId: 'c1' }]) },
      channel: { findMany },
    };
    const realtime = { emitToUser: vi.fn() };
    await serviceWith(prisma, realtime).list(authUser());
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
          OR: expect.arrayContaining([
            expect.objectContaining({ kind: { in: ['dm', 'group'] }, surface: 'internal' }),
            expect.objectContaining({ kind: 'dm', surface: 'bridge' }),
          ]),
        }),
      }),
    );
  });
});
