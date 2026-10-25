import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { InvitesService } from './invites.service';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

const createInviteSchema = z.object({
  role: z.enum(['member', 'admin']).optional(),
  maxUses: z.coerce.number().int().min(1).max(100).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(30).optional(),
  note: z.string().trim().max(80).optional(),
});
type CreateInviteDto = z.infer<typeof createInviteSchema>;

/**
 * 邀请码管理（契约 §5 / §7 invites）：
 * - 明文只在创建响应里出现一次；
 * - 撤销立即生效，已注册用户不受影响；
 * - 预览端点公开，限流 5 次/10 分钟/IP。
 */
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  @Roles('owner', 'admin')
  @HttpCode(201)
  async create(@CurrentUser() user: AuthUser, @ZBody(createInviteSchema) dto: CreateInviteDto) {
    return this.invites.create(user, dto);
  }

  @Get()
  @Roles('owner', 'admin')
  async list(@CurrentUser() user: AuthUser) {
    return this.invites.list(user);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invites.revoke(user, id);
  }

  @Public()
  @Get(':code/preview')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async preview(@Param('code') code: string) {
    return this.invites.preview(code);
  }
}
