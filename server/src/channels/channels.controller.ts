import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ChannelsService } from './channels.service';
import {
  addMemberSchema,
  createChannelSchema,
  readSchema,
  updateChannelSchema,
  updateMemberSchema,
  type AddMemberDto,
  type CreateChannelDto,
  type ReadDto,
  type UpdateChannelDto,
  type UpdateMemberDto,
} from './channels.dto';
import { CurrentUser, Roles } from '../common/decorators';
import { ChannelGuard } from '../common/guards/channel.guard';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 频道（契约 §7 channels） */
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.channels.list(user);
  }

  @Post()
  @Roles('owner', 'admin')
  @HttpCode(201)
  async create(@CurrentUser() user: AuthUser, @ZBody(createChannelSchema) dto: CreateChannelDto) {
    return this.channels.create(user, dto);
  }

  @Get(':id')
  @UseGuards(ChannelGuard())
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.get(user, id);
  }

  @Patch(':id')
  @UseGuards(ChannelGuard())
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(updateChannelSchema) dto: UpdateChannelDto,
  ) {
    return this.channels.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  async archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.archive(user, id);
  }

  @Get(':id/members')
  @UseGuards(ChannelGuard())
  async members(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.listMembers(user, id);
  }

  @Post(':id/members')
  @UseGuards(ChannelGuard({ access: 'manage' }))
  @HttpCode(201)
  async addMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(addMemberSchema) dto: AddMemberDto,
  ) {
    return this.channels.addMember(user, id, dto);
  }

  @Patch(':id/members/:userId')
  @UseGuards(ChannelGuard({ access: 'manage' }))
  async updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @ZBody(updateMemberSchema) dto: UpdateMemberDto,
  ) {
    return this.channels.updateMember(user, id, userId, dto);
  }

  @Delete(':id/members/:userId')
  @UseGuards(ChannelGuard({ access: 'manage' }))
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.channels.removeMember(user, id, userId);
  }

  /** 已读上报：进入服务端 300ms 合并窗口（契约 §9） */
  @Post(':id/read')
  @HttpCode(200)
  @UseGuards(ChannelGuard())
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(readSchema) dto: ReadDto,
  ) {
    return this.channels.markRead(user, id, dto.seq);
  }
}
