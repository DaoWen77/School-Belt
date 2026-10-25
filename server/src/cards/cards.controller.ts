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
import { CardsService } from './cards.service';
import {
  assignCardSchema,
  convertCardSchema,
  createCardSchema,
  listCardsQuerySchema,
  reorderCardsSchema,
  updateCardSchema,
  type AssignCardDto,
  type ConvertCardDto,
  type CreateCardDto,
  type ListCardsQuery,
  type ReorderCardsDto,
  type UpdateCardDto,
} from './cards.dto';
import { CurrentUser } from '../common/decorators';
import { ChannelGuard } from '../common/guards/channel.guard';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/** 卡片（契约 §7 cards）：素材 / 灵感 / 投票 / 任务 / 作品统一入口 */
@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: AuthUser, @ZBody(createCardSchema) dto: CreateCardDto) {
    return this.cards.create(user, dto);
  }

  @Post('reorder')
  @HttpCode(200)
  async reorder(@CurrentUser() user: AuthUser, @ZBody(reorderCardsSchema) dto: ReorderCardsDto) {
    return this.cards.reorder(user, dto);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cards.get(user, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(updateCardSchema) dto: UpdateCardDto,
  ) {
    return this.cards.update(user, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cards.remove(user, id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  async assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(assignCardSchema) dto: AssignCardDto,
  ) {
    return this.cards.assign(user, id, dto);
  }

  @Post(':id/close')
  @HttpCode(200)
  async close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cards.close(user, id);
  }

  @Post(':id/convert')
  @HttpCode(201)
  async convert(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(convertCardSchema) dto: ConvertCardDto,
  ) {
    return this.cards.convert(user, id, dto.kind);
  }
}

/** 频道内的卡片列表（契约 §7：GET /channels/:id/cards） */
@Controller('channels')
export class ChannelCardsController {
  constructor(private readonly cards: CardsService) {}

  @Get(':id/cards')
  @UseGuards(ChannelGuard())
  async list(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @ZQuery(listCardsQuerySchema) query: ListCardsQuery,
  ) {
    return this.cards.list(user, channelId, query);
  }
}
