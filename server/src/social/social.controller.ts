import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { SocialService } from './social.service';
import { searchUsersQuerySchema, userPostsQuerySchema, type UserPostsQuery } from './social.dto';
import { CurrentUser, Surface } from '../common/decorators';
import { ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/**
 * 个人主页与关注（模块一）+ 我的等级（模块二）。
 * 全部挂在环带面：未登录拿不到，内部会话也会被 SurfaceGuard 拒掉。
 */
@Controller('belt')
@Surface('belt')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('users/search')
  async search(@CurrentUser() user: AuthUser, @ZQuery(searchUsersQuerySchema) query: { q: string }) {
    return this.social.search(user, query.q);
  }

  @Get('users/:handle/profile')
  async profile(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.social.profile(user, handle);
  }

  @Get('users/:handle/posts')
  async posts(@Param('handle') handle: string, @ZQuery(userPostsQuerySchema) query: UserPostsQuery) {
    return this.social.posts(handle, query.limit, query.cursor);
  }

  @Get('users/:handle/commissions')
  async commissions(@Param('handle') handle: string) {
    return this.social.commissions(handle);
  }

  @Get('users/:handle/services')
  async services(@Param('handle') handle: string) {
    return this.social.services(handle);
  }

  @Post('users/:handle/follow')
  @HttpCode(201)
  async follow(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.social.follow(user, handle);
  }

  @Delete('users/:handle/follow')
  @HttpCode(200)
  async unfollow(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.social.unfollow(user, handle);
  }

  @Get('me/level')
  async myLevel(@CurrentUser() user: AuthUser) {
    return this.social.meLevel(user);
  }
}
