import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PinsService } from './pins.service';
import { CurrentUser } from '../common/decorators';
import { ChannelGuard } from '../common/guards/channel.guard';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';

const messageIdSchema = z.string().regex(/^\d{1,19}$/);

function parseId(raw: string): bigint {
  const parsed = messageIdSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息 id 非法', { id: raw });
  return BigInt(parsed.data);
}

/** 置顶（契约 §7 pins） */
@Controller('messages')
export class MessagePinsController {
  constructor(private readonly pins: PinsService) {}

  @Post(':id/pin')
  async pin(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pins.pin(user, parseId(id));
  }

  @Delete(':id/pin')
  async unpin(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pins.unpin(user, parseId(id));
  }
}

/** 频道置顶列表（契约 §7：GET /channels/:id/pins） */
@Controller('channels')
export class ChannelPinsController {
  constructor(private readonly pins: PinsService) {}

  @Get(':id/pins')
  @UseGuards(ChannelGuard())
  async list(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.pins.list(user, channelId);
  }
}
