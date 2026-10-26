import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../files/s3.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import type { BindDeviceDto } from './device.dto';

export interface DeviceSummary {
  unread_count: number;
  has_announcement: boolean;
  latest_message: string;
  avatar_url: string;
  status_color: string;
}

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  /** 内网仪表盘：当前用户的推送设备列表。 */
  async listMine(user: AuthUser): Promise<{
    devices: Array<{ id: string; name: string; platform: string; lastActiveAt: string | null }>;
  }> {
    const rows = await this.prisma.device.findMany({
      where: { userId: user.id },
      orderBy: { lastActiveAt: { sort: 'desc', nulls: 'last' } },
      select: { id: true, name: true, platform: true, lastActiveAt: true },
    });
    return {
      devices: rows.map((row) => ({
        id: row.id,
        name: row.name,
        platform: row.platform,
        lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
      })),
    };
  }

  async createBindCode(user: AuthUser): Promise<{ code: string; expires_at: string }> {
    await this.prisma.deviceBindCode.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const exists = await this.prisma.deviceBindCode.findFirst({
        where: { code, usedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.deviceBindCode.create({
        data: { code, userId: user.id, expiresAt },
      });
      return { code, expires_at: expiresAt.toISOString() };
    }
    throw new AppError(ErrorCode.INTERNAL, '绑定码生成失败');
  }

  async bind(dto: BindDeviceDto): Promise<{ device_token: string; token_type: 'Bearer'; expires_in: null }> {
    const bindCode = await this.prisma.deviceBindCode.findFirst({
      where: { code: dto.code, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!bindCode) throw new AppError(ErrorCode.AUTH_INVALID, '绑定码无效或已过期');

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(rawToken);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.deviceBindCode.updateMany({
        where: { id: bindCode.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new AppError(ErrorCode.AUTH_INVALID, '绑定码已被使用');
      }
      await tx.deviceToken.upsert({
        where: { userId_mac: { userId: bindCode.userId, mac: dto.mac } },
        create: {
          userId: bindCode.userId,
          mac: dto.mac,
          tokenHash,
          name: dto.name ?? null,
        },
        update: {
          tokenHash,
          name: dto.name ?? null,
          revokedAt: null,
          lastSeenAt: null,
        },
      });
    });
    this.logger.log(`设备绑定成功 user=${bindCode.userId} mac=${dto.mac}`);
    return { device_token: rawToken, token_type: 'Bearer', expires_in: null };
  }

  async summary(rawToken: string | null): Promise<DeviceSummary> {
    if (!rawToken) throw new AppError(ErrorCode.AUTH_REQUIRED, '缺少 device_token');
    const device = await this.prisma.deviceToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarFileId: true,
            status: true,
          },
        },
      },
    });
    if (!device || device.revokedAt) throw new AppError(ErrorCode.AUTH_INVALID, 'device_token 无效');

    await this.prisma.deviceToken.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    const [unread, announcement, latestNotification, friends] = await Promise.all([
      this.prisma.notification.count({ where: { userId: device.userId, readAt: null } }),
      this.prisma.$queryRaw<Array<{ active: boolean }>>`
        SELECT active FROM system_announcements WHERE id = 'default' LIMIT 1
      `,
      this.prisma.notification.findFirst({
        where: { userId: device.userId },
        orderBy: { createdAt: 'desc' },
        select: { title: true, body: true },
      }),
      this.prisma.friendship.findMany({
        where: {
          status: 'accepted',
          OR: [{ requesterId: device.userId }, { addresseeId: device.userId }],
        },
        select: { requesterId: true, addresseeId: true },
      }),
    ]);

    const friendIds = friends.map((row) =>
      row.requesterId === device.userId ? row.addresseeId : row.requesterId,
    );
    const onlineFriends = friendIds.length
      ? await this.prisma.user.count({
          where: {
            id: { in: friendIds },
            lastSeenAt: { gte: new Date(Date.now() - 5 * 60_000) },
          },
        })
      : 0;
    const hasAnnouncement = Boolean(announcement[0]?.active);

    let avatarUrl = '';
    if (device.user.avatarFileId) {
      const file = await this.prisma.file.findUnique({
        where: { id: device.user.avatarFileId },
        select: { storageKey: true, status: true },
      });
      if (file?.status === 'ready') {
        avatarUrl = await this.s3.presignGet(file.storageKey);
      }
    }

    const statusColor = hasAnnouncement
      ? '#FF4B3E'
      : onlineFriends > 0
        ? '#00FFFF'
        : unread > 0
          ? '#FFFA00'
          : '#9AA093';

    return {
      unread_count: unread,
      has_announcement: hasAnnouncement,
      latest_message: latestNotification?.body || latestNotification?.title || '',
      avatar_url: avatarUrl,
      status_color: statusColor,
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
