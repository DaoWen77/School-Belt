import { Controller, Delete, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ReactionsService } from './reactions.service';
import { CurrentUser } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';

const messageIdSchema = z.string().regex(/^\d{1,19}$/);
const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });
type ReactionDto = z.infer<typeof reactionSchema>;

function parseId(raw: string): bigint {
  const parsed = messageIdSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息 id 非法', { id: raw });
  return BigInt(parsed.data);
}

/** 反应（契约 §7 reactions） */
@Controller('messages')
export class ReactionsController {
  constructor(private readonly reactions: ReactionsService) {}

  @Post(':id/reactions')
  async add(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @ZBody(reactionSchema) dto: ReactionDto,
  ) {
    return this.reactions.add(user, parseId(id), dto.emoji);
  }

  @Delete(':id/reactions/:emoji')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('emoji') emoji: string,
  ) {
    return this.reactions.remove(user, parseId(id), decodeURIComponent(emoji));
  }
}
