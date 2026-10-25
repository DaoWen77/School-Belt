import { Injectable } from '@nestjs/common';
import type { User, UserSetting } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import {
  IdentityService,
  compareOrganizationIdentity,
  organizationPrefix,
  pickOrganizationIdentity,
  type OrganizationIdentityChoice,
} from '../common/identity/identity.service';
import type { AuthUser } from '../common/types/context';
import type {
  CreateDeviceDto,
  ListUsersQuery,
  PublicUser,
  UpdateDisplayOrganizationDto,
  UpdateProfileDto,
  UpdateSettingsDto,
} from './users.dto';

/** "HH:mm(:ss)" → 1970-01-01 的 Date（Prisma time 列） */
function parseTimeOfDay(value: string | null): Date | null {
  if (value === null) return null;
  const [hours = '0', minutes = '0', seconds = '0'] = value.split(':');
  return new Date(Date.UTC(1970, 0, 1, Number(hours), Number(minutes), Number(seconds)));
}

function formatTimeOfDay(value: Date | null): string | null {
  if (!value) return null;
  const hh = String(value.getUTCHours()).padStart(2, '0');
  const mm = String(value.getUTCMinutes()).padStart(2, '0');
  const ss = String(value.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
  ) {}

  /**
   * Phase3：封禁/解封（仅 owner/admin）。
   * - 不能改自己，也不能改 owner（防误操作/权限自锁）；
   * - 只改 `users.status`，历史消息/会话保留；suspended 后登录/refresh 由 AuthService 拒绝；
   * - 写 audit_logs：`user.suspend` / `user.activate`。
   */
  async setUserStatus(
    actor: AuthUser,
    targetId: string,
    status: 'active' | 'suspended',
  ): Promise<PublicUser> {
    if (actor.globalRole !== 'owner' && actor.globalRole !== 'admin') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅协议官或档案员可封禁/解封账号');
    }
    if (actor.id === targetId) {
      throw new AppError(ErrorCode.FORBIDDEN, '不能修改自己的账号状态');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new AppError(ErrorCode.VALIDATION_FAILED, '用户不存在', { userId: targetId });
    if (target.globalRole === 'owner') {
      throw new AppError(ErrorCode.FORBIDDEN, '不能变更 owner 的账号状态');
    }
    if (target.status === status) {
      return this.toPublicUser(target, await this.identity.prefixesFor(target.id));
    }

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { status },
    });
    await this.audit.record({
      actorId: actor.id,
      action: status === 'suspended' ? AuditAction.USER_SUSPEND : AuditAction.USER_ACTIVATE,
      targetKind: 'user',
      targetId,
      meta: { from: target.status, to: status, handle: target.handle },
    });
    return this.toPublicUser(updated, await this.identity.prefixesFor(updated.id));
  }

  toPublicUser(user: User, prefixes?: string[]): PublicUser {
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      globalRole: user.globalRole,
      status: user.status,
      avatarFileId: user.avatarFileId,
      statusPrefix: user.statusPrefix,
      isInternal: user.isInternal,
      accountOrigin: user.accountOrigin,
      tags: user.tags,
      prefixes: prefixes ?? IdentityService.systemPrefixes(user),
      displayOrganizationId: user.displayOrganizationId,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    };
  }

  async list(query: ListUsersQuery): Promise<{ users: PublicUser[] }> {
    const users = await this.prisma.user.findMany({
      // 内部用户目录不展示外网账号；外网账号只能走环带自己的用户接口。
      where: {
        isInternal: true,
        ...(query.q
          ? {
              OR: [
                { handle: { contains: query.q } },
                { displayName: { contains: query.q } },
              ],
            }
          : {}),
      },
      orderBy: [{ globalRole: 'asc' }, { handle: 'asc' }],
      take: query.limit,
    });
    const prefixes = await this.identity.prefixesForMany(users);
    return {
      users: users.map((user) => this.toPublicUser(user, prefixes[user.id])),
    };
  }

  async getById(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError(ErrorCode.VALIDATION_FAILED, '用户不存在', { userId: id });
    return this.toPublicUser(user, await this.identity.prefixesFor(user.id));
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.AUTH_INVALID);
    const [settings, prefixes] = await Promise.all([
      this.ensureSettings(userId),
      this.identity.prefixesFor(userId),
    ]);
    return { user: this.toPublicUser(user, prefixes), settings: this.toSettingsView(settings) };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    if (dto.avatarFileId) {
      const file = await this.prisma.file.findUnique({
        where: { id: dto.avatarFileId },
        select: { ownerId: true, kind: true, status: true },
      });
      if (!file || file.ownerId !== userId || file.kind !== 'image' || file.status !== 'ready') {
        throw new AppError(ErrorCode.FILE_NOT_READY, '头像必须是本人已就绪的图片');
      }
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.avatarFileId !== undefined ? { avatarFileId: dto.avatarFileId } : {}),
        // transformer 已把 undefined（未传）/null/空串归一为 null；只有显式出现才更新
        ...(dto.statusPrefix !== undefined ? { statusPrefix: dto.statusPrefix } : {}),
      },
    });
    return this.toPublicUser(user, await this.identity.prefixesFor(user.id));
  }

  /** 多组织：当前用户可展示的 active 组织 + 权重默认值。 */
  async organizationOptions(userId: string) {
    const [user, rows] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayOrganizationId: true },
      }),
      this.prisma.organizationMember.findMany({
        where: {
          userId,
          status: 'active',
          organization: { status: 'active' },
        },
        select: {
          organizationId: true,
          role: true,
          joinedAt: true,
          organization: { select: { name: true } },
        },
      }),
    ]);
    if (!user) throw new AppError(ErrorCode.AUTH_INVALID);

    const choices: OrganizationIdentityChoice[] = rows.map((row) => ({
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      role: row.role,
      joinedAt: row.joinedAt,
    }));
    const defaultChoice = pickOrganizationIdentity(choices, null);
    const effective = pickOrganizationIdentity(choices, user.displayOrganizationId);
    return {
      selectedOrganizationId: user.displayOrganizationId,
      effectiveOrganizationId: effective?.organizationId ?? null,
      options: [...choices]
        .sort(compareOrganizationIdentity)
        .map((choice) => ({
          id: choice.organizationId,
          name: choice.organizationName,
          role: choice.role,
          prefix: organizationPrefix(choice),
          isDefault: choice.organizationId === defaultChoice?.organizationId,
          isSelected: choice.organizationId === effective?.organizationId,
        })),
    };
  }

  /** 切换“当前展示身份”；null 恢复自动权重。 */
  async updateDisplayOrganization(userId: string, dto: UpdateDisplayOrganizationDto) {
    if (dto.organizationId) {
      const membership = await this.prisma.organizationMember.findFirst({
        where: {
          userId,
          organizationId: dto.organizationId,
          status: 'active',
          organization: { status: 'active' },
        },
        select: { id: true },
      });
      if (!membership) {
        throw new AppError(ErrorCode.ORGANIZATION_NOT_FOUND, '只能展示本人已加入且已启用的组织');
      }
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { displayOrganizationId: dto.organizationId },
    });
    return {
      user: this.toPublicUser(updated, await this.identity.prefixesFor(userId)),
      ...(await this.organizationOptions(userId)),
    };
  }

  async getSettings(userId: string) {
    return this.toSettingsView(await this.ensureSettings(userId));
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    await this.ensureSettings(userId);
    const updated = await this.prisma.userSetting.update({
      where: { userId },
      data: {
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
        ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
        ...(dto.notifyLevel !== undefined ? { notifyLevel: dto.notifyLevel } : {}),
        ...(dto.dndEnabled !== undefined ? { dndEnabled: dto.dndEnabled } : {}),
        ...(dto.dndStart !== undefined ? { dndStart: parseTimeOfDay(dto.dndStart) } : {}),
        ...(dto.dndEnd !== undefined ? { dndEnd: parseTimeOfDay(dto.dndEnd) } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.pushWeb !== undefined ? { pushWeb: dto.pushWeb } : {}),
        ...(dto.pushAndroid !== undefined ? { pushAndroid: dto.pushAndroid } : {}),
        ...(dto.digestWindow !== undefined ? { digestWindow: dto.digestWindow } : {}),
      },
    });
    return this.toSettingsView(updated);
  }

  async addDevice(userId: string, dto: CreateDeviceDto) {
    const existing = dto.pushToken
      ? await this.prisma.device.findFirst({
          where: { userId, platform: dto.platform, pushToken: dto.pushToken },
          select: { id: true },
        })
      : null;

    const device = existing
      ? await this.prisma.device.update({
          where: { id: existing.id },
          data: {
            name: dto.name,
            lastActiveAt: new Date(),
            ...(dto.pushProvider !== undefined ? { pushProvider: dto.pushProvider } : {}),
          },
        })
      : await this.prisma.device.create({
          data: {
            userId,
            platform: dto.platform,
            name: dto.name,
            pushProvider: dto.pushProvider ?? null,
            pushToken: dto.pushToken ?? null,
            pushKeys: dto.pushKeys ? (dto.pushKeys as object) : undefined,
            lastActiveAt: new Date(),
          },
        });

    return {
      id: device.id,
      platform: device.platform,
      name: device.name,
      pushProvider: device.pushProvider,
      createdAt: device.createdAt.toISOString(),
    };
  }

  async removeDevice(userId: string, deviceId: string): Promise<{ id: string }> {
    const deleted = await this.prisma.device.deleteMany({ where: { id: deviceId, userId } });
    if (deleted.count === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '设备不存在', { deviceId });
    }
    return { id: deviceId };
  }

  async listDevices(userId: string) {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      devices: devices.map((device) => ({
        id: device.id,
        platform: device.platform,
        name: device.name,
        pushProvider: device.pushProvider,
        lastActiveAt: device.lastActiveAt?.toISOString() ?? null,
        createdAt: device.createdAt.toISOString(),
      })),
    };
  }

  /**
   * GET /me/tasks（Sprint2）：当前用户被指派、未完成、未关闭、会话未归档的任务卡。
   * 条件：card_assignees.user_id=me、cards.task_status != 'done'、cards.status='open'、
   *       cards.deleted_at IS NULL、channels.archived_at IS NULL；dueAt asc null last。
   */
  async listMyTasks(userId: string) {
    const cards = await this.prisma.card.findMany({
      where: {
        status: 'open',
        taskStatus: { not: 'done' },
        deletedAt: null,
        channel: { archivedAt: null },
        assignees: { some: { userId } },
      },
      select: {
        id: true,
        title: true,
        kind: true,
        taskStatus: true,
        dueAt: true,
        updatedAt: true,
        channel: { select: { id: true, name: true } },
      },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });
    return {
      tasks: cards.map((card) => ({
        cardId: card.id,
        title: card.title,
        taskStatus: card.taskStatus,
        dueAt: card.dueAt?.toISOString() ?? null,
        channelId: card.channel.id,
        channelName: card.channel.name,
        kind: card.kind,
        updatedAt: card.updatedAt.toISOString(),
      })),
    };
  }

  private async ensureSettings(userId: string): Promise<UserSetting> {
    return this.prisma.userSetting.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private toSettingsView(settings: UserSetting) {
    return {
      locale: settings.locale,
      theme: settings.theme,
      notifyLevel: settings.notifyLevel,
      dndEnabled: settings.dndEnabled,
      dndStart: formatTimeOfDay(settings.dndStart),
      dndEnd: formatTimeOfDay(settings.dndEnd),
      timezone: settings.timezone,
      pushWeb: settings.pushWeb,
      pushAndroid: settings.pushAndroid,
      digestWindow: settings.digestWindow,
    };
  }
}
