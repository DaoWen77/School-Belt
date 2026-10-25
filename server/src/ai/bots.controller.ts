import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { BotsService } from './bots.service';
import {
  createBotSchema,
  updateBotSchema,
  type CreateBotDto,
  type UpdateBotDto,
} from './bots.dto';
import { CurrentUser, Roles } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/**
 * 多 Bot 管理（Sprint5）：**仅 owner**（admin 也 403）。
 * RolesGuard 做入口拦截，BotsService.assertOwner 做服务层兜底。
 */
@Controller('bots')
@Roles('owner')
export class BotsController {
  constructor(private readonly bots: BotsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.bots.list(user);
  }

  /** 事务创建 users(is_bot=true) + bot_profiles；apiKey AES-256-GCM 加密 */
  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: AuthUser, @ZBody(createBotSchema) dto: CreateBotDto) {
    return { bot: await this.bots.create(user, dto) };
  }

  /** 事务更新；apiKey 省略/空串 = 保留旧值 */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(updateBotSchema) dto: UpdateBotDto,
  ) {
    return { bot: await this.bots.update(user, id, dto) };
  }

  /** 软删 profile + 禁用 user；历史消息保留 */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bots.remove(user, id);
  }

  /** 连通性测试：Bot 的 model/key 优先，空回退全局；8s 超时，不泄露 key */
  @Post(':id/test')
  @HttpCode(200)
  async test(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bots.test(user, id);
  }
}

/** 频道内 Bot 成员（成员可读）：供前端 @ 列表与 Bot 选择器 */
@Controller('channels')
export class ChannelBotsController {
  constructor(private readonly bots: BotsService) {}

  @Get(':id/bots')
  async list(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.bots.listChannelBots(user, channelId);
  }
}
