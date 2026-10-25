import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { PostsService } from './posts.service';
import {
  createCommentSchema,
  createPostSchema,
  listCommentsQuerySchema,
  listPostsQuerySchema,
  type CreateCommentDto,
  type CreatePostDto,
  type ListCommentsQuery,
  type ListPostsQuery,
} from './posts.dto';
import { ArchiveService } from './archive.service';
import { ActivityService } from './activity.service';
import { CurrentUser } from '../common/decorators';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 朋友圈（Sprint4）：登录即可浏览/点赞/评论；发帖与删除作者本人 */
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @ZQuery(listPostsQuerySchema) query: ListPostsQuery) {
    return this.posts.list(user, query);
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: AuthUser, @ZBody(createPostSchema) dto: CreatePostDto) {
    return { post: await this.posts.create(user, dto) };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.remove(user, id);
  }

  @Post(':id/like')
  @HttpCode(200)
  async like(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.like(user, id);
  }

  @Delete(':id/like')
  @HttpCode(200)
  async unlike(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.unlike(user, id);
  }

  @Get(':id/comments')
  async comments(@Param('id') id: string, @ZQuery(listCommentsQuerySchema) query: ListCommentsQuery) {
    return this.posts.listComments(id, query);
  }

  @Post(':id/comments')
  @HttpCode(201)
  async addComment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(createCommentSchema) dto: CreateCommentDto,
  ) {
    return { comment: await this.posts.addComment(user, id, dto) };
  }
}

/** 档案室（Sprint4）：当前用户可见频道内的素材/作品/灵感卡 */
@Controller('archive')
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.archive.list(user);
  }
}

/** 活跃度（Sprint4）：7 天指标 + 每日趋势，供雷达图/折线图 */
@Controller('stats')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('activity')
  async list() {
    return this.activity.get();
  }
}
