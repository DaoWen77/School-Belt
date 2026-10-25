import { Injectable } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { decodeKeyCursor, encodeKeyCursor } from '../common/utils/cursor';
import type { AuthUser } from '../common/types/context';
import type { NotificationType } from '../common/types/enums';
import type { ListNotificationsQuery, ReadNotificationsDto } from './notifications.dto';
import { PushService } from './push/push.service';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  channelId?: string | null;
  messageId?: bigint | null;
  cardId?: string | null;
  payload?: Record<string, unknown>;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  channelId: string | null;
  messageId: string | null;
  cardId: string | null;
  title: string;
  body: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

/** 落库结果：userId 仅用于广播定向，不进入响应体 */
export interface CreatedNotification {
  userId: string;
  view: NotificationView;
}

/** 通知（契约 §2.17 / §7 notifications）——落库 + WS 推送 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  /** 在业务事务内落库，返回可广播的结果；事务提交后由调用方 publish */
  async createInTx(
    tx: Prisma.TransactionClient,
    items: readonly CreateNotificationInput[],
  ): Promise<CreatedNotification[]> {
    if (items.length === 0) return [];
    const created = await Promise.all(
      items.map(async (item) => {
        const row = await tx.notification.create({
          data: {
            userId: item.userId,
            type: item.type,
            title: item.title.slice(0, 120),
            body: item.body ? item.body.slice(0, 300) : null,
            channelId: item.channelId ?? null,
            messageId: item.messageId ?? null,
            cardId: item.cardId ?? null,
            payload: (item.payload ?? {}) as Prisma.InputJsonValue,
          },
        });
        return { userId: item.userId, view: this.toView(row) };
      }),
    );
    return created;
  }

  /** 事务提交后调用：先 WS 推送，再 fire-and-forget 走推送通道（不阻塞消息 ack） */
  publish(created: readonly CreatedNotification[]): void {
    for (const item of created) {
      this.realtime.emitToUser(item.userId, 'notification:new', { notification: item.view });
    }
    this.push.schedule(
      created.map((item) => ({
        id: item.view.id,
        userId: item.userId,
        type: item.view.type,
        title: item.view.title,
        body: item.view.body,
        channelId: item.view.channelId,
        payload: (item.view.payload as Record<string, unknown> | null) ?? {},
      })),
    );
  }

  /** 事务外直接创建（如投票截止提醒） */
  async create(items: readonly CreateNotificationInput[]): Promise<NotificationView[]> {
    const created = await this.prisma.withTransaction((tx) => this.createInTx(tx, items));
    this.publish(created);
    return created.map((item) => item.view);
  }

  async list(user: AuthUser, query: ListNotificationsQuery): Promise<{
    notifications: NotificationView[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = query.limit;
    const cursor = query.cursor ? decodeKeyCursor(query.cursor, 2) : null;
    const cursorDate = cursor ? new Date(Number(cursor[0])) : null;
    const cursorId = cursor ? cursor[1] : null;

    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      ...(query.unread ? { readAt: null } : {}),
      ...(cursorDate && cursorId
        ? {
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: cursorId } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      notifications: page.map((row) => this.toView(row)),
      nextCursor: hasMore && last ? encodeKeyCursor([last.createdAt.getTime(), last.id]) : null,
      hasMore,
    };
  }

  async markRead(user: AuthUser, dto: ReadNotificationsDto): Promise<{ updated: number }> {
    if (!dto.all && (!dto.ids || dto.ids.length === 0)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'ids 与 all 至少提供一个');
    }
    const result = await this.prisma.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...(dto.all ? {} : { id: { in: dto.ids ?? [] } }),
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async unreadCount(user: AuthUser): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return { unread };
  }

  private toView(row: Notification): NotificationView {
    return {
      id: row.id,
      type: row.type,
      channelId: row.channelId,
      messageId: row.messageId?.toString() ?? null,
      cardId: row.cardId,
      title: row.title,
      body: row.body,
      payload: row.payload,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
