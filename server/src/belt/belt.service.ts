import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdentityService } from '../common/identity/identity.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import type { UpdateBeltProfileDto } from './belt.dto';

export interface BeltUserView {
  id: string;
  handle: string;
  displayName: string;
  globalRole: string;
  isInternal: boolean;
  accountOrigin: 'internal' | 'belt';
  avatarFileId: string | null;
  statusPrefix: string | null;
  balanceCents: number;
  prefixes: string[];
}

@Injectable()
export class BeltService implements OnModuleInit {
  private readonly logger = new Logger(BeltService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaultChannel();
    } catch (error) {
      this.logger.warn(`环塔默认频道初始化失败：${(error as Error).message}`);
    }
  }

  /**
   * 首次启动确保公开环塔频道存在。
   * 不写死 created_by：优先生成在任意 bot 用户名下，没有 bot 再退回最早用户。
   */
  async ensureDefaultChannel(): Promise<{ id: string; name: string } | null> {
    const existing = await this.prisma.channel.findFirst({
      where: { surface: 'belt', slug: 'belt-channel' },
      select: { id: true, name: true },
    });
    if (existing) return existing;

    const creator =
      (await this.prisma.user.findFirst({
        where: { isBot: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })) ??
      (await this.prisma.user.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }));
    if (!creator) {
      this.logger.warn('没有可用用户，跳过环塔默认频道创建');
      return null;
    }

    const channel = await this.prisma.channel.create({
      data: {
        name: '环塔频道',
        slug: 'belt-channel',
        topic: '环塔公共频段 · 外环中继 07',
        visibility: 'public',
        kind: 'channel',
        surface: 'belt',
        position: 0,
        createdBy: creator.id,
      },
      select: { id: true, name: true },
    });
    this.logger.log(`环塔默认频道已创建：#${channel.name} (${channel.id})`);
    return channel;
  }

  async defaultChannel(): Promise<{ id: string; name: string }> {
    const channel = await this.ensureDefaultChannel();
    if (!channel) throw new Error('环塔默认频道不存在');
    return channel;
  }

  async me(user: AuthUser): Promise<{ user: BeltUserView }> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        handle: true,
        displayName: true,
        globalRole: true,
        isInternal: true,
        accountOrigin: true,
        avatarFileId: true,
        statusPrefix: true,
        balanceCents: true,
      },
    });
    if (!row) throw new Error('用户不存在');
    return {
      user: {
        id: row.id,
        handle: row.handle,
        displayName: row.displayName,
        globalRole: row.globalRole,
        isInternal: row.isInternal,
        accountOrigin: row.accountOrigin,
        avatarFileId: row.avatarFileId,
        statusPrefix: row.statusPrefix,
        balanceCents: row.balanceCents,
        prefixes: await this.identity.prefixesFor(row.id),
      },
    };
  }

  /** 个人中心统计：发帖数 / 认同 / 回波 / 最近活跃。 */
  async stats(user: AuthUser): Promise<{
    posts: number;
    likesReceived: number;
    commentsReceived: number;
    recent: Array<{ id: string; title: string; board: string; publishedAt: string; likeCount: number; commentCount: number }>;
  }> {
    const [posts, likes, comments, recentRows] = await Promise.all([
      this.prisma.post.count({ where: { authorId: user.id, surface: 'belt', deletedAt: null } }),
      this.prisma.postLike.count({ where: { post: { authorId: user.id, surface: 'belt', deletedAt: null } } }),
      this.prisma.postComment.count({ where: { post: { authorId: user.id, surface: 'belt', deletedAt: null }, deletedAt: null } }),
      this.prisma.post.findMany({
        where: { authorId: user.id, surface: 'belt', deletedAt: null },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: 6,
        select: {
          id: true,
          title: true,
          board: true,
          publishedAt: true,
          _count: { select: { likes: true, comments: true } },
        },
      }),
    ]);
    return {
      posts,
      likesReceived: likes,
      commentsReceived: comments,
      recent: recentRows.map((row) => ({
        id: row.id,
        title: row.title ?? '未命名信号',
        board: row.board,
        publishedAt: row.publishedAt.toISOString(),
        likeCount: row._count.likes,
        commentCount: row._count.comments,
      })),
    };
  }

  /** Founder 特权：设置/覆盖单行公告（id=default） */
  async setAnnouncement(
    user: AuthUser,
    body: string,
    level?: 'info' | 'warning' | 'critical',
  ): Promise<{ announcement: { id: string; body: string; level: string } }> {
    const row = await this.prisma.systemAnnouncement.upsert({
      where: { id: 'default' },
      create: { id: 'default', body, level: level ?? 'info', active: true, updatedBy: user.id },
      update: { body, level: level ?? 'info', active: true, updatedBy: user.id },
      select: { body: true, level: true },
    });
    return { announcement: { id: 'default', body: row.body, level: row.level } };
  }

  /** Founder 特权：关闭公告（保留 body） */
  async clearAnnouncement(user: AuthUser): Promise<{ active: false }> {
    await this.prisma.systemAnnouncement.upsert({
      where: { id: 'default' },
      create: { id: 'default', body: '', active: false, updatedBy: user.id },
      update: { active: false, updatedBy: user.id },
    });
    return { active: false };
  }

  /** 外网顶部公告：直接读 system_announcements 当前 active 行。 */
  async announcement(): Promise<{ announcement: { id: string; body: string; level: string } | null }> {
    const rows = await this.prisma.$queryRaw<Array<{ body: string; level: string }>>`
      SELECT body, level FROM system_announcements
      WHERE id = 'default' AND active = true
      LIMIT 1
    `;
    const row = rows[0];
    return {
      announcement: row
        ? { id: 'default', body: row.body, level: row.level }
        : null,
    };
  }

  async updateMe(user: AuthUser, dto: UpdateBeltProfileDto): Promise<{ user: BeltUserView }> {
    if (dto.avatarFileId) {
      const file = await this.prisma.file.findUnique({
        where: { id: dto.avatarFileId },
        select: { ownerId: true, status: true, kind: true },
      });
      if (!file || file.ownerId !== user.id || file.status !== 'ready' || file.kind !== 'image') {
        throw new AppError(ErrorCode.FILE_NOT_READY, '头像必须是本人已就绪的图片');
      }
    }
    const row = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.statusPrefix !== undefined ? { statusPrefix: dto.statusPrefix || null } : {}),
        ...(dto.avatarFileId !== undefined ? { avatarFileId: dto.avatarFileId } : {}),
      },
      select: {
        id: true,
        handle: true,
        displayName: true,
        globalRole: true,
        isInternal: true,
        accountOrigin: true,
        avatarFileId: true,
        statusPrefix: true,
        balanceCents: true,
      },
    });
    return {
      user: {
        id: row.id,
        handle: row.handle,
        displayName: row.displayName,
        globalRole: row.globalRole,
        isInternal: row.isInternal,
        accountOrigin: row.accountOrigin,
        avatarFileId: row.avatarFileId,
        statusPrefix: row.statusPrefix,
        balanceCents: row.balanceCents,
        prefixes: await this.identity.prefixesFor(row.id),
      },
    };
  }
}
