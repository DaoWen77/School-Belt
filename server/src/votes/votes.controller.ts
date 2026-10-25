import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { VotesService } from './votes.service';
import { castVoteSchema, type CastVoteDto } from './votes.dto';
import { CurrentUser } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 投票（契约 §7 cards/:id/vote、cards/:id/results） */
@Controller('cards')
export class VotesController {
  constructor(private readonly votes: VotesService) {}

  @Post(':id/vote')
  @HttpCode(200)
  async cast(
    @CurrentUser() user: AuthUser,
    @Param('id') cardId: string,
    @ZBody(castVoteSchema) dto: CastVoteDto,
  ) {
    return this.votes.cast(user, cardId, dto);
  }

  @Get(':id/results')
  async results(@CurrentUser() user: AuthUser, @Param('id') cardId: string) {
    return this.votes.results(user, cardId);
  }
}
