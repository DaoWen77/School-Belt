import { Injectable, Logger } from '@nestjs/common';
import type { Invite } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { generateInviteCode, hashInviteCode, inviteCodePrefix, normalizeInviteCode } from '../common/utils/crypto';
import { assertCheck, canCreateInvite, toViewer } from '../common/utils/permissions';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import type { AuthUser } from '../common/types/context';
import type { GlobalRole } from '../common/types/enums';

export interface CreateInviteInput {
  role?: GlobalRole;
  maxUses?: number;
  expiresInDays?: number;
  note?: string;
}

export interface InviteView {
  id: string;
  codePrefix: string;
  role: GlobalRole;
  maxUses: number;
  uses: number;
  expiresAt: string;
  revokedAt: string | null;
  note: string | null;
  createdAt: string;
  status: 'active' | 'exhausted' | 'expired' | 'revoked';
}

/** 邀请码生命周期（契约 §5）：created → active → exhausted | expired | revoked */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, input: CreateInviteInput): Promise<{ invite: InviteView; code: string }> {
    assertCheck(canCreateInvite(toViewer(user)));
    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + (input.expiresInDays ?? 7) * 24 * 3600 * 1000);

    const invite = await this.prisma.invite.create({
      data: {
        codeHash: hashInviteCode(code),
        codePrefix: inviteCodePrefix(code),
        createdBy: user.id,
        role: input.role ?? 'member',
        maxUses: input.maxUses ?? 1,
        expiresAt,
        note: input.note ?? null,
      },
    });
    this.logger.log(`用户 ${user.handle} 签发邀请 ${invite.id}（前缀 ${invite.codePrefix}）`);
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.INVITE_CREATE,
      targetKind: 'invite',
      targetId: invite.id,
      meta: { role: invite.role, maxUses: invite.maxUses, expiresAt: expiresAt.toISOString() },
    });
    // 明文邀请码只在这里返回一次（契约 §5）
    return { invite: this.toView(invite), code };
  }

  async list(user: AuthUser): Promise<{ invites: InviteView[] }> {
    assertCheck(canCreateInvite(toViewer(user)));
    const invites = await this.prisma.invite.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { invites: invites.map((invite) => this.toView(invite)) };
  }

  async revoke(user: AuthUser, id: string): Promise<{ id: string; revokedAt: string }> {
    assertCheck(canCreateInvite(toViewer(user)));
    const updated = await this.prisma.invite.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '邀请不存在或已撤销', { inviteId: id });
    }
    this.logger.log(`用户 ${user.handle} 撤销邀请 ${id}`);
    const invite = await this.prisma.invite.findUniqueOrThrow({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.INVITE_REVOKE,
      targetKind: 'invite',
      targetId: id,
      meta: { codePrefix: invite.codePrefix },
    });
    return { id, revokedAt: (invite.revokedAt ?? new Date()).toISOString() };
  }

  /** 公开预览：只暴露是否有效与邀请人显示名（契约 §7） */
  async preview(rawCode: string): Promise<{ valid: boolean; inviterDisplayName: string | null }> {
    const code = normalizeInviteCode(rawCode);
    if (code.length === 0) return { valid: false, inviterDisplayName: null };

    const invite = await this.prisma.invite.findUnique({
      where: { codeHash: hashInviteCode(code) },
      select: {
        maxUses: true,
        uses: true,
        expiresAt: true,
        revokedAt: true,
        createdBy: true,
      },
    });
    if (!invite) return { valid: false, inviterDisplayName: null };
    if (invite.revokedAt || invite.uses >= invite.maxUses) {
      return { valid: false, inviterDisplayName: null };
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      return { valid: false, inviterDisplayName: null };
    }
    const inviter = await this.prisma.user.findUnique({
      where: { id: invite.createdBy },
      select: { displayName: true },
    });
    return { valid: true, inviterDisplayName: inviter?.displayName ?? null };
  }

  private toView(invite: Invite): InviteView {
    return {
      id: invite.id,
      codePrefix: invite.codePrefix,
      role: invite.role,
      maxUses: invite.maxUses,
      uses: invite.uses,
      expiresAt: invite.expiresAt.toISOString(),
      revokedAt: invite.revokedAt?.toISOString() ?? null,
      note: invite.note,
      createdAt: invite.createdAt.toISOString(),
      status: this.statusOf(invite),
    };
  }

  private statusOf(invite: Invite): InviteView['status'] {
    if (invite.revokedAt) return 'revoked';
    if (invite.uses >= invite.maxUses) return 'exhausted';
    if (invite.expiresAt.getTime() <= Date.now()) return 'expired';
    return 'active';
  }
}
