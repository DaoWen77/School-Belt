import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdentityService } from '../common/identity/identity.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import { BeltRealtimeService } from './belt-realtime.service';
import { S3Service } from '../files/s3.service';
import { BeltCommandService } from './belt-command.service';
import { BeltBotService } from './belt-bot.service';

export interface BeltChannelView {
  id: string;
  name: string;
  topic: string | null;
  visibility: 'public' | 'private';
  organizationId: string | null;
  unread?: number;
}

export interface BeltSenderView {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  prefixes: string[];
}

export interface BeltMessageView {
  id: string;
  channelId: string;
  senderId: string;
  kind: string;
  body: string;
  createdAt: string;
  sender: BeltSenderView;
  card: {
    id: string;
    title: string;
    body: string | null;
    data: unknown;
  } | null;
  attachments: Array<{
    id: string;
    fileId: string;
    originalName: string;
    mime: string;
    kind: string;
    sizeBytes: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    url: string;
  }>;
}

@Injectable()
export class BeltChannelsService {
  private readonly logger = new Logger(BeltChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly realtime: BeltRealtimeService,
    private readonly s3: S3Service,
    private readonly commands: BeltCommandService,
    private readonly bots: BeltBotService,
  ) {}

  async list(user: AuthUser): Promise<{ channels: BeltChannelView[] }> {
    const channels = await this.prisma.channel.findMany({
      where: {
        surface: 'belt',
        kind: 'channel',
        archivedAt: null,
        OR: [
          { organizationId: null },
          { members: { some: { userId: user.id } } },
        ],
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, topic: true, visibility: true, organizationId: true },
    });
    const memberships = await this.prisma.channelMember.findMany({
      where: { userId: user.id, channelId: { in: channels.map((channel) => channel.id) } },
      select: { channelId: true, lastReadSeq: true },
    });
    const lastRead = new Map(memberships.map((member) => [member.channelId, member.lastReadSeq]));
    const counts = await Promise.all(
      channels.map((channel) => {
        const seq = lastRead.get(channel.id);
        if (seq === undefined) return Promise.resolve(0);
        return this.prisma.message.count({
          where: {
            channelId: channel.id,
            deletedAt: null,
            senderId: { not: user.id },
            id: { gt: seq },
          },
        });
      }),
    );
    return {
      channels: channels.map((channel, index) => ({ ...channel, unread: counts[index] ?? 0 })),
    };
  }

