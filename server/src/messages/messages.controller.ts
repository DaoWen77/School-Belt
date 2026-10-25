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
import { z } from 'zod';
import { MessagesService } from './messages.service';
import {
  editMessageSchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  threadQuerySchema,
  type EditMessageDto,
  type ListMessagesQuery,
  type SendMessageDto,
  type ThreadQuery,
} from './messages.dto';
import { CurrentUser } from '../common/decorators';
import { ChannelGuard } from '../common/guards/channel.guard';
import { ZBody, ZQuery } from '../common/pipes/zod-validation.pipe';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import { convertCardSchema, type ConvertCardDto } from '../cards/cards.dto';
import { CardsService } from '../cards/cards.service';

const messageIdSchema = z.string().regex(/^\d{1,19}$/, '消息 id 必须是十进制整数');

function parseMessageId(raw: string): bigint {
  const parsed = messageIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '消息 id 非法', { id: raw });
  }
  return BigInt(parsed.data);
}

/** 频道内的消息流（契约 §7 messages） */
@Controller('channels')
export class ChannelMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get(':id/messages')
  @UseGuards(ChannelGuard())
  async list(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @ZQuery(listMessagesQuerySchema) query: ListMessagesQuery,
  ) {
    return this.messages.list(user, channelId, query);
  }

  /** REST 兜底发送（与 WS message:send 同语义） */
  @Post(':id/messages')
  @HttpCode(200)
  @UseGuards(ChannelGuard({ access: 'write' }))
  async send(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @ZBody(sendMessageSchema) dto: SendMessageDto,
  ) {
    const result = await this.messages.send(user, channelId, dto);
    return { ...result, code: result.dup ? 'DUPLICATE_MESSAGE' : null };
  }
}

/** 单条消息 / 线程（契约 §7 messages/threads） */
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly cards: CardsService,
  ) {}

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.get(user, parseMessageId(id));
  }

  @Patch(':id')
  async edit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(editMessageSchema) dto: EditMessageDto,
  ) {
    return this.messages.edit(user, parseMessageId(id), dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.remove(user, parseMessageId(id));
  }

  @Get(':id/thread')
  async thread(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZQuery(threadQuerySchema) query: ThreadQuery,
  ) {
    return this.messages.thread(user, parseMessageId(id), query);
  }

  /** 从消息建卡（契约 §7：POST /messages/:id/convert） */
  @Post(':id/convert')
  @HttpCode(201)
  async convert(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(convertCardSchema) dto: ConvertCardDto,
  ) {
    return this.cards.createFromMessage(user, parseMessageId(id), dto.kind);
  }
}
