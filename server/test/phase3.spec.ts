import { describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';
import { AnnouncementsService } from '../src/announcements/announcements.service';
import { AnnouncementsController } from '../src/announcements/announcements.controller';
import { updateAnnouncementSchema } from '../src/announcements/announcements.dto';
import { updateUserStatusSchema } from '../src/users/users.dto';
import { AuditAction, type AuditService } from '../src/common/audit/audit.service';
import { ROLES_KEY } from '../src/common/decorators';
import { UsersController } from '../src/users/users.controller';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { IdentityService } from '../src/common/identity/identity.service';
import type { AuthUser } from '../src/common/types/context';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-24T06:00:00.000Z');

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: OWNER_ID,
    handle: 'founder',
    displayName: '建立者',
    globalRole: 'owner',
    status: 'active',
    sessionId: 's1',
    mutedUntil: null,
    avatarFileId: null,
    statusPrefix: null,
    ...overrides,
  };
}

function userRow(overrides: Partial<User> = {}): User {
  return {
    id: TARGET_ID,
    handle: 'chen',
    displayName: '问道',
    passwordHash: '$argon2id$fake',
    avatarFileId: null,
    globalRole: 'member',
    status: 'active',
    mutedUntil: null,
    statusPrefix: null,
    isBot: false,
    createdAt: NOW,
    updatedAt: NOW,
    lastSeenAt: null,
    ...overrides,
  } as User;
}

function auditStub() {
  return { record: vi.fn(async () => undefined) };
}

function identityStub() {
  return {
    prefixesFor: vi.fn(async () => ['[站长]']),
    prefixesForMany: vi.fn(async () => ({})),
  } as unknown as IdentityService;
}

