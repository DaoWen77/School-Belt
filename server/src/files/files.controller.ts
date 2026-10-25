import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FilesService } from './files.service';
import {
  channelFilesQuerySchema,
  completeSchema,
  fileUrlQuerySchema,
  presignSchema,
  type ChannelFilesQuery,
  type CompleteDto,
  type FileUrlQuery,
  type PresignDto,
} from './files.dto';
import { CurrentUser } from '../common/decorators';
import { ChannelGuard } from '../common/guards/channel.guard';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 文件直传（契约 §7 files / §10） */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('presign')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // 契约 §9：上传签名 20 次/分钟/用户
  @UseGuards(ChannelGuard({ source: 'body:channelId', access: 'write' }))
  async presign(@CurrentUser() user: AuthUser, @ZBody(presignSchema) dto: PresignDto) {
    return this.files.presign(user, dto);
  }

  /** 确认直传完成：HEAD 校验大小 + 魔数嗅探（契约 §10.3） */
  @Post(':id/complete')
  @HttpCode(200)
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(completeSchema) dto: CompleteDto,
  ) {
    return this.files.complete(user, id, dto);
  }

  @Get(':id/url')
  async url(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZQuery(fileUrlQuerySchema) query: FileUrlQuery,
  ) {
    return this.files.url(user, id, query);
  }
}

/** 素材库原始列表（契约 §7 files：GET /channels/:id/files） */
@Controller('channels')
export class ChannelFilesController {
  constructor(private readonly files: FilesService) {}

  @Get(':id/files')
  @UseGuards(ChannelGuard())
  async list(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @ZQuery(channelFilesQuerySchema) query: ChannelFilesQuery,
  ) {
    return this.files.listByChannel(user, channelId, query);
  }
}
