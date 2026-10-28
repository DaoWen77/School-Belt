import { Injectable, Logger } from '@nestjs/common';
import type { Message, Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ChannelAccessService, type ResolvedChannel } from '../common/guards/channel-access.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeService, rooms } from '../common/realtime/realtime.service';
import type { AuthUser } from '../common/types/context';
import { clampLimit, decodeSeqCursor, encodeSeqCursor } from '../common/utils/cursor';
import { sendIdempotently, type IdempotentGateway } from '../common/utils/idempotency';
import { extractMentionHandles } from '../common/utils/mentions';
import type { AttachmentView, MessageView, ReplyToSummary } from '../common/utils/message-view';
import { buildReplyToSummary, toMessageView } from '../common/utils/message-view';
import { assertCheck, canDeleteMessage, canEditMessage, toViewer } from '../common/utils/permissions';
import { FilesService } from '../files/files.service';
import { CardsService } from '../cards/cards.service';
import { RateLimiterService } from '../common/redis/rate-limiter.service';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import { BeltRealtimeService } from '../belt/belt-realtime.service';
import {
  NotificationsService,
  type CreateNotificationInput,
  type CreatedNotification,
} from '../notifications/notifications.service';
import type { EditMessageDto, ListMessagesQuery, SendMessageDto, ThreadQuery } from './messages.dto';
import { assertReplyTarget } from './reply-rules';

interface InsertedMessage {
  view: MessageView;
  notifications: CreatedNotification[];
}

interface SendInput {
  channelId: string;
  senderId: string;
  clientMsgId: string;
  dto: SendMessageDto;
  user: AuthUser;
  resolved: ResolvedChannel;
}

type FileReader = Pick<Prisma.TransactionClient, 'attachment' | 'file'>;
type ReplyReader = Pick<Prisma.TransactionClient, 'message' | 'user'>;