describe('Phase3 用户封禁 PATCH /users/:id/status', () => {
  it('owner 封禁 member：更新 users.status + audit user.suspend，返回 PublicUser', async () => {
    const target = userRow();
    const update = vi.fn(async ({ data }: { data: { status: 'suspended' } }) => ({ ...target, ...data }));
    const prisma = { user: { findUnique: vi.fn(async () => target), update } };
    const audit = auditStub();
    const service = new UsersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      identityStub(),
    );

    const result = await service.setUserStatus(authUser(), TARGET_ID, 'suspended');

    expect(update).toHaveBeenCalledWith({ where: { id: TARGET_ID }, data: { status: 'suspended' } });
    expect(result).toMatchObject({ id: TARGET_ID, handle: 'chen', status: 'suspended' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: OWNER_ID,
        action: AuditAction.USER_SUSPEND,
        targetKind: 'user',
        targetId: TARGET_ID,
        meta: expect.objectContaining({ from: 'active', to: 'suspended' }),
      }),
    );
  });

  it('admin 解封：audit user.activate', async () => {
    const target = userRow({ status: 'suspended' });
    const update = vi.fn(async () => ({ ...target, status: 'active' }));
    const audit = auditStub();
    const service = new UsersService(
      { user: { findUnique: vi.fn(async () => target), update } } as unknown as PrismaService,
      audit as unknown as AuditService,
      identityStub(),
    );
    const result = await service.setUserStatus(authUser({ id: ADMIN_ID, globalRole: 'admin' }), TARGET_ID, 'active');
    expect(result.status).toBe('active');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.USER_ACTIVATE }),
    );
  });

  it('不能封自己 / 不能变更 owner / 普通成员无权限', async () => {
    const prisma = {
      user: { findUnique: vi.fn(async () => userRow()), update: vi.fn() },
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      auditStub() as unknown as AuditService,
      identityStub(),
    );

    await expect(service.setUserStatus(authUser(), OWNER_ID, 'suspended')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const ownerTarget = userRow({ id: TARGET_ID, globalRole: 'owner' });
    const s2 = new UsersService(
      { user: { findUnique: vi.fn(async () => ownerTarget), update: vi.fn() } } as unknown as PrismaService,
      auditStub() as unknown as AuditService,
      identityStub(),
    );
    await expect(s2.setUserStatus(authUser(), TARGET_ID, 'suspended')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(
      service.setUserStatus(authUser({ globalRole: 'member' }), TARGET_ID, 'suspended'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('状态未变化时幂等：不写库、不写审计', async () => {
    const target = userRow({ status: 'active' });
    const update = vi.fn();
    const audit = auditStub();
    const service = new UsersService(
      { user: { findUnique: vi.fn(async () => target), update } } as unknown as PrismaService,
      audit as unknown as AuditService,
      identityStub(),
    );
    const result = await service.setUserStatus(authUser(), TARGET_ID, 'active');
    expect(result.status).toBe('active');
    expect(update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('DTO/路由：status 只允许 active|suspended；PATCH 角色 owner|admin', () => {
    expect(updateUserStatusSchema.safeParse({ status: 'suspended' }).success).toBe(true);
    expect(updateUserStatusSchema.safeParse({ status: 'deleted' }).success).toBe(false);
    const roles = Reflect.getMetadata(ROLES_KEY, UsersController.prototype.updateStatus) as string[];
    expect(roles).toEqual(['owner', 'admin']);
  });
});

describe('Phase3 suspended 后登录/刷新被拒绝', () => {
  const suspended = userRow({ status: 'suspended' });

  it('login：账号 suspended → FORBIDDEN（不再校验密码），写 LOGIN_FAILED 审计', async () => {
    const audit = auditStub();
    const passwords = { verify: vi.fn() };
    const service = new AuthService(
      { user: { findUnique: vi.fn(async () => suspended) } } as unknown as PrismaService,
      passwords as never,
      { issueAccess: vi.fn() } as never,
      { incrWithWindow: vi.fn(async () => 1) } as never,
      {} as never,
      audit as unknown as AuditService,
    );
    await expect(
      service.login({ handle: 'chen', password: 'whatever' }, {}),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.LOGIN_FAILED,
        targetId: suspended.id,
        meta: expect.objectContaining({ reason: 'suspended' }),
      }),
    );
  });

  it('refresh：session 对应用户 suspended → FORBIDDEN', async () => {
    const session = {
      id: 'session-1',
      userId: suspended.id,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      user: suspended,
    };
    const service = new AuthService(
      { session: { findUnique: vi.fn(async () => session) } } as unknown as PrismaService,
      {} as never,
      { hashRefreshToken: vi.fn(() => 'hash') } as never,
      {} as never,
      {} as never,
      auditStub() as unknown as AuditService,
    );
    await expect(service.refresh('refresh-token', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('Phase3 全服公告', () => {
  function announcementsHarness(options: {
    currentRows?: Array<{ body: string; level: string; updated_at: Date }>;
    executeRaw?: ReturnType<typeof vi.fn>;
  } = {}) {
    const executeRaw = options.executeRaw ?? vi.fn(async () => 1);
    const tx = { $executeRaw: executeRaw };
    const queryRaw = vi.fn(async () => options.currentRows ?? []);
    const prisma = {
      $queryRaw: queryRaw,
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const audit = auditStub();
    const service = new AnnouncementsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    return { service, prisma, audit, executeRaw };
  }

  it('GET current：active 行返回 body/level/updatedAt；无行返回 null', async () => {
    const one = announcementsHarness({
      currentRows: [{ body: '今晚 20:00 全服维护', level: 'warning', updated_at: NOW }],
    });
    await expect(one.service.getCurrent()).resolves.toEqual({
      announcement: {
        id: 'default',
        body: '今晚 20:00 全服维护',
        level: 'warning',
        updatedAt: NOW.toISOString(),
      },
    });
    const none = announcementsHarness({ currentRows: [] });
    await expect(none.service.getCurrent()).resolves.toEqual({ announcement: null });
  });

  it('PUT 非空 body：事务内 upsert（active=true）并写 audit announcement.update', async () => {
    const harness = announcementsHarness({
      currentRows: [{ body: '新公告', level: 'info', updated_at: NOW }],
    });
    const result = await harness.service.update(authUser({ globalRole: 'admin' }), {
      body: '  新公告  ',
      level: 'info',
    });
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(harness.executeRaw).toHaveBeenCalledTimes(1);
    expect(result.announcement?.body).toBe('新公告');
    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ANNOUNCEMENT_UPDATE,
        targetId: 'default',
        meta: expect.objectContaining({ active: true, level: 'info' }),
      }),
    );
  });

  it('PUT 空 body：关闭（executeRaw 更新 active=false），GET 返回 null，保留审计', async () => {
    const harness = announcementsHarness({ currentRows: [] });
    const result = await harness.service.update(authUser(), { body: '   ', level: 'info' });
    expect(result).toEqual({ announcement: null });
    expect(harness.executeRaw).toHaveBeenCalledTimes(1);
    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ active: false }) }),
    );
  });

  it('普通成员写公告 → FORBIDDEN，且不开启事务', async () => {
    const harness = announcementsHarness();
    await expect(
      harness.service.update(authUser({ globalRole: 'member' }), { body: 'x', level: 'info' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('DTO：body ≤2000、level 枚举、空 body 合法（关闭）', () => {
    expect(updateAnnouncementSchema.safeParse({ body: 'x'.repeat(2000), level: 'warning' }).success).toBe(true);
    expect(updateAnnouncementSchema.safeParse({ body: 'x'.repeat(2001), level: 'info' }).success).toBe(false);
    expect(updateAnnouncementSchema.safeParse({ body: '', level: 'info' }).success).toBe(true);
    expect(updateAnnouncementSchema.safeParse({ body: 'ok', level: 'fatal' }).success).toBe(false);
    const roles = Reflect.getMetadata(ROLES_KEY, AnnouncementsController.prototype.update) as string[];
    expect(roles).toEqual(['owner', 'admin']);
  });

  it('audit 动作常量与任务约定一致', () => {
    expect(AuditAction.USER_SUSPEND).toBe('user.suspend');
    expect(AuditAction.USER_ACTIVATE).toBe('user.activate');
    expect(AuditAction.ANNOUNCEMENT_UPDATE).toBe('announcement.update');
  });
});
