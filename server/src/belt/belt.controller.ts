import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { BeltService } from './belt.service';
import { BeltChannelsService } from './belt-channels.service';
import { BeltPostsService } from './belt-posts.service';
import { BeltWalletService } from './belt-wallet.service';
import {
  beltMessageQuerySchema,
  createBeltCommentSchema,
  createBeltPostSchema,
  dingMessageSchema,
  listBeltPostsQuerySchema,
  createBeltChannelSchema,
  pinMessageSchema,
  sendBeltMessageSchema,
  setBeltAnnouncementSchema,
  shareBeltPostSchema,
  tipBeltPostSchema,
  updateBeltProfileSchema,
  type BeltMessageQuery,
  type CreateBeltChannelDto,
  type CreateBeltCommentDto,
  type CreateBeltPostDto,
  type DingMessageDto,
  type ListBeltPostsQuery,
  type PinMessageDto,
  type SendBeltMessageDto,
  type SetBeltAnnouncementDto,
  type ShareBeltPostDto,
  type TipBeltPostDto,
  type UpdateBeltProfileDto,
} from './belt.dto';
import { BeltImService } from './belt-im.service';
import {
  avatarPresignSchema,
  beltAttachmentPresignSchema,
  beltAttachmentUploadSchema,
  beltPostMediaPresignSchema,
  completeSchema,
  fileUrlQuerySchema,
  type AvatarPresignDto,
  type BeltAttachmentPresignDto,
  type BeltAttachmentUploadDto,
  type BeltPostMediaPresignDto,
  type CompleteDto,
  type FileUrlQuery,
} from '../files/files.dto';
import { FilesService } from '../files/files.service';
import { CurrentUser, OptionalAuth, OptionalUser, RawResponse, Roles, Surface } from '../common/decorators';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

@Controller('belt')
export class BeltMeController {
  constructor(
    private readonly belt: BeltService,
    private readonly wallet: BeltWalletService,
    private readonly im: BeltImService,
  ) {}

  @Get('me')
  @Surface('belt')
  async me(@CurrentUser() user: AuthUser) {
    return this.belt.me(user);
  }

  @Get('me/wallet')
  @Surface('belt')
  async myWallet(@CurrentUser() user: AuthUser) {
    return this.wallet.wallet(user);
  }

  /** 今日 DING 剩余次数（上海自然日，每人 3 次） */
  @Get('me/ding-quota')
  @Surface('belt')
  async dingQuota(@CurrentUser() user: AuthUser) {
    return this.im.dingQuota(user);
  }

  @Get('announcement')
  @Surface('belt')
  async announcement() {
    return this.belt.announcement();
  }

  @Post('announcement')
  @Surface('belt')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async setAnnouncement(
    @CurrentUser() user: AuthUser,
    @ZBody(setBeltAnnouncementSchema) dto: SetBeltAnnouncementDto,
  ) {
    return this.belt.setAnnouncement(user, dto.body, dto.level);
  }

  @Delete('announcement')
  @Surface('belt')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async clearAnnouncement(@CurrentUser() user: AuthUser) {
    return this.belt.clearAnnouncement(user);
  }

  @Get('stats')
  @Surface('belt')
  async stats(@CurrentUser() user: AuthUser) {
    return this.belt.stats(user);
  }

  @Patch('me')
  @Surface('belt')
  async updateMe(
    @CurrentUser() user: AuthUser,
    @ZBody(updateBeltProfileSchema) dto: UpdateBeltProfileDto,
  ) {
    return this.belt.updateMe(user, dto);
  }
}

/** 环带头像：S3 直传，文件 channelId=null，不依赖内部频道。 */
@Controller('belt/files')
@Surface('belt')
export class BeltFilesController {

  /**
   * 任意文件下载代理（环带会话）：GET /belt/files/download/:id
   * 穿透环境下绕过 S3 直链；强制 attachment 让浏览器落盘。
   */
  @Get('download/:id')
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
  constructor(private readonly files: FilesService) {}

  @Post('post-media/presign')
  @HttpCode(200)
  async presignPostMedia(
    @CurrentUser() user: AuthUser,
    @ZBody(beltPostMediaPresignSchema) dto: BeltPostMediaPresignDto,
  ) {
    return this.files.presignBeltPostMedia(user, dto);
  }

  @Post('attachments/presign')
  @HttpCode(200)
  async presignAttachment(
    @CurrentUser() user: AuthUser,
    @ZBody(beltAttachmentPresignSchema) dto: BeltAttachmentPresignDto,
  ) {
    return this.files.presignBeltAttachment(user, dto);
  }

  @Post('avatar/presign')
  @HttpCode(200)
  async presignAvatar(
    @CurrentUser() user: AuthUser,
    @ZBody(avatarPresignSchema) dto: AvatarPresignDto,
  ) {
    return this.files.presignAvatar(user, dto);
  }

  @Post(':id/upload')
  @HttpCode(200)
  async uploadFallback(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(beltAttachmentUploadSchema) dto: BeltAttachmentUploadDto,
  ) {
    return this.files.uploadBeltAttachmentData(user, id, dto.data);
  }

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
    void query;
    return this.files.beltUrl(user, id);
  }
}

@Controller('belt/channels')
@Surface('belt')
export class BeltChannelsController {
  constructor(private readonly channels: BeltChannelsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.channels.list(user);
  }

