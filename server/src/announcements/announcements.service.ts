import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import type { AuthUser } from '../common/types/context';
import type { UpdateAnnouncementDto } from './announcements.dto';

export interface AnnouncementView {
  id: string;
  body: string;
  level: string;
  updatedAt: string;
}

export interface AnnouncementCurrentView {
  announcement: AnnouncementView | null;
}

interface AnnouncementRow {
  body: string;
  level: string;
  updated_at: Date;
}

/**
 * 全服公告（Phase3）：`system_announcements` 单行表。
 * - GET 只返回 active=true 的一行；无公告/已关闭时 announcement=null；
 * - PUT 空 body = 关闭（保留原 body、active=false，不物理删）；
 * - owner/admin 可写；每次写入 audit_logs（announcement.update）。
 *
 * 说明：为在“API 不重启”的前提下交付，这里用参数化原生 SQL 访问新表
 * （Prisma Client 的 model 代码需下一次 `prisma generate` 才生成）。
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertAdmin(user: AuthUser): void {
    if (user.globalRole !== 'owner' && user.globalRole !== 'admin') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅协议官或档案员可修改全服公告');
    }
  }

  async getCurrent(): Promise<AnnouncementCurrentView> {
    const rows = await this.prisma.$queryRaw<AnnouncementRow[]>`
      SELECT body, level, updated_at
      FROM system_announcements
      WHERE id = 'default' AND active = true
      LIMIT 1
    `;
    const row = rows[0];
    return {
      announcement: row
        ? { id: 'default', body: row.body, level: row.level, updatedAt: row.updated_at.toISOString() }
        : null,
    };
  }

  async update(user: AuthUser, dto: UpdateAnnouncementDto): Promise<AnnouncementCurrentView> {
    this.assertAdmin(user);
    const body = dto.body.trim();
    const level = dto.level;
    const closing = body.length === 0;

    await this.prisma.$transaction(async (tx) => {
      if (closing) {
        // 关闭：保留 body，仅置 active=false（body 的 1..2000 CHECK 不受影响）
        await tx.$executeRaw`
          UPDATE system_announcements
          SET active = false, updated_by = ${user.id}::uuid, updated_at = now()
          WHERE id = 'default'
        `;
        return;
      }
      await tx.$executeRaw`
        INSERT INTO system_announcements (id, body, level, active, updated_by, updated_at)
        VALUES ('default', ${body}, ${level}, true, ${user.id}::uuid, now())
        ON CONFLICT (id) DO UPDATE SET
          body = EXCLUDED.body,
          level = EXCLUDED.level,
          active = true,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `;
    });

    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ANNOUNCEMENT_UPDATE,
      targetKind: 'announcement',
      targetId: 'default',
      meta: { active: !closing, level, bodyLength: body.length },
    });
    return this.getCurrent();
  }
}
