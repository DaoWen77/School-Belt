import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import { BeltDirectService } from './belt-direct.service';
import {
  beltMessageQuerySchema,
  sendBeltMessageSchema,
  type BeltMessageQuery,
  type SendBeltMessageDto,
} from './belt.dto';
import { CurrentUser, Surface } from '../common/decorators';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

const sharePostSchema = z.object({ postId: z.string().uuid() });

/** 环带私聊：关注即可发起（好友体系已废弃） */
@Controller('belt/directs')
@Surface('belt')
export class BeltDirectController {
  constructor(private readonly direct: BeltDirectService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.direct.list(user);
  }

  @Post(':handle')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.direct.create(user, handle);
  }

  @Get(':id/messages')
  async messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZQuery(beltMessageQuerySchema) _query: BeltMessageQuery,
  ) {
    return this.direct.messages(user, id);
  }

  @Post(':id/messages')
  @HttpCode(201)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(sendBeltMessageSchema) dto: SendBeltMessageDto,
  ) {
    return { message: await this.direct.send(user, id, dto.body, dto.clientMsgId) };
  }

  @Delete(':id/messages')
  @HttpCode(200)
  async clear(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.direct.clear(user, id);
  }

  @Post(':id/clear')
  @HttpCode(200)
  async clearLegacy(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.direct.clear(user, id);
  }

  @Delete(':id/messages/:messageId')
  @HttpCode(200)
  async deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.direct.deleteMessage(user, id, messageId);
  }

  @Post(':id/share')
  @HttpCode(201)
  async share(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(sharePostSchema) body: { postId: string },
  ) {
    return { message: await this.direct.share(user, id, body.postId) };
  }
}
