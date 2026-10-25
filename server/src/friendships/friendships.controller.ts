import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { FriendshipsService } from './friendships.service';
import {
  createFriendRequestSchema,
  respondFriendSchema,
  type CreateFriendRequestDto,
  type RespondFriendDto,
} from './friendships.dto';
import { CurrentUser, Surface } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

@Controller('friendships')
export class FriendshipsController {
  constructor(private readonly friendships: FriendshipsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.friendships.list(user);
  }

  @Post('requests')
  @HttpCode(201)
  async request(
    @CurrentUser() user: AuthUser,
    @ZBody(createFriendRequestSchema) dto: CreateFriendRequestDto,
  ) {
    return { friendship: await this.friendships.request(user, dto) };
  }

  @Patch(':id')
  @HttpCode(200)
  async respond(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(respondFriendSchema) dto: RespondFriendDto,
  ) {
    return { friendship: await this.friendships.respond(user, id, dto) };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.friendships.remove(user, id);
  }
}

@Controller('belt/friendships')
@Surface('belt')
export class BeltFriendshipsController {
  constructor(private readonly friendships: FriendshipsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.friendships.list(user);
  }

  @Post('requests')
  @HttpCode(201)
  async request(
    @CurrentUser() user: AuthUser,
    @ZBody(createFriendRequestSchema) dto: CreateFriendRequestDto,
  ) {
    return { friendship: await this.friendships.request(user, dto) };
  }

  @Patch(':id')
  @HttpCode(200)
  async respond(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(respondFriendSchema) dto: RespondFriendDto,
  ) {
    return { friendship: await this.friendships.respond(user, id, dto) };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.friendships.remove(user, id);
  }
}