  @Post()
  @HttpCode(201)
  async createChannel(
    @CurrentUser() user: AuthUser,
    @ZBody(createBeltChannelSchema) dto: CreateBeltChannelDto,
  ) {
    return { channel: await this.channels.createChannel(user, dto.name, dto.topic ?? null) };
  }

  @Delete(':id/messages/:messageId')
  @HttpCode(200)
  async deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.channels.deleteMessage(user, id, messageId);
  }

  @Get('search')
  async search(@CurrentUser() user: AuthUser, @Query('q') q: string) {
    return this.channels.search(user, q ?? '');
  }

  @Get(':id/members')
  async members(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.members(user, id);
  }

  @Get(':id/messages')
  async messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZQuery(beltMessageQuerySchema) query: BeltMessageQuery,
  ) {
    return this.channels.messages(user, id, query.limit);
  }

  @Post(':id/messages')
  @HttpCode(201)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(sendBeltMessageSchema) dto: SendBeltMessageDto,
  ) {
    return { message: await this.channels.send(user, id, dto.body, dto.clientMsgId, dto.attachmentIds) };
  }

  /** DING：每日 3 次，落 ding 消息并复用频道广播 */
  @Post(':id/ding')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async ding(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(dingMessageSchema) dto: DingMessageDto,
  ) {
    return this.channels.ding(user, id, dto.body);
  }

  @Post(':id/pins')
  @HttpCode(201)
  async pin(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(pinMessageSchema) dto: PinMessageDto,
  ) {
    return this.channels.pinMessage(user, id, dto.messageId);
  }

  @Delete(':id/pins/:messageId')
  @HttpCode(200)
  async unpin(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.channels.unpinMessage(user, id, messageId);
  }

  @Get(':id/pins')
  async pins(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.pinnedMessages(user, id);
  }
}

@Controller('belt/posts')
export class BeltPostsController {
  constructor(
    private readonly posts: BeltPostsService,
    private readonly wallet: BeltWalletService,
  ) {}

  @Get()
  @OptionalAuth()
  @Surface('belt')
  async list(
    @OptionalUser() user: AuthUser | null,
    @ZQuery(listBeltPostsQuerySchema) query: ListBeltPostsQuery,
  ) {
    return this.posts.list(user, query);
  }

  @Get(':id')
  @OptionalAuth()
  @Surface('belt')
  async get(@OptionalUser() user: AuthUser | null, @Param('id') id: string) {
    return { post: await this.posts.get(user, id) };
  }

  @Get(':id/comments')
  @OptionalAuth()
  @Surface('belt')
  async comments(@Param('id') id: string) {
    return this.posts.comments(id);
  }

  @Post()
  @Surface('belt')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(@CurrentUser() user: AuthUser, @ZBody(createBeltPostSchema) dto: CreateBeltPostDto) {
    return { post: await this.posts.create(user, dto) };
  }

  @Post(':id/like')
  @Surface('belt')
  @HttpCode(200)
  async like(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.like(user, id);
  }

  @Delete(':id/like')
  @Surface('belt')
  @HttpCode(200)
  async unlike(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.unlike(user, id);
  }

  @Post(':id/comments')
  @Surface('belt')
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async addComment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(createBeltCommentSchema) dto: CreateBeltCommentDto,
  ) {
    return { comment: await this.posts.addComment(user, id, dto.body) };
  }

  @Post(':id/share')
  @Surface('belt')
  @HttpCode(201)
  async share(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(shareBeltPostSchema) dto: ShareBeltPostDto,
  ) {
    return this.posts.share(user, id, dto.channelId);
  }

  @Post(':id/tip')
  @Surface('belt')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async tip(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(tipBeltPostSchema) dto: TipBeltPostDto,
  ) {
    return this.wallet.tip(user, id, dto.amountCents, dto.idempotencyKey);
  }

  @Post(':id/bookmark')
  @Surface('belt')
  @HttpCode(200)
  async bookmark(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.bookmark(user, id, true);
  }

  @Delete(':id/bookmark')
  @Surface('belt')
  @HttpCode(200)
  async unbookmark(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.bookmark(user, id, false);
  }

  @Post(':id/pin')
  @Surface('belt')
  @HttpCode(200)
  async pin(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.pin(user, id, true);
  }

  @Delete(':id/pin')
  @Surface('belt')
  @HttpCode(200)
  async unpin(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.pin(user, id, false);
  }

  @Post(':id/promote')
  @Surface('belt')
  @HttpCode(200)
  async promote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.promote(user, id);
  }

  @Delete(':id')
  @Surface('belt')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.remove(user, id);
  }
}

/** 环带消息：单用户隐藏（幂等，只影响自己的列表） */
@Controller('belt/messages')
@Surface('belt')
export class BeltMessagesController {
  constructor(private readonly im: BeltImService) {}

  @Post(':id/hide')
  @HttpCode(200)
  async hide(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.im.hideMessage(user, id);
  }
}

/** 环带黑名单：拉黑后拒绝私聊建链；频道消息不过滤（公开频道以成员为访问权） */
@Controller('belt/users')
@Surface('belt')
export class BeltUsersController {
  constructor(private readonly im: BeltImService) {}

  @Post(':handle/block')
  @HttpCode(200)
  async block(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.im.setBlocked(user, handle, true);
  }

  @Delete(':handle/block')
  @HttpCode(200)
  async unblock(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.im.setBlocked(user, handle, false);
  }
}
