import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BeltBondsService } from './belt-bonds.service';
import { inviteBondSchema, type InviteBondDto } from './belt.dto';
import { CurrentUser, Surface } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 环塔羁绊：邀请 / 接受 / 拒绝 / 续火花 / 解除（亲密度懒结算在服务层） */
@Controller('belt/bonds')
@Surface('belt')
export class BeltBondsController {
  constructor(private readonly bonds: BeltBondsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.bonds.list(user);
  }

  @Post('invite')
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async invite(@CurrentUser() user: AuthUser, @ZBody(inviteBondSchema) dto: InviteBondDto) {
    return this.bonds.invite(user, dto);
  }

  @Post(':id/accept')
  @HttpCode(200)
  async accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bonds.accept(user, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  async decline(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bonds.decline(user, id);
  }

  @Post(':id/renew')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async renew(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bonds.renew(user, id);
  }

  @Delete(':id')
  @HttpCode(200)
  async end(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bonds.end(user, id);
  }
}
