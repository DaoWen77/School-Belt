import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import {
  addConversationMembersSchema,
  createDmSchema,
  createGroupSchema,
  renameConversationSchema,
  transferConversationSchema,
  updateAnnouncementSchema,
  type AddConversationMembersDto,
  type CreateDmDto,
  type CreateGroupDto,
  type RenameConversationDto,
  type TransferConversationDto,
  type UpdateAnnouncementDto,
} from './conversations.dto';
import { CurrentUser } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/**
 * 会话（私聊 / 群聊）—— 契约 v1.2 §B。
 *
 * 注意路由顺序：`GET /conversations/users` 必须声明在 `GET /conversations/:id` 之前，
 * 否则 "users" 会被当成 :id 匹配。
 * 消息 / 已读 / 线程 / 成员仍走既有 `/channels/:id/*`，前端把会话 id 当 channelId 用。
 */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  /** 当前用户的 DM + 群聊列表（lastMessageAt desc nulls last） */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.conversations.list(user);
  }

  /** 可发起会话的用户（排除自己，按 displayName 排序） */
  @Get('users')
  async users(@CurrentUser() user: AuthUser) {
    return this.conversations.listUsers(user);
  }

  /** 会话详情 + 成员（仅成员可读，owner/admin 不越权） */
  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.get(user, id);
  }

  /** 发起私聊（幂等） */
  @Post('dm')
  @HttpCode(200)
  async createDm(@CurrentUser() user: AuthUser, @ZBody(createDmSchema) dto: CreateDmDto) {
    return { conversation: await this.conversations.createDm(user, dto) };
  }

  /** 创建群聊（创建者 moderator） */
  @Post('group')
  @HttpCode(201)
  async createGroup(@CurrentUser() user: AuthUser, @ZBody(createGroupSchema) dto: CreateGroupDto) {
    return { conversation: await this.conversations.createGroup(user, dto) };
  }

  /** 群聊改名（仅 creator/moderator） */
  @Patch(':id')
  async rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(renameConversationSchema) dto: RenameConversationDto,
  ) {
    return { conversation: await this.conversations.rename(user, id, dto) };
  }

  /** 群公告（Sprint1）：仅群聊 moderator；≤4000 字符，空串清除 */
  @Patch(':id/announcement')
  async updateAnnouncement(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(updateAnnouncementSchema) dto: UpdateAnnouncementDto,
  ) {
    return { conversation: await this.conversations.updateAnnouncement(user, id, dto) };
  }

  /** 群聊加人（仅 creator/moderator） */
  @Post(':id/members')
  @HttpCode(201)
  async addMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(addConversationMembersSchema) dto: AddConversationMembersDto,
  ) {
    return { conversation: await this.conversations.addMembers(user, id, dto) };
  }

  @Post(':id/block')
  @HttpCode(200)
  async block(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.blockConversation(user, id);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  async transferOwner(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(transferConversationSchema) dto: TransferConversationDto,
  ) {
    return { conversation: await this.conversations.transferOwner(user, id, dto) };
  }

  /** 本人退出 / moderator 移除成员 */
  @Delete(':id/members/:userId')
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.conversations.removeMember(user, id, userId);
  }

  /** 群主解散群聊（Sprint1）：仅 kind=group 且 channel.createdBy === 调用者；软归档、保留消息与成员 */
  @Delete(':id')
  @HttpCode(200)
  async dissolve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.dissolve(user, id);
  }
}