  async search(
    user: AuthUser,
    query: string,
  ): Promise<{ results: Array<{ id: string; channelId: string; channelName: string; body: string; createdAt: string }> }> {
    const q = query.trim().slice(0, 80);
    if (q.length < 2) return { results: [] };
    const channels = await this.prisma.channel.findMany({
      where: {
        surface: 'belt',
        kind: 'channel',
        archivedAt: null,
        OR: [{ organizationId: null }, { members: { some: { userId: user.id } } }],
      },
      select: { id: true, name: true },
    });
    if (channels.length === 0) return { results: [] };
    const names = new Map(channels.map((channel) => [channel.id, channel.name]));
    const rows = await this.prisma.message.findMany({
      where: {
        channelId: { in: channels.map((channel) => channel.id) },
        deletedAt: null,
        body: { contains: q, mode: 'insensitive' },
      },
      orderBy: { id: 'desc' },
      take: 20,
      select: { id: true, channelId: true, body: true, createdAt: true },
    });
    return {
      results: rows.map((row) => ({
        id: String(row.id),
        channelId: row.channelId,
        channelName: names.get(row.channelId) ?? '频道',
        body: (row.body ?? '').slice(0, 120),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async members(
    user: AuthUser,
    channelId: string,
  ): Promise<{ members: Array<{ userId: string; handle: string; displayName: string; avatarFileId: string | null }> }> {
    const channel = await this.requireChannel(user, channelId);
    const explicit = await this.prisma.channelMember.findMany({
      where: { channelId },
      select: {
        userId: true,
        user: { select: { id: true, handle: true, displayName: true, avatarFileId: true } },
      },
    });
    const members = explicit
      .filter((row) => row.user.handle !== 'dijiang_bot')
      .map((row) => ({
        userId: row.user.id,
        handle: row.user.handle,
        displayName: row.user.displayName,
        avatarFileId: row.user.avatarFileId,
      }));
    if (members.length > 0) return { members };
    const rows = await this.prisma.user.findMany({
      where: { accountOrigin: 'belt', status: 'active', handle: { not: 'dijiang_bot' } },
      orderBy: { displayName: 'asc' },
      take: 100,
      select: { id: true, handle: true, displayName: true, avatarFileId: true },
    });
    return {
      members: rows.map((row) => ({
        userId: row.id,
        handle: row.handle,
        displayName: row.displayName,
        avatarFileId: row.avatarFileId,
      })),
    };
  }

  async messages(
    user: AuthUser,
    channelId: string,
    limit: number,
  ): Promise<{ messages: BeltMessageView[]; channel: BeltChannelView }> {
    const channel = await this.requireChannel(user, channelId);
    const rows = await this.prisma.message.findMany({
      where: { channelId, deletedAt: null },
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        id: true,
        channelId: true,
        senderId: true,
        kind: true,
        body: true,
        cardId: true,
        createdAt: true,
      },
    });
    const messages = await this.views(rows.reverse());
    return { channel, messages };
  }

  async send(
    user: AuthUser,
    channelId: string,
    body: string,
    clientMsgId?: string,
    attachmentIds?: string[],
  ): Promise<BeltMessageView> {
    const channel = await this.requireChannel(user, channelId);
    // 斜杠指令拦截（/ping /task /poll /report /help）：命中则转成指令回显文本。
    if (body) {
      const command = await this.commands.intercept(user, channel.id, body);
      if (command.handled) {
        body = command.reply ?? '';
      }
    }
    const id = clientMsgId ?? randomUUID();
    const fileIds = [...new Set(attachmentIds ?? [])];
    if (!body && fileIds.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不能为空');
    }
    try {
      const row = await this.prisma.withTransaction(async (tx) => {
        const files = fileIds.length
          ? await tx.file.findMany({
              where: {
                id: { in: fileIds },
                channelId: channel.id,
                ownerId: user.id,
                status: 'ready',
              },
            })
          : [];
        if (files.length !== fileIds.length) {
          throw new AppError(ErrorCode.FILE_NOT_READY, '附件未就绪或不属于当前频道');
        }
        const kind = files.length === 0
          ? 'text'
          : files.every((file) => file.kind === 'image')
            ? 'image'
            : 'file';
        const created = await tx.message.create({
          data: {
            channelId: channel.id,
            senderId: user.id,
            kind,
            body: body || null,
            clientMsgId: id,
          },
          select: {
            id: true,
            channelId: true,
            senderId: true,
            kind: true,
            body: true,
            cardId: true,
            createdAt: true,
          },
        });
        await tx.channel.update({
          where: { id: channel.id },
          data: { lastMessageAt: created.createdAt },
        });
        if (files.length > 0) {
          const order = new Map(files.map((file, index) => [file.id, index]));
          await tx.attachment.createMany({
            data: fileIds.map((fileId, index) => ({
              fileId,
              messageId: created.id,
              position: order.get(fileId) ?? index,
            })),
          });
        }
        return created;
      });
      const view = (await this.views([row]))[0]!;
      this.realtime.emitToBeltChannel(channel.id, 'belt:message', view);
      // Bot 驻场：@Bot 呼号触发异步回复，不阻塞发送链路。
      void this.bots.maybeReply(user, channel.id, body).catch(() => undefined);
      return view;
    } catch (error) {
      if (PrismaService.isUniqueViolation(error)) {
        const existing = await this.prisma.message.findFirst({
          where: { channelId: channel.id, senderId: user.id, clientMsgId: id },
          select: { id: true, channelId: true, senderId: true, kind: true, body: true, cardId: true, createdAt: true },
        });
        if (existing) return (await this.views([existing]))[0]!;
      }
      throw error;
    }
  }

  /** 环带 Owner 直接新建公开频道（不经过内部 /channels 的 internal 守卫）。 */
  async createChannel(user: AuthUser, name: string, topic: string | null): Promise<BeltChannelView> {
    if (user.globalRole !== 'owner' && user.globalRole !== 'admin') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅 Owner 可新建频道');
    }
    const slug = `belt-${randomUUID().slice(0, 8)}`;
    const channel = await this.prisma.channel.create({
      data: {
        name: name.slice(0, 60),
        slug,
        topic: topic?.slice(0, 200) ?? null,
        visibility: 'public',
        kind: 'channel',
        surface: 'belt',
        position: 1000,
        createdBy: user.id,
      },
      select: { id: true, name: true, topic: true, visibility: true, organizationId: true },
    });
    this.realtime.emitToBeltChannel?.(channel.id, 'belt:channel:created', { channel });
    return channel;
  }

  async deleteMessage(user: AuthUser, channelId: string, messageId: string): Promise<{ deleted: true }> {
    const channel = await this.requireChannel(user, channelId);
    if (!/^\d+$/.test(messageId)) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在');
    const row = await this.prisma.message.findFirst({
      where: { id: BigInt(messageId), channelId: channel.id, deletedAt: null },
      select: { id: true, senderId: true },
    });
    if (!row) throw new AppError(ErrorCode.VALIDATION_FAILED, '消息不存在');
    if (row.senderId !== user.id) throw new AppError(ErrorCode.FORBIDDEN, '只能撤回自己的消息');
    await this.prisma.message.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedBy: user.id },
    });
    this.realtime.emitToBeltChannel(channel.id, 'belt:message:deleted', { channelId: channel.id, messageId: messageId });
    return { deleted: true };
  }

