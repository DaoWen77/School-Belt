import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { BeltStickersService } from './belt-stickers.service';
import { CurrentUser, Surface } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import { createStickerSchema, type CreateStickerDto } from '../stickers/stickers.dto';
import type { AuthUser } from '../common/types/context';

/** 环塔表情包：本人的贴纸库（模块四补丁） */
@Controller('belt/stickers')
@Surface('belt')
export class BeltStickersController {
  constructor(private readonly stickers: BeltStickersService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.stickers.list(user);
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: AuthUser, @ZBody(createStickerSchema) dto: CreateStickerDto) {
    return this.stickers.create(user, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stickers.remove(user, id);
  }
}
