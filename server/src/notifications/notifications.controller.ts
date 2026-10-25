import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import {
  listNotificationsQuerySchema,
  readNotificationsSchema,
  type ListNotificationsQuery,
  type ReadNotificationsDto,
} from './notifications.dto';
import { CurrentUser } from '../common/decorators';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 通知中心（契约 §7 notifications） */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @ZQuery(listNotificationsQuerySchema) query: ListNotificationsQuery,
  ) {
    return this.notifications.list(user, query);
  }

  @Post('read')
  @HttpCode(200)
  async markRead(@CurrentUser() user: AuthUser, @ZBody(readNotificationsSchema) dto: ReadNotificationsDto) {
    return this.notifications.markRead(user, dto);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user);
  }
}
