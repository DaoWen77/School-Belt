import { Injectable, Logger } from '@nestjs/common';
import { isIP } from 'node:net';
import { PrismaService } from '../prisma/prisma.service';

export const AuditAction = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILED: 'auth.login.failed',
  REGISTER: 'auth.register',
  INVITE_CREATE: 'invite.create',
  INVITE_REVOKE: 'invite.revoke',
  CHANNEL_CREATE: 'channel.create',
  CHANNEL_ARCHIVE: 'channel.archive',
  CHANNEL_MEMBER_ADD: 'channel.member.add',
  CHANNEL_MEMBER_UPDATE: 'channel.member.update',
  CHANNEL_MEMBER_REMOVE: 'channel.member.remove',
  MESSAGE_DELETE: 'message.delete',
  CARD_DELETE: 'card.delete',
  USER_SUSPEND: 'user.suspend',
  USER_ACTIVATE: 'user.activate',
  ANNOUNCEMENT_UPDATE: 'announcement.update',
  // 文明环带 Phase A：面隔离与交接
  HANDOFF_ISSUE: 'handoff.issue',
  HANDOFF_EXCHANGE: 'handoff.exchange',
  BELT_ACCESS_DENIED: 'belt.access.denied',
  // Phase B：组织与证章
  ORG_APPLY: 'organization.apply',
  ORG_REVIEW: 'organization.review',
  ORG_JOIN_REQUEST: 'organization.join.request',
  ORG_JOIN_REVIEW: 'organization.join.review',
  ORG_MEMBER_INVITE: 'organization.member.invite',
  ORG_LEAVE: 'organization.leave',
  ORG_TRANSFER: 'organization.transfer',
  ORG_DISSOLVE: 'organization.dissolve',
  ORG_CHANNEL_CREATE: 'organization.channel.create',
  ORG_CHANNEL_ARCHIVE: 'organization.channel.archive',
  // Phase D：好友与 DM
  FRIEND_REQUEST: 'friendship.request',
  FRIEND_ACCEPT: 'friendship.accept',
  FRIEND_REJECT: 'friendship.reject',
  FRIEND_BLOCK: 'friendship.block',
  FRIEND_REMOVE: 'friendship.remove',
  DM_CREATE: 'friendship.dm.create',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditInput {
  actorId?: string | null;
  action: AuditAction;
  targetKind?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * 审计日志（契约 §2.18 audit_logs）。
 * 写入失败只 warn，不影响业务主流程；ip 为 inet 列（Prisma Unsupported），走原生 SQL。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    const ip = input.ip && isIP(input.ip) !== 0 ? input.ip : null;
    try {
      await this.prisma.$executeRaw`
        INSERT INTO audit_logs (actor_id, action, target_kind, target_id, meta, ip)
        VALUES (
          ${input.actorId ?? null}::uuid,
          ${input.action},
          ${input.targetKind ?? null},
          ${input.targetId ?? null},
          ${JSON.stringify(input.meta ?? {})}::jsonb,
          ${ip}::inet
        )
      `;
    } catch (error) {
      this.logger.warn(`审计写入失败（${input.action}）：${(error as Error).message}`);
    }
  }
}
