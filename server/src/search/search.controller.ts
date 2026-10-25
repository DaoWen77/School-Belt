import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { channelSearchQuerySchema, searchQuerySchema, type ChannelSearchQuery, type SearchQuery } from './search.dto';
import { CurrentUser } from '../common/decorators';
import { ChannelGuard } from '../common/guards/channel.guard';
import { ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 搜索（契约 §7 search）：全站搜索 + 频道内搜索 */
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('search')
  async global(@CurrentUser() user: AuthUser, @ZQuery(searchQuerySchema) query: SearchQuery) {
    return this.search.search(user, query);
  }

  @Get('channels/:id/search')
  @UseGuards(ChannelGuard())
  async inChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @ZQuery(channelSearchQuerySchema) query: ChannelSearchQuery,
  ) {
    return this.search.searchInChannel(user, channelId, query);
  }
}
