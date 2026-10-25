import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ChannelAccessService } from '../common/guards/channel-access.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import { toMessageView } from '../common/utils/message-view';

/**
 * 置顶（契约 §2.12 / §7 pins）：仅频道 moderator 及以上可置顶（契约 §4）。
 * v1.0 契约未定义置顶相关的 WS 事件，因此这里只落库，不广播。
 */
@Injectable()
export class PinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  async pin(user: AuthUser, messageId: bigint) {
    const message = await this.loadMessage(messageId);
    await this.channelAccess.assert(message.channelId, user, 'moderate');

    const pin = await this.prisma.pin.upsert({
      where: { channelId_messageId: { channelId: message.channelId, messageId } },
      create: { channelId: message.channelId, messageId, pinnedBy: user.id },
      update: { pinnedBy: user.id },
    });
    return {
      channelId: pin.channelId,
      messageId: pin.messageId.toString(),
      pinnedBy: pin.pinnedBy,
      createdAt: pin.createdAt.toISOString(),
    };
  }

  async unpin(user: AuthUser, messageId: bigint) {
    const message = await this.loadMessage(messageId);
    await this.channelAccess.assert(message.channelId, user, 'moderate');
    const deleted = await this.prisma.pin.deleteMany({
      where: { channelId: message.channelId, messageId },
    });
    return { messageId: messageId.toString(), removed: deleted.count > 0 };
  }

  async list(user: AuthUser, channelId: string) {
    await this.channelAccess.assert(channelId, user, 'read');
    const pins = await this.prisma.pin.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });
    const messages = await this.prisma.message.findMany({
      where: { id: { in: pins.map((pin) => pin.messageId) }, deletedAt: null },
    });
    const byId = new Map(messages.map((message) => [message.id.toString(), message]));

    return {
      pins: pins
        .map((pin) => {
          const message = byId.get(pin.messageId.toString());
          if (!message) return null;
          return {
            pinnedBy: pin.pinnedBy,
            pinnedAt: pin.createdAt.toISOString(),
            message: toMessageView(message),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    };
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
