import { Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
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
import { CurrentUser, Public, RawResponse, Surface } from '../common/decorators';
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

  /**
   * 媒体内联代理（图片/视频，无需 Authorization）：
   * GET /api/v1/files/view?key=<storageKey>&exp=<ts>&sig=<hmac>
   * 仅接受服务端签发的短时签名，公网部署下替代 S3 直链。
   */
  @Get('view')
  @Public()
  @RawResponse()
  async view(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const safeKey = (key ?? '').trim();
    const expires = Number(exp);
    if (!safeKey || !this.files.verifyMedia(safeKey, expires, sig ?? '')) {
      reply.status(403).send({ ok: false, error: { code: 'MEDIA_TOKEN_INVALID', message: '媒体链接无效或已过期' } });
      return;
    }
    const { file, stream } = await this.files.openMediaByKey(safeKey);
    reply.header('content-type', file?.mime || stream.contentType || 'application/octet-stream');
    reply.header('cache-control', 'private, max-age=600');
    reply.header('x-content-type-options', 'nosniff');
    if (stream.contentLength) reply.header('content-length', String(stream.contentLength));
    await reply.send(stream.body);
  }

  /**
   * 下载代理：GET /api/v1/files/download/:id
   * 穿透环境下不依赖 S3 直链；强制 Content-Disposition: attachment，浏览器直接落盘。
   */
  @Get('download/:id')
  @Surface('bridge')
  @RawResponse()
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { file, stream } = await this.files.openDownload(user, id);
    const fallback = file.originalName.replace(/[^ -~]/g, '_').replace(/"/g, "'");
    reply.header('content-type', file.mime || 'application/octet-stream');
    reply.header(
      'content-disposition',
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    reply.header('cache-control', 'private, max-age=0, must-revalidate');
    if (stream.contentLength) reply.header('content-length', String(stream.contentLength));
    await reply.send(stream.body);
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
