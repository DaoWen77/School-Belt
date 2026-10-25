import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BeltService } from './belt.service';
import { BeltChannelsService } from './belt-channels.service';
import { BeltPostsService } from './belt-posts.service';
import {
  beltMessageQuerySchema,
  createBeltCommentSchema,
  createBeltPostSchema,
  listBeltPostsQuerySchema,
  createBeltChannelSchema,
  sendBeltMessageSchema,
  shareBeltPostSchema,
  updateBeltProfileSchema,
  type BeltMessageQuery,
  type CreateBeltChannelDto,
  type CreateBeltCommentDto,
  type CreateBeltPostDto,
  type ListBeltPostsQuery,
  type SendBeltMessageDto,
  type ShareBeltPostDto,
  type UpdateBeltProfileDto,
} from './belt.dto';
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
import { CurrentUser, OptionalAuth, OptionalUser, Surface } from '../common/decorators';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

@Controller('belt')
export class BeltMeController {
  constructor(private readonly belt: BeltService) {}

  @Get('me')
  @Surface('belt')
  async me(@CurrentUser() user: AuthUser) {
    return this.belt.me(user);
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
}

@Controller('belt/posts')
export class BeltPostsController {
  constructor(private readonly posts: BeltPostsService) {}

  @Get()
  @OptionalAuth()
  @Surface('belt')
  async list(
    @OptionalUser() user: AuthUser | null,
    @ZQuery(listBeltPostsQuerySchema) query: ListBeltPostsQuery,
  ) {
    return this.posts.list(user, query.board, query.limit, query.cursor);
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

  @Delete(':id')
  @Surface('belt')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.remove(user, id);
  }
}
