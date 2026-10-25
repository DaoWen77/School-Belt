import { Injectable } from '@nestjs/common';
import { CardKind } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/types/context';

export interface ArchiveItemView {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  fileIds: string[];
  channelId: string;
  channelName: string;
  createdAt: string;
}

/**
 * 档案室（Sprint4）：当前用户可见频道内、未归档的素材/作品/灵感卡。
 * 可见性 = 公开频道 OR 本人是频道成员 OR 本人是频道创建者；`channels.archived_at IS NULL`。
 */
@Injectable()
export class ArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser): Promise<{ items: ArchiveItemView[] }> {
    const cards = await this.prisma.card.findMany({
      where: {
        kind: { in: [CardKind.material, CardKind.artwork, CardKind.idea] },
        deletedAt: null,
        channel: {
          archivedAt: null,
          OR: [
            { visibility: 'public' },
            { createdBy: user.id },
            { members: { some: { userId: user.id } } },
          ],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        channelId: true,
        createdAt: true,
        channel: { select: { name: true } },
      },
    });

    const attachments = cards.length
      ? await this.prisma.attachment.findMany({
          where: { cardId: { in: cards.map((card) => card.id) } },
          orderBy: [{ position: 'asc' }],
          select: { cardId: true, fileId: true },
        })
      : [];
    const filesByCard = new Map<string, string[]>();
    for (const attachment of attachments) {
      if (!attachment.cardId) continue;
      const list = filesByCard.get(attachment.cardId) ?? [];
      list.push(attachment.fileId);
      filesByCard.set(attachment.cardId, list);
    }

    return {
      items: cards.map((card) => ({
        id: card.id,
        kind: card.kind,
        title: card.title,
        body: card.body,
        fileIds: filesByCard.get(card.id) ?? [],
        channelId: card.channelId,
        channelName: card.channel.name,
        createdAt: card.createdAt.toISOString(),
      })),
    };
  }
}
