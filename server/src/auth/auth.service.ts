import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Session, type User } from '@prisma/client';
import { AppConfig } from '../config/config.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { hashInviteCode, inviteCodePrefix, normalizeInviteCode } from '../common/utils/crypto';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import { IdentityService } from '../common/identity/identity.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { SurfaceName } from '../common/types/context';
import type {
  BeltRegisterDto,
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  RegisterDto,
} from './auth.dto';

export interface AuthResult {
  user: {
    id: string;
    handle: string;
    displayName: string;
    globalRole: string;
    avatarFileId: string | null;
    statusPrefix: string | null;
    isInternal: boolean;
    accountOrigin: SurfaceName;
    tags: string[];
    /** 系统证章 → 组织证章，例如 ['[站长]Official', '[测绘组]'] */
    prefixes: string[];
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const PUBLIC_USER_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  globalRole: true,
  avatarFileId: true,
  statusPrefix: true,
  isInternal: true,
  accountOrigin: true,
  tags: true,
} satisfies Prisma.UserSelect;

/**
 * 认证服务：
 * - 邀请注册：单事务 + `UPDATE ... WHERE uses < max_uses` 原子扣减（契约 §5）
 * - 登录：argon2id 校验 + 账号级限流（10 次/小时）
 * - refresh：轮换；旧 token 再次使用视为泄露，撤销该用户全部会话
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResult> {
    const codeHash = hashInviteCode(dto.inviteCode);
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const result = await this.prisma.withTransaction(async (tx) => {
        const invite = await tx.invite.findUnique({
          where: { codeHash },
          select: {
            id: true,
            role: true,
            maxUses: true,
            uses: true,
            expiresAt: true,
            revokedAt: true,
          },
        });
        if (!invite || this.isInviteUnusable(invite)) {
          throw new AppError(ErrorCode.INVITE_INVALID);
        }

        // 原子扣减：并发注册时只有一个事务能拿到名额
        const claimed = await tx.invite.updateMany({
          where: {
            id: invite.id,
            revokedAt: null,
            expiresAt: { gt: new Date() },
            uses: { lt: invite.maxUses },
          },
          data: { uses: { increment: 1 } },
        });
        if (claimed.count === 0) throw new AppError(ErrorCode.INVITE_INVALID);

        const user = await tx.user.create({
          data: {
            handle: dto.handle,
            displayName: dto.displayName,
            passwordHash,
            globalRole: invite.role,
            // 内部邀请注册 = 从出生起就是内部账号；触发器和 CHECK 会同步 is_internal。
            tags: ['[站长]'],
            accountOrigin: 'internal',
            lastSeenAt: new Date(),
          },
          select: PUBLIC_USER_SELECT,
        });

        await tx.userSetting.create({ data: { userId: user.id } });

        const session = await this.createSession(tx, user.id, meta, 'internal', dto.deviceName);
        const access = await this.tokens.issueAccess(user, session.id, 'internal');
        return {
          user: this.toPublicUser(user),
          accessToken: access.accessToken,
          refreshToken: session.refreshToken,
          expiresIn: access.expiresIn,
        };
      });
      await this.audit.record({
        actorId: result.user.id,
        action: AuditAction.REGISTER,
        targetKind: 'user',
        targetId: result.user.id,
        meta: { handle: dto.handle, surface: 'internal' },
        ip: meta.ip,
      });
      return this.attachIdentity(result);
    } catch (error) {
      if (PrismaService.isUniqueViolation(error)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '该 handle 已被占用', { field: 'handle' });
      }
      throw error;
    }
  }

  async login(
    dto: LoginDto,
    meta: RequestMeta,
    surface: SurfaceName = 'internal',
  ): Promise<AuthResult> {
    const handle = dto.handle.trim().toLowerCase();
    await this.enforceLoginRateLimit(handle);

    const user = await this.prisma.user.findUnique({ where: { handle } });
    if (!user) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        meta: { handle, reason: 'user_not_found' },
        ip: meta.ip,
      });
      throw new AppError(ErrorCode.AUTH_INVALID);
    }
    if (user.status === 'suspended') {
      await this.audit.record({
        actorId: user.id,
        action: AuditAction.LOGIN_FAILED,
        targetKind: 'user',
        targetId: user.id,
        meta: { handle, reason: 'suspended' },
        ip: meta.ip,
      });
      throw new AppError(ErrorCode.FORBIDDEN, '账号已被封禁，请联系协议官');
    }

    const matched = await this.passwords.verify(user.passwordHash, dto.password);
    if (!matched) {
      await this.audit.record({
        actorId: user.id,
        action: AuditAction.LOGIN_FAILED,
        targetKind: 'user',
        targetId: user.id,
        meta: { handle, reason: 'bad_password' },
        ip: meta.ip,
      });
      throw new AppError(ErrorCode.AUTH_INVALID);
    }

    // 密码已经验证通过后再判断面，避免向未持有密码的人暴露账号是否内部。
    if (surface === 'internal' && !user.isInternal) {
      await this.audit.record({
        actorId: user.id,
        action: AuditAction.BELT_ACCESS_DENIED,
        targetKind: 'user',
        targetId: user.id,
        meta: { handle, reason: 'internal_login_without_tag', surface },
        ip: meta.ip,
      });
      throw new AppError(
        ErrorCode.PROTOCOL_DENIED,
        '协议拒绝：未授权链路（缺少 [站长] 身份标签）',
      );
    }

    const result = await this.prisma.withTransaction(async (tx) => {
      const session = await this.createSession(tx, user.id, meta, surface, dto.deviceName);
      await tx.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
      const access = await this.tokens.issueAccess(user, session.id, surface);
      return {
        user: this.toPublicUser(user),
        accessToken: access.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: access.expiresIn,
      };
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.LOGIN_SUCCESS,
      targetKind: 'user',
      targetId: user.id,
      meta: { handle, surface },
      ip: meta.ip,
    });
    return this.attachIdentity(result);
  }

  /**
   * 环塔自助注册：不消耗内部邀请码，出生面固定为 belt，不授予 `[站长]`。
   * 与内部邀请注册完全分开，防止外网用户绕过邀请直接拿到内部身份。
   */
  async registerBelt(dto: BeltRegisterDto, meta: RequestMeta): Promise<AuthResult> {
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      const result = await this.prisma.withTransaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            handle: dto.handle,
            displayName: dto.displayName,
            passwordHash,
            globalRole: 'member',
            tags: [],
            accountOrigin: 'belt',
            lastSeenAt: new Date(),
          },
          select: PUBLIC_USER_SELECT,
        });
        await tx.userSetting.create({ data: { userId: user.id } });
        const session = await this.createSession(tx, user.id, meta, 'belt', dto.deviceName);
        const access = await this.tokens.issueAccess(user, session.id, 'belt');
        return {
          user: this.toPublicUser(user),
          accessToken: access.accessToken,
          refreshToken: session.refreshToken,
          expiresIn: access.expiresIn,
        };
      });
      await this.audit.record({
        actorId: result.user.id,
        action: AuditAction.REGISTER,
        targetKind: 'user',
        targetId: result.user.id,
        meta: { handle: dto.handle, surface: 'belt' },
        ip: meta.ip,
      });
      return this.attachIdentity(result);
    } catch (error) {
      if (PrismaService.isUniqueViolation(error)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '该 handle 已被占用', { field: 'handle' });
      }
      throw error;
    }
  }

  /**
   * 交接码兑换专用：不校验密码，只信任 HandoffService 已消费且校验过的 userId。
   * 仍然重新检查封禁、内部标签与目标面，避免交接期间状态变化。
   */
  async issueSessionForUser(
    userId: string,
    surface: SurfaceName,
    meta: RequestMeta,
    deviceName?: string,
  ): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.AUTH_INVALID);
    if (user.status === 'suspended') {
      throw new AppError(ErrorCode.FORBIDDEN, '账号已被封禁，请联系协议官');
    }
    if (surface === 'internal' && !user.isInternal) {
      throw new AppError(
        ErrorCode.PROTOCOL_DENIED,
        '协议拒绝：未授权链路（缺少 [站长] 身份标签）',
      );
    }

    const result = await this.prisma.withTransaction(async (tx) => {
      const session = await this.createSession(tx, user.id, meta, surface, deviceName);
      await tx.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
      const access = await this.tokens.issueAccess(user, session.id, surface);
      return {
        user: this.toPublicUser(user),
        accessToken: access.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: access.expiresIn,
      };
    });
    return this.attachIdentity(result);
  }

  async refresh(
    refreshToken: string,
    meta: RequestMeta,
    expectedSurface: SurfaceName,
  ): Promise<AuthResult> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session) throw new AppError(ErrorCode.AUTH_INVALID);

    // 环塔 refresh 端点不能兑换内部 refresh token；反之亦然。
    if (session.surface !== expectedSurface) {
      throw new AppError(ErrorCode.SURFACE_MISMATCH, '刷新凭证不属于当前链路');
    }

    if (session.revokedAt) {
      // 旧 token 被重复使用：判定为泄露，撤销该用户全部会话（refresh token 轮换的安全底线）
      await this.revokeAllSessions(session.userId, 'reuse-detected');
      this.logger.warn(`检测到 refresh token 重放，已撤销用户 ${session.userId} 全部会话`);
      throw new AppError(ErrorCode.AUTH_INVALID, '登录状态已失效，请重新登录');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.AUTH_INVALID, '登录已过期，请重新登录');
    }
    if (session.user.status === 'suspended') {
      throw new AppError(ErrorCode.FORBIDDEN, '账号已被封禁');
    }
    // 标签被撤销后，旧 refresh 也不能再换出内部会话。
    if (session.surface === 'internal' && !session.user.isInternal) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new AppError(ErrorCode.PROTOCOL_DENIED);
    }

    const result = await this.prisma.withTransaction(async (tx) => {
      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      const created = await this.createSession(
        tx,
        session.userId,
        meta,
        session.surface,
        undefined,
        session.id,
      );
      const access = await this.tokens.issueAccess(session.user, created.id, session.surface);
      return {
        user: this.toPublicUser(session.user),
        accessToken: access.accessToken,
        refreshToken: created.refreshToken,
        expiresIn: access.expiresIn,
      };
    });
    return this.attachIdentity(result);
  }

  async logout(userId: string, sessionId: string, dto: LogoutDto): Promise<{ revoked: number }> {
    if (dto.allDevices) {
      const count = await this.revokeAllSessions(userId, 'logout-all');
      return { revoked: count };
    }
    if (dto.refreshToken) {
      const tokenHash = this.tokens.hashRefreshToken(dto.refreshToken);
      const result = await this.prisma.session.updateMany({
        where: { tokenHash, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { revoked: result.count };
    }
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: result.count };
  }

  async changePassword(userId: string, currentSessionId: string, dto: ChangePasswordDto): Promise<{ revokedOthers: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw new AppError(ErrorCode.AUTH_INVALID);

    const matched = await this.passwords.verify(user.passwordHash, dto.currentPassword);
    if (!matched) throw new AppError(ErrorCode.AUTH_INVALID, '当前密码不正确');

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // 改密后踢掉其他设备，保留当前会话
    const revoked = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date() },
    });
    return { revokedOthers: revoked.count };
  }

  /** 邀请码预览（公开）：只返回是否有效 + 邀请人显示名，不泄露用量等敏感信息 */
  async previewInvite(rawCode: string): Promise<{ valid: boolean; inviterDisplayName: string | null }> {
    const codeHash = hashInviteCode(rawCode);
    const invite = await this.prisma.invite.findUnique({
      where: { codeHash },
      select: {
        maxUses: true,
        uses: true,
        expiresAt: true,
        revokedAt: true,
        createdBy: true,
      },
    });
    if (!invite || this.isInviteUnusable(invite)) {
      return { valid: false, inviterDisplayName: null };
    }
    const inviter = await this.prisma.user.findUnique({
      where: { id: invite.createdBy },
      select: { displayName: true },
    });
    return { valid: true, inviterDisplayName: inviter?.displayName ?? null };
  }

  /** 供 invites 模块复用：生成明文码时同步给出前缀 */
  static describeCode(code: string): { codePrefix: string; normalized: string } {
    return { codePrefix: inviteCodePrefix(code), normalized: normalizeInviteCode(code) };
  }

  private isInviteUnusable(invite: {
    maxUses: number;
    uses: number;
    expiresAt: Date;
    revokedAt: Date | null;
  }): boolean {
    if (invite.revokedAt) return true;
    if (invite.uses >= invite.maxUses) return true;
    return invite.expiresAt.getTime() <= Date.now();
  }

  private async createSession(
    tx: Prisma.TransactionClient,
    userId: string,
    meta: RequestMeta,
    surface: SurfaceName,
    deviceName?: string,
    rotatedFrom?: string,
  ): Promise<Session & { refreshToken: string }> {
    const issued = this.tokens.issueRefresh();
    let deviceId: string | undefined;
    if (deviceName) {
      // 登录时按需登记设备（POST /me/devices 用于补登记推送令牌）
      const device = await tx.device.create({
        data: {
          userId,
          platform: 'web',
          name: deviceName,
          lastActiveAt: new Date(),
        },
        select: { id: true },
      });
      deviceId = device.id;
    }

    const session = await tx.session.create({
      data: {
        userId,
        surface,
        tokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
        userAgent: meta.userAgent ?? null,
        deviceId: deviceId ?? null,
        rotatedFrom: rotatedFrom ?? null,
      },
    });

    // sessions.ip 为 inet 类型（Prisma Unsupported），用原生 SQL 补写；非法 IP 静默跳过
    if (meta.ip && /^[0-9a-fA-F:.]{2,45}$/.test(meta.ip)) {
      try {
        await tx.$executeRawUnsafe(
          'UPDATE sessions SET ip = $1::inet WHERE id = $2::uuid',
          meta.ip,
          session.id,
        );
      } catch {
        // IP 写入失败不影响登录
      }
    }

    return { ...session, refreshToken: issued.refreshToken };
  }

  private async revokeAllSessions(userId: string, reason: string): Promise<number> {
    this.logger.log(`撤销用户 ${userId} 的全部会话：${reason}`);
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** 契约 §9：登录 10 次/小时/账号（IP 维度由 Throttler 负责 5 次/分钟） */
  private async enforceLoginRateLimit(handle: string): Promise<void> {
    const key = `ratelimit:login:account:${handle}`;
    const count = await this.redis.incrWithWindow(key, 3600);
    if (count > 10) {
      throw new AppError(ErrorCode.RATE_LIMITED, '登录尝试过于频繁，请 1 小时后再试', {
        retryAfterMs: 3_600_000,
      });
    }
  }

  private toPublicUser(
    user: Pick<
      User,
      | 'id'
      | 'handle'
      | 'displayName'
      | 'globalRole'
      | 'avatarFileId'
      | 'statusPrefix'
      | 'isInternal'
      | 'accountOrigin'
      | 'tags'
    >,
  ): AuthResult['user'] {
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      globalRole: user.globalRole,
      avatarFileId: user.avatarFileId,
      statusPrefix: user.statusPrefix,
      isInternal: user.isInternal,
      accountOrigin: user.accountOrigin,
      tags: user.tags,
      prefixes: IdentityService.systemPrefixes(user),
    };
  }

  /** 登录/注册事务提交后再补组织证章，避免事务内读不到刚创建的成员行 */
  private async attachIdentity(result: AuthResult): Promise<AuthResult> {
    result.user.prefixes = await this.identity.prefixesFor(result.user.id);
    return result;
  }

  /** 兼容旧字段：暴露配置给控制器返回 expiresIn 校验 */
  get accessTtlSec(): number {
    return this.config.jwt.accessTtlSec;
  }
}
