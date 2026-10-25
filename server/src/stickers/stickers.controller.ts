import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { StickersService } from './stickers.service';
import { createStickerSchema, type CreateStickerDto } from './stickers.dto';
import { CurrentUser } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 个人贴纸库（Sprint2）：都是“当前用户”语义，无需频道权限 */
@Controller('stickers')
export class StickersController {
  constructor(private readonly stickers: StickersService) {}

  /** 收藏贴纸：文件需 ready + image + 本人；重复收藏幂等返回已有行 */
  @Post()
  @HttpCode(200)
  async create(@CurrentUser() user: AuthUser, @ZBody(createStickerSchema) dto: CreateStickerDto) {
    return { sticker: await this.stickers.create(user, dto) };
  }

  /** 我的贴纸（createdAt desc） */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.stickers.list(user);
  }

  /** 删除贴纸：仅 owner */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stickers.remove(user, id);
  }
}
