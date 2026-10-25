import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RssService } from './rss.service';
import {
  createRssSourceSchema,
  fetchRssSchema,
  updateRssSourceSchema,
  type CreateRssSourceDto,
  type FetchRssDto,
  type UpdateRssSourceDto,
} from './rss.dto';
import { CurrentUser, Roles } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/**
 * 新闻塔配置：仅内部 Owner/Admin 可改；抓取写入 belt/telegraph 的 rss Post。
 */
@Controller('rss')
export class RssController {
  constructor(private readonly rss: RssService) {}

  @Get('sources')
  async list() {
    return this.rss.list();
  }

  @Post('sources')
  @Roles('owner', 'admin')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUser,
    @ZBody(createRssSourceSchema) dto: CreateRssSourceDto,
  ) {
    return { source: await this.rss.create(user, dto) };
  }

  @Patch('sources/:id')
  @Roles('owner', 'admin')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(updateRssSourceSchema) dto: UpdateRssSourceDto,
  ) {
    return { source: await this.rss.update(user, id, dto) };
  }

  @Delete('sources/:id')
  @Roles('owner', 'admin')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rss.remove(user, id);
  }

  @Post('fetch')
  @Roles('owner', 'admin')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async fetch(
    @CurrentUser() user: AuthUser,
    @ZBody(fetchRssSchema) dto: FetchRssDto,
  ) {
    return this.rss.fetch(user, dto);
  }
}
