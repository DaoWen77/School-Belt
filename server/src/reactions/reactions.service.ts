import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ChannelAccessService } from '../common/guards/channel-access.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';

export interface ReactionSummary {
  messageId: string;
  cardId: string | null;
  counts: Record<string, number>;
  mine: string[];
}

/**
 * 反应（契约 §2.9 / §6 reaction:updated）：
 * - 幂等：同一用户同一 emoji 同一消息只存一条（部分唯一索引兜底）；
 * - 广播 counts + mine，前端可直接覆盖本地状态。
 */
@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
    private readonly realtime: RealtimeService,
  ) {}

  async add(user: AuthUser, messageId: bigint, emoji: string): Promise<ReactionSummary> {
    const message = await this.loadMessage(messageId);
    await this.channelAccess.assert(message.channelId, user, 'read');

    const existing = await this.prisma.reaction.findFirst({
      where: { messageId, userId: user.id, emoji },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.reaction.create({
        data: { messageId, userId: user.id, emoji },
      });
    }
    const summary = await this.summarise(messageId, user.id, message.channelId);
    this.realtime.emitToChannel(message.channelId, 'reaction:updated', summary);
    return summary;
  }

  async remove(user: AuthUser, messageId: bigint, emoji: string): Promise<ReactionSummary> {
    const message = await this.loadMessage(messageId);
    await this.channelAccess.assert(message.channelId, user, 'read');

    await this.prisma.reaction.deleteMany({ where: { messageId, userId: user.id, emoji } });
    const summary = await this.summarise(messageId, user.id, message.channelId);
    this.realtime.emitToChannel(message.channelId, 'reaction:updated', summary);
    return summary;
  }

  private async summarise(
    messageId: bigint,
    userId: string,
    channelId: string,
  ): Promise<ReactionSummary> {
    void channelId;
    const rows = await this.prisma.reaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
    });
    const counts: Record<string, number> = {};
    const mine = new Set<string>();
    for (const row of rows) {
      counts[row.emoji] = (counts[row.emoji] ?? 0) + 1;
      if (row.userId === userId) mine.add(row.emoji);
    }
    return { messageId: messageId.toString(), cardId: null, counts, mine: [...mine] };
  }

  private async loadMessage(messageId: bigint) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '信号不存在', {
        messageId: messageId.toString(),
      });
    }
    return message;
  }
}
