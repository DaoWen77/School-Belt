import { Controller, Get, HttpCode, Put } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { updateAnnouncementSchema, type UpdateAnnouncementDto } from './announcements.dto';
import { CurrentUser, Roles } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 全服公告（Phase3）：读需登录；写仅 owner/admin */
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get('current')
  async current() {
    return this.announcements.getCurrent();
  }

  @Put()
  @Roles('owner', 'admin')
  @HttpCode(200)
  async update(@CurrentUser() user: AuthUser, @ZBody(updateAnnouncementSchema) dto: UpdateAnnouncementDto) {
    return this.announcements.update(user, dto);
  }
}