  private async requireChannel(user: AuthUser, channelId: string): Promise<BeltChannelView> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channelId)) {
      throw new AppError(ErrorCode.CHANNEL_NOT_FOUND, '环带频道不存在');
    }
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        surface: 'belt',
        kind: 'channel',
        archivedAt: null,
        OR: [
          { organizationId: null },
          { members: { some: { userId: user.id } } },
        ],
      },
      select: { id: true, name: true, topic: true, visibility: true, organizationId: true },
    });
    if (!channel) throw new AppError(ErrorCode.CHANNEL_NOT_FOUND, '环带频道不存在');
    return channel;
  }

  private async views(
    rows: Array<{
      id: bigint;
      channelId: string;
      senderId: string;
      kind: string;
      body: string | null;
      cardId: string | null;
      createdAt: Date;
    }>,
  ): Promise<BeltMessageView[]> {
    if (rows.length === 0) return [];
    const senderIds = [...new Set(rows.map((row) => row.senderId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, handle: true, displayName: true, avatarFileId: true, tags: true, globalRole: true },
    });
    const prefixes = await this.identity.prefixesForMany(users);
    const cardIds = [...new Set(rows.map((row) => row.cardId).filter((id): id is string => Boolean(id)))];
    const cards = cardIds.length
      ? await this.prisma.card.findMany({
          where: { id: { in: cardIds }, deletedAt: null },
          select: { id: true, title: true, body: true, data: true },
        })
      : [];
    const cardMap = new Map(cards.map((card) => [card.id, card]));
    const messageIds = rows.map((row) => row.id);
    const attachments = await this.prisma.attachment.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: [{ messageId: 'asc' }, { position: 'asc' }],
      select: { id: true, messageId: true, fileId: true, position: true },
    });
    const attachmentFiles = attachments.length
      ? await this.prisma.file.findMany({
          where: { id: { in: [...new Set(attachments.map((row) => row.fileId))] }, status: 'ready' },
          select: {
            id: true,
            originalName: true,
            mime: true,
            kind: true,
            sizeBytes: true,
            width: true,
            height: true,
            durationMs: true,
            storageKey: true,
          },
        })
      : [];
    const attachmentFileMap = new Map(attachmentFiles.map((file) => [file.id, file]));
    const attachmentMap = new Map<string, BeltMessageView['attachments']>();
    for (const row of attachments) {
      if (!row.messageId) continue;
      const file = attachmentFileMap.get(row.fileId);
      if (!file) continue;
      const url = await this.s3.presignGet(file.storageKey);
      const list = attachmentMap.get(row.messageId.toString()) ?? [];
      list.push({
        id: row.id,
        fileId: file.id,
        originalName: file.originalName,
        mime: file.mime,
        kind: file.kind,
        sizeBytes: file.sizeBytes.toString(),
        width: file.width,
        height: file.height,
        durationMs: file.durationMs,
        url,
      });
      attachmentMap.set(row.messageId.toString(), list);
    }
    const map = new Map(
      users.map((user) => [
        user.id,
        {
          id: user.id,
          handle: user.handle,
          displayName: user.displayName,
          avatarFileId: user.avatarFileId,
          prefixes: prefixes[user.id] ?? [],
        },
      ]),
    );
    return rows.map((row) => ({
      id: row.id.toString(),
      channelId: row.channelId,
      senderId: row.senderId,
      kind: row.kind,
      body: row.body ?? '',
      createdAt: row.createdAt.toISOString(),
      attachments: attachmentMap.get(row.id.toString()) ?? [],
      card: row.cardId && cardMap.has(row.cardId)
        ? {
            id: cardMap.get(row.cardId)!.id,
            title: cardMap.get(row.cardId)!.title,
            body: cardMap.get(row.cardId)!.body,
            data: cardMap.get(row.cardId)!.data,
          }
        : null,
      sender:
        map.get(row.senderId) ?? {
          id: row.senderId,
          handle: '',
          displayName: '未知成员',
          avatarFileId: null,
          prefixes: [],
        },
    }));
  }
}