/**
 * 消息核心（契约 §2.8 / §6 / §7）：
 * - 发消息：唯一键幂等 + 事务落库 + 事务后广播；
 * - 线程：单层（parent_id → 根，thread_root_id = 根 id），根消息维护计数；
 * - 分页：messages.id 单调序，游标 `seq:<id>`；direction=older|newer 支持离线补拉。
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly cards: CardsService,
    private readonly files: FilesService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
    private readonly beltRealtime: BeltRealtimeService,
  ) {}

  async send(
    user: AuthUser,
    channelId: string,
    dto: SendMessageDto,
  ): Promise<{ message: MessageView; dup: boolean }> {
    // DM 的发送权由 channel_members 成员关系 + 频道权限统一判定。
    const resolved = await this.channelAccess.assert(channelId, user, 'write');
    // 契约 §9：5 条/秒突发 + 60 条/分钟/用户（REST 与 WS 同一条路径）
    await this.rateLimiter.assertMessageSend(user.id);
    const input: SendInput = {
      channelId,
      senderId: user.id,
      clientMsgId: dto.clientMsgId,
      dto,
      user,
      resolved,
    };

    const gateway: IdempotentGateway<SendInput, InsertedMessage> = {
      insert: async (payload) =>
        this.prisma.withTransaction((tx) => this.insertMessage(tx, payload)),
      findExisting: async (payload) => this.findByClientMsgId(payload),
      isDuplicateError: (error) => PrismaService.isUniqueViolation(error),
    };

    const { message, dup } = await sendIdempotently(gateway, input);
    if (!dup) {
      // 持久化成功后才广播（契约 §6 ack 语义）
      this.realtime.emitToChannel(channelId, 'message:new', { message: message.view });
      if (message.view.threadRootId) {
        this.realtime.emitToThread(message.view.threadRootId, 'message:new', {
          message: message.view,
        });
      }
      // bridge DM 的另一端是环带 WS，需要把同一条消息补投到 belt 用户房间。
      if (resolved.channel.surface === 'bridge') {
        const members = await this.prisma.channelMember.findMany({
          where: { channelId },
          select: { userId: true },
        });
        const payload = { channelId, message: message.view };
        for (const member of members) {
          this.beltRealtime.emitToBeltUser(member.userId, 'belt:dm:message', payload);
        }
      }
      this.notifications.publish(message.notifications);
    }
    return { message: message.view, dup };
  }

  async list(user: AuthUser, channelId: string, query: ListMessagesQuery) {
    await this.channelAccess.assert(channelId, user, 'read');
    const limit = clampLimit(query.limit);
    const direction = query.direction;
    const cursor = query.cursor ? decodeSeqCursor(query.cursor) : null;

    const rows = await this.prisma.message.findMany({
      where: {
        channelId,
        deletedAt: null,
        ...(cursor !== null
          ? direction === 'older'
            ? { id: { lt: cursor } }
            : { id: { gt: cursor } }
          : {}),
      },
      orderBy: { id: direction === 'newer' ? 'asc' : 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const ordered = direction === 'older' ? [...page].reverse() : page;
    const attachments = await this.loadAttachmentMap(this.prisma, ordered.map((row) => row.id));
    const replyToMap = await this.loadReplyToMap(this.prisma, ordered);

    const oldest = ordered[0];
    const newest = ordered[ordered.length - 1];
    const nextCursor = hasMore
      ? direction === 'older'
        ? oldest
          ? encodeSeqCursor(oldest.id)
          : null
        : newest
          ? encodeSeqCursor(newest.id)
          : null
      : null;

    return {
      messages: ordered.map((row) =>
        toMessageView(
          row,
          attachments.get(row.id.toString()) ?? [],
          replyToMap.get(row.replyToId?.toString() ?? '') ?? null,
        ),
      ),
      nextCursor,
      hasMore,
      direction,
    };
  }

  /** GET /messages/:id/thread：单层线程，按 id 正序翻页 */
  async thread(user: AuthUser, messageId: bigint, query: ThreadQuery) {
    const target = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!target) throw new AppError(ErrorCode.VALIDATION_FAILED, '信号不存在', { messageId: messageId.toString() });
    await this.channelAccess.assert(target.channelId, user, 'read');

    const rootId = target.threadRootId ?? target.id;
    const root =
      target.threadRootId === null
        ? target
        : await this.prisma.message.findUnique({ where: { id: rootId } });
    if (!root) throw new AppError(ErrorCode.VALIDATION_FAILED, '线程根不存在');

    const limit = clampLimit(query.limit);
    const cursor = query.cursor ? decodeSeqCursor(query.cursor) : 0n;
    const rows = await this.prisma.message.findMany({
      where: { threadRootId: rootId, deletedAt: null, id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const attachments = await this.loadAttachmentMap(this.prisma, [
      root.id,
      ...page.map((row) => row.id),
    ]);
    const replyToMap = await this.loadReplyToMap(this.prisma, [root, ...page]);
    const last = page[page.length - 1];

    return {
      root: toMessageView(
        root,
        attachments.get(root.id.toString()) ?? [],
        replyToMap.get(root.replyToId?.toString() ?? '') ?? null,
      ),
      messages: page.map((row) =>
        toMessageView(
          row,
          attachments.get(row.id.toString()) ?? [],
          replyToMap.get(row.replyToId?.toString() ?? '') ?? null,
        ),
      ),
      nextCursor: hasMore && last ? encodeSeqCursor(last.id) : null,
      hasMore,
    };
  }

  async get(user: AuthUser, messageId: bigint): Promise<MessageView> {
    const message = await this.findMessageOrThrow(messageId);
    await this.channelAccess.assert(message.channelId, user, 'read');
    const attachments = await this.loadAttachmentMap(this.prisma, [message.id]);
    const replyToMap = await this.loadReplyToMap(this.prisma, [message]);
    return toMessageView(
      message,
      attachments.get(message.id.toString()) ?? [],
      replyToMap.get(message.replyToId?.toString() ?? '') ?? null,
    );
  }

  async edit(user: AuthUser, messageId: bigint, dto: EditMessageDto): Promise<MessageView> {
    const message = await this.findMessageOrThrow(messageId);
    const resolved = await this.channelAccess.assert(message.channelId, user, 'read');
    assertCheck(
      canEditMessage(toViewer(user, resolved.member), message, new Date()),
      { messageId: messageId.toString() },
    );

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { body: dto.body, editedAt: new Date() },
    });
    const attachments = await this.loadAttachmentMap(this.prisma, [updated.id]);
    const replyToMap = await this.loadReplyToMap(this.prisma, [updated]);
    const view = toMessageView(
      updated,
      attachments.get(updated.id.toString()) ?? [],
      replyToMap.get(updated.replyToId?.toString() ?? '') ?? null,
    );
    this.realtime.emitToChannel(message.channelId, 'message:updated', { message: view });
    return view;
  }

  async remove(user: AuthUser, messageId: bigint): Promise<{ messageId: string; channelId: string }> {
    const message = await this.findMessageOrThrow(messageId);
    const resolved = await this.channelAccess.assert(message.channelId, user, 'read');
    assertCheck(
      canDeleteMessage(toViewer(user, resolved.member), message, resolved.channel),
      { messageId: messageId.toString() },
    );

    const deletedAt = new Date();
    await this.prisma.withTransaction(async (tx) => {
      await tx.message.update({
        where: { id: messageId },
        data: { deletedAt, deletedBy: user.id },
      });
      if (message.threadRootId) {
        await tx.message.update({
          where: { id: message.threadRootId },
          data: { threadReplyCount: { decrement: 1 } },
        });
      }
    });

    this.realtime.emitToChannel(message.channelId, 'message:deleted', {
      messageId: messageId.toString(),
      channelId: message.channelId,
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.MESSAGE_DELETE,
      targetKind: 'message',
      targetId: messageId.toString(),
      meta: { channelId: message.channelId, isThreadReply: message.threadRootId !== null },
    });
    return { messageId: messageId.toString(), channelId: message.channelId };
  }

  // ── 事务内写入（幂等网关实现）───────────────────────────────────────

  private async insertMessage(
    tx: Prisma.TransactionClient,
    input: SendInput,
  ): Promise<InsertedMessage> {
    const { dto, user, channelId, resolved } = input;

    // 线程：只允许单层（回复挂到根）
    let threadRootId: bigint | null = null;
    if (dto.parentId !== undefined) {
      const parent = await tx.message.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.channelId !== channelId || parent.deletedAt) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '父信号不存在或已删除', {
          parentId: dto.parentId.toString(),
        });
      }
      threadRootId = parent.threadRootId ?? parent.id;
    }

    // Phase1：引用消息必须存在、同频道、未删除
    if (dto.replyToId !== undefined) {
      const target = await tx.message.findUnique({
        where: { id: dto.replyToId },
        select: { id: true, channelId: true, deletedAt: true },
      });
      assertReplyTarget(target, channelId);
    }

    // 随消息建卡（WS payload.card / REST body.card）
    let cardId: string | null = null;
    const notifications: CreatedNotification[] = [];
    if (dto.card) {
      const created = await this.cards.createInTx(tx, user, { ...dto.card, channelId });
      cardId = created.card.id;
      notifications.push(...created.notifications);
    }

    const mentionIds = await this.resolveMentions(tx, channelId, dto.body ?? null);
    const message = await tx.message.create({
      data: {
        channelId,
        senderId: user.id,
        kind: dto.kind,
        body: dto.body ?? null,
        clientMsgId: dto.clientMsgId,
        parentId: dto.parentId ?? null,
        threadRootId,
        replyToId: dto.replyToId ?? null,
        cardId,
        mentions: mentionIds,
      },
    });

    // 附件
    if (dto.attachmentIds && dto.attachmentIds.length > 0) {
      const files = await this.files.resolveAttachables(tx, user, channelId, dto.attachmentIds);
      await tx.attachment.createMany({
        data: files.map((file, index) => ({
          fileId: file.id,
          messageId: message.id,
          position: index,
        })),
      });
    }

    // 根消息维护 thread_reply_count / last_reply_at
    if (threadRootId !== null) {
      await tx.message.update({
        where: { id: threadRootId },
        data: { threadReplyCount: { increment: 1 }, lastReplyAt: new Date() },
      });
    }

    // 契约 v1.2 §A1：会话列表排序用 channels.last_message_at，与消息同事务更新
    await tx.channel.update({
      where: { id: channelId },
      data: { lastMessageAt: message.createdAt },
    });

    // 卡片与消息双向关联
    if (cardId) {
      await tx.card.update({ where: { id: cardId }, data: { messageId: message.id } });
    }

    const notificationInputs = await this.buildNotifications(tx, input, message, threadRootId, mentionIds);
    notifications.push(...(await this.notifications.createInTx(tx, notificationInputs)));

    const attachments = await this.loadAttachmentMap(tx, [message.id]);
    const replyToMap = await this.loadReplyToMap(tx, [message]);
    return {
      view: toMessageView(
        message,
        attachments.get(message.id.toString()) ?? [],
        replyToMap.get(message.replyToId?.toString() ?? '') ?? null,
      ),
      notifications,
    };
  }

  private async findByClientMsgId(input: SendInput): Promise<InsertedMessage | null> {
    const existing = await this.prisma.message.findUnique({
      where: {
        channelId_senderId_clientMsgId: {
          channelId: input.channelId,
          senderId: input.senderId,
          clientMsgId: input.clientMsgId,
        },
      },
    });
    if (!existing) return null;
    const attachments = await this.loadAttachmentMap(this.prisma, [existing.id]);
    const replyToMap = await this.loadReplyToMap(this.prisma, [existing]);
    return {
      view: toMessageView(
        existing,
        attachments.get(existing.id.toString()) ?? [],
        replyToMap.get(existing.replyToId?.toString() ?? '') ?? null,
      ),
      notifications: [],
    };
  }

  // ── 辅助 ───────────────────────────────────────────────────────────

  private async findMessageOrThrow(messageId: bigint): Promise<Message> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '信号不存在', {
        messageId: messageId.toString(),
      });
    }
    return message;
  }

  /** @handle → 用户 id，只保留本频道成员 */
  private async resolveMentions(
    tx: Prisma.TransactionClient,
    channelId: string,
    body: string | null,
  ): Promise<string[]> {
    const handles = extractMentionHandles(body);
    if (handles.length === 0) return [];
    const users = await tx.user.findMany({
      where: { handle: { in: handles } },
      select: { id: true, handle: true },
    });
    if (users.length === 0) return [];
    const members = await tx.channelMember.findMany({
      where: { channelId, userId: { in: users.map((user) => user.id) } },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((member) => member.userId));
    return users.filter((user) => memberIds.has(user.id)).map((user) => user.id);
  }

  private async buildNotifications(
    tx: Prisma.TransactionClient,
    input: SendInput,
    message: Message,
    threadRootId: bigint | null,
    mentionIds: readonly string[],
  ): Promise<CreateNotificationInput[]> {
    const items: CreateNotificationInput[] = [];
    const excerpt = (message.body ?? '').slice(0, 200);

    for (const userId of mentionIds) {
      if (userId === input.senderId) continue;
      items.push({
        userId,
        type: 'mention',
        title: `${input.user.displayName} 在 #${input.resolved.channel.name} 提到了你`,
        body: excerpt,
        channelId: input.channelId,
        messageId: message.id,
        payload: { channelId: input.channelId, messageId: message.id.toString() },
      });
    }

    if (threadRootId !== null) {
      const root = await tx.message.findUnique({
        where: { id: threadRootId },
        select: { senderId: true, body: true },
      });
      if (root && root.senderId !== input.senderId) {
        items.push({
          userId: root.senderId,
          type: 'thread_reply',
          title: `${input.user.displayName} 回复了你的信号`,
          body: excerpt,
          channelId: input.channelId,
          messageId: message.id,
          payload: { channelId: input.channelId, messageId: message.id.toString(), rootId: threadRootId.toString() },
        });
      }
    }
    return items;
  }

  /** 批量取附件视图，按 messageId 分组 */
  private async loadAttachmentMap(
    client: FileReader,
    messageIds: readonly bigint[],
  ): Promise<Map<string, AttachmentView[]>> {
    const result = new Map<string, AttachmentView[]>();
    if (messageIds.length === 0) return result;

    const attachments = await client.attachment.findMany({
      where: { messageId: { in: [...messageIds] } },
      orderBy: [{ messageId: 'asc' }, { position: 'asc' }],
    });
    if (attachments.length === 0) return result;

    const files = await client.file.findMany({
      where: { id: { in: attachments.map((attachment) => attachment.fileId) } },
    });
    const fileMap = new Map(files.map((file) => [file.id, file]));

    for (const attachment of attachments) {
      if (attachment.messageId === null) continue;
      const file = fileMap.get(attachment.fileId);
      if (!file) continue;
      const key = attachment.messageId.toString();
      const list = result.get(key) ?? [];
      list.push({
        id: attachment.id,
        fileId: attachment.fileId,
        position: attachment.position,
        originalName: file.originalName,
        mime: file.mime,
        kind: file.kind,
        sizeBytes: file.sizeBytes.toString(),
        width: file.width,
        height: file.height,
        durationMs: file.durationMs,
        previewStatus: file.previewStatus,
      });
      result.set(key, list);
    }
    return result;
  }

  /** Phase1：批量取被引用消息摘要（含发送者显示名），避免 N+1 */
  private async loadReplyToMap(
    client: ReplyReader,
    rows: readonly { replyToId: bigint | null }[],
  ): Promise<Map<string, ReplyToSummary>> {
    const result = new Map<string, ReplyToSummary>();
    const ids = [...new Set(rows.map((row) => row.replyToId).filter((id): id is bigint => id !== null))];
    if (ids.length === 0) return result;

    const replies = await client.message.findMany({
      where: { id: { in: ids } },
      select: { id: true, senderId: true, body: true, deletedAt: true },
    });
    if (replies.length === 0) return result;

    const senders = await client.user.findMany({
      where: { id: { in: [...new Set(replies.map((reply) => reply.senderId))] } },
      select: { id: true, displayName: true },
    });
    const names = new Map(senders.map((sender) => [sender.id, sender.displayName]));
    for (const reply of replies) {
      result.set(
        reply.id.toString(),
        buildReplyToSummary(reply, names.get(reply.senderId) ?? '未知用户'),
      );
    }
    return result;
  }
}
