import { Injectable, Logger } from '@nestjs/common';
import type { Card, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ChannelAccessService } from '../common/guards/channel-access.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeService, rooms } from '../common/realtime/realtime.service';
import type { AuthUser } from '../common/types/context';
import type { CardKind, CardStatus, TaskStatus } from '../common/types/enums';
import { clampLimit, decodeKeyCursor, encodeKeyCursor } from '../common/utils/cursor';
import { canDeleteCard, toViewer, assertCheck } from '../common/utils/permissions';
import { toMessageView } from '../common/utils/message-view';
import type { AttachmentView } from '../common/utils/message-view';
import { normalizeVoteConfig, projectVoteResult } from '../common/utils/vote';
import { FilesService } from '../files/files.service';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import { NotificationsService, type CreatedNotification } from '../notifications/notifications.service';
import type {
  AssignCardDto,
  CreateCardDto,
  ListCardsQuery,
  ReorderCardsDto,
  UpdateCardDto,
} from './cards.dto';

export interface VoteOptionView {
  id: string;
  label: string;
  position: number;
}

export interface CardView {
  id: string;
  channelId: string;
  kind: CardKind;
  title: string;
  body: string | null;
  color: string | null;
  tags: string[];
  position: number;
  status: CardStatus;
  taskStatus: TaskStatus | null;
  dueAt: string | null;
  closedAt: string | null;
  messageId: string | null;
  sourceCardId: string | null;
  createdBy: string;
  data: unknown;
  options: VoteOptionView[];
  assigneeIds: string[];
  attachments: AttachmentView[];
  createdAt: string;
  updatedAt: string;
}

interface CardCreationResult {
  card: Card;
  notifications: CreatedNotification[];
}

/**
 * 卡片统一模型（契约 §2.13）：material / idea / vote / task / artwork 共用一张表。
 * 每张卡同时会在频道流里生成一条 kind=card 的消息（message_id 双向关联）。
 */
@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /** 建卡（REST POST /cards）：同一事务内建卡 + 建频道流消息 */
  async create(user: AuthUser, dto: CreateCardDto): Promise<CardView> {
    await this.channelAccess.assert(dto.channelId, user, 'write');

    const result = await this.prisma.withTransaction(async (tx) => {
      const created = await this.createInTx(tx, user, dto);
      const message = await tx.message.create({
        data: {
          channelId: dto.channelId,
          senderId: user.id,
          kind: 'card',
          body: dto.title,
          clientMsgId: randomUUID(),
          cardId: created.card.id,
        },
      });
      const card = await tx.card.update({
        where: { id: created.card.id },
        data: { messageId: message.id },
      });
      const attachments = await tx.attachment.findMany({
        where: { cardId: card.id },
        select: { id: true, fileId: true, position: true },
      });
      const files = await tx.file.findMany({
        where: { id: { in: attachments.map((a) => a.fileId) } },
      });
      return { ...created, card, message, attachments, files };
    });

    this.realtime.emitToChannel(dto.channelId, 'message:new', {
      message: toMessageView(result.message),
    });
    const [view] = await this.hydrate([result.card]);
    if (!view) throw new AppError(ErrorCode.INTERNAL, '卡片创建后读取失败', { cardId: result.card.id });
    this.realtime.emitToChannel(dto.channelId, 'card:created', { card: view });
    this.notifications.publish(result.notifications);
    return view;
  }

  /** 事务内建卡：消息发送携带 card 时复用（不额外创建消息） */
  async createInTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    dto: CreateCardDto,
    options: { messageId?: bigint } = {},
  ): Promise<CardCreationResult> {
    const config = dto.kind === 'vote' ? normalizeVoteConfig(dto.data) : null;
    const data: Prisma.InputJsonValue =
      dto.kind === 'vote'
        ? {
            ...(dto.data as Record<string, unknown> | undefined),
            multi: config?.multi ?? false,
            anonymous: config?.anonymous ?? false,
            closesAt: config?.closesAt ?? null,
          }
        : ((dto.data ?? {}) as Prisma.InputJsonValue);

    const card = await tx.card.create({
      data: {
        channelId: dto.channelId,
        kind: dto.kind,
        title: dto.title,
        body: dto.body ?? null,
        color: dto.color ?? null,
        tags: dto.tags ?? [],
        position: dto.position ?? 1000,
        status: 'open',
        taskStatus: dto.kind === 'task' ? 'todo' : null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        sourceCardId: null,
        createdBy: user.id,
        data,
        ...(options.messageId !== undefined ? { messageId: options.messageId } : {}),
      },
    });

    // 投票选项
    if (dto.kind === 'vote') {
      const labels = this.extractOptionLabels(dto);
      if (labels.length < 2) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '投票卡片至少需要 2 个选项', {
          options: labels.length,
        });
      }
      await Promise.all(
        labels.map((label, index) =>
          tx.voteOption.create({
            data: { cardId: card.id, label, position: index },
          }),
        ),
      );
    }

    // 任务指派
    const notifications: CreatedNotification[] = [];
    if (dto.assigneeIds && dto.assigneeIds.length > 0) {
      const assignees = await this.validateAssignees(tx, dto.channelId, dto.assigneeIds);
      await Promise.all(
        assignees.map((assigneeId) =>
          tx.cardAssignee.create({
            data: { cardId: card.id, userId: assigneeId, assignedBy: user.id },
          }),
        ),
      );
      const pending = assignees
        .filter((id) => id !== user.id)
        .map((id) => ({
          userId: id,
          type: 'card_assigned' as const,
          title: `${user.displayName} 把任务「${card.title}」指派给你`,
          channelId: dto.channelId,
          cardId: card.id,
          payload: { cardId: card.id, channelId: dto.channelId },
        }));
      notifications.push(...(await this.notifications.createInTx(tx, pending)));
    }

    // 卡片附件
    if (dto.fileIds && dto.fileIds.length > 0) {
      const files = await this.files.resolveAttachables(tx, user, dto.channelId, dto.fileIds);
      await Promise.all(
        files.map((file, index) =>
          tx.attachment.create({
            data: { fileId: file.id, cardId: card.id, position: index },
          }),
        ),
      );
    }

    return { card, notifications };
  }

  /** GET /channels/:id/cards */
  async list(user: AuthUser, channelId: string, query: ListCardsQuery) {
    await this.channelAccess.assert(channelId, user, 'read');
    const limit = clampLimit(query.limit);
    const cursor = query.cursor ? decodeKeyCursor(query.cursor, 2) : null;
    const cursorPosition = cursor ? Number(cursor[0]) : null;
    const cursorCreatedAt = cursor ? new Date(Number(cursor[1])) : null;

    const rows = await this.prisma.card.findMany({
      where: {
        channelId,
        deletedAt: null,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(cursorPosition !== null && cursorCreatedAt
          ? {
              OR: [
                { position: { gt: cursorPosition } },
                { position: cursorPosition, createdAt: { gt: cursorCreatedAt } },
              ],
            }
          : {}),
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    const views = await this.hydrate(page);
    return {
      cards: views,
      nextCursor:
        hasMore && last ? encodeKeyCursor([last.position, last.createdAt.getTime()]) : null,
      hasMore,
    };
  }

  /** GET /cards/:id */
  async get(user: AuthUser, cardId: string): Promise<CardView> {
    const card = await this.loadCard(cardId);
    await this.channelAccess.assert(card.channelId, user, 'read');
    const [view] = await this.hydrate([card]);
    if (!view) throw new AppError(ErrorCode.VALIDATION_FAILED, '卡片不存在', { cardId });
    return view;
  }

  /** PATCH /cards/:id */
  async update(user: AuthUser, cardId: string, dto: UpdateCardDto): Promise<CardView> {
    const card = await this.loadCard(cardId);
    const resolved = await this.channelAccess.assert(card.channelId, user, 'read');
    assertCheck(this.canManage(user, card, resolved.channel), { cardId });

    await this.prisma.card.update({
      where: { id: cardId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.status !== undefined
          ? {
              status: dto.status,
              closedAt: dto.status === 'closed' ? new Date() : card.closedAt,
            }
          : {}),
        ...(dto.taskStatus !== undefined ? { taskStatus: dto.taskStatus } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt === null ? null : new Date(dto.dueAt) } : {}),
        ...(dto.data !== undefined ? { data: dto.data as Prisma.InputJsonValue } : {}),
      },
    });

    const updated = await this.loadCard(cardId);
    const [view] = await this.hydrate([updated]);
    if (!view) throw new AppError(ErrorCode.VALIDATION_FAILED, '卡片不存在', { cardId });
    this.realtime.emitToChannel(card.channelId, 'card:updated', { card: view });
    return view;
  }

  /** DELETE /cards/:id：软删除（契约允许软删除 cards） */
  async remove(user: AuthUser, cardId: string): Promise<{ cardId: string; channelId: string }> {
    const card = await this.loadCard(cardId);
    const resolved = await this.channelAccess.assert(card.channelId, user, 'read');
    assertCheck(this.canManage(user, card, resolved.channel), { cardId });

    await this.prisma.card.update({ where: { id: cardId }, data: { deletedAt: new Date() } });
    this.realtime.emitToChannel(card.channelId, 'card:deleted', {
      cardId,
      channelId: card.channelId,
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.CARD_DELETE,
      targetKind: 'card',
      targetId: cardId,
      meta: { channelId: card.channelId, kind: card.kind },
    });
    return { cardId, channelId: card.channelId };
  }

  /** POST /cards/reorder：看板拖拽排序 */
  async reorder(user: AuthUser, dto: ReorderCardsDto): Promise<{ updated: number }> {
    await this.channelAccess.assert(dto.channelId, user, 'write');
    const result = await this.prisma.withTransaction(async (tx) => {
      let count = 0;
      for (const item of dto.items) {
        const updated = await tx.card.updateMany({
          where: { id: item.id, channelId: dto.channelId, kind: dto.kind, deletedAt: null },
          data: { position: item.position },
        });
        count += updated.count;
      }
      return count;
    });
    this.realtime.emitToChannel(dto.channelId, 'card:updated', {
      card: { channelId: dto.channelId, kind: dto.kind, reordered: true },
    });
    return { updated: result };
  }

  /** POST /cards/:id/assign */
  async assign(user: AuthUser, cardId: string, dto: AssignCardDto): Promise<CardView> {
    const card = await this.loadCard(cardId);
    await this.channelAccess.assert(card.channelId, user, 'write');
    const assignees = await this.validateAssignees(this.prisma, card.channelId, dto.userIds);

    const createdNotifications = await this.prisma.withTransaction(async (tx) => {
      await tx.cardAssignee.deleteMany({ where: { cardId } });
      await Promise.all(
        assignees.map((userId) =>
          tx.cardAssignee.create({
            data: { cardId, userId, assignedBy: user.id },
          }),
        ),
      );
      const pending = assignees
        .filter((id) => id !== user.id)
        .map((userId) => ({
          userId,
          type: 'card_assigned' as const,
          title: `${user.displayName} 把任务「${card.title}」指派给你`,
          channelId: card.channelId,
          cardId,
          payload: { cardId, channelId: card.channelId },
        }));
      const created = await this.notifications.createInTx(tx, pending);
      return created;
    });
    this.notifications.publish(createdNotifications);

    const updated = await this.loadCard(cardId);
    const [view] = await this.hydrate([updated]);
    if (!view) throw new AppError(ErrorCode.VALIDATION_FAILED, '卡片不存在', { cardId });
    this.realtime.emitToChannel(card.channelId, 'card:updated', { card: view });
    return view;
  }

  /** POST /cards/:id/close：投票截止 / 任务收尾 */
  async close(user: AuthUser, cardId: string): Promise<CardView> {
    const card = await this.loadCard(cardId);
    const resolved = await this.channelAccess.assert(card.channelId, user, 'read');
    assertCheck(this.canManage(user, card, resolved.channel), { cardId });

    await this.prisma.card.update({
      where: { id: cardId },
      data: { status: 'closed', closedAt: new Date() },
    });
    const updated = await this.loadCard(cardId);
    const [view] = await this.hydrate([updated]);
    if (!view) throw new AppError(ErrorCode.VALIDATION_FAILED, '卡片不存在', { cardId });

    this.realtime.emitToChannel(card.channelId, 'card:updated', { card: view });
    if (card.kind === 'vote') {
      // 截止即公布最终票型（匿名投票 voters 恒为空）
      const [options, ballots] = await Promise.all([
        this.prisma.voteOption.findMany({ where: { cardId }, select: { id: true } }),
        this.prisma.voteBallot.findMany({
          where: { cardId },
          select: { optionId: true, userId: true },
        }),
      ]);
      const result = projectVoteResult(
        normalizeVoteConfig(card.data),
        options.map((option) => option.id),
        ballots,
      );
      this.realtime.emitToChannel(card.channelId, 'vote:updated', {
        cardId,
        ...result,
        closed: true,
      });
    }
    return view;
  }

  /** POST /cards/:id/convert：卡片转任务 / 投票 / 灵感 */
  async convert(user: AuthUser, cardId: string, kind: 'task' | 'vote' | 'idea'): Promise<CardView> {
    const source = await this.loadCard(cardId);
    await this.channelAccess.assert(source.channelId, user, 'write');

    const dto: CreateCardDto = {
      channelId: source.channelId,
      kind,
      title: source.title,
      ...(source.body ? { body: source.body } : {}),
      ...(source.color ? { color: source.color as CreateCardDto['color'] } : {}),
      tags: source.tags,
      ...(kind === 'vote' ? { options: ['同意', '反对'] } : {}),
      ...(kind === 'task' ? { data: { convertedFrom: cardId } } : {}),
    };

    const created = await this.create(user, dto);
    await this.prisma.card.update({
      where: { id: created.id },
      data: { sourceCardId: cardId },
    });
    return { ...created, sourceCardId: cardId };
  }

  /** POST /messages/:id/convert：从消息建卡 */
  async createFromMessage(
    user: AuthUser,
    messageId: bigint,
    kind: 'task' | 'vote' | 'idea',
  ): Promise<CardView> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '信号不存在', { messageId: messageId.toString() });
    }
    await this.channelAccess.assert(message.channelId, user, 'read');
    if (message.deletedAt) throw new AppError(ErrorCode.VALIDATION_FAILED, '信号已删除');

    const title = (message.body ?? '未命名信号').slice(0, 60);
    const dto: CreateCardDto = {
      channelId: message.channelId,
      kind,
      title,
      ...(message.body ? { body: message.body.slice(0, 4000) } : {}),
      ...(kind === 'vote' ? { options: ['同意', '反对'] } : {}),
    };

    const created = await this.create(user, dto);
    await this.prisma.message.update({
      where: { id: messageId },
      data: { cardId: created.id },
    });
    return created;
  }

  // ── 内部 ───────────────────────────────────────────────────────────

  private async loadCard(cardId: string): Promise<Card> {
    const card = await this.prisma.card.findFirst({ where: { id: cardId, deletedAt: null } });
    if (!card) throw new AppError(ErrorCode.VALIDATION_FAILED, '卡片不存在', { cardId });
    return card;
  }

  private canManage(
    user: AuthUser,
    card: Card,
    channel: { id: string; name: string; visibility: 'public' | 'private'; archived: boolean },
  ) {
    return canDeleteCard(
      toViewer(user),
      { id: card.id, channelId: card.channelId, kind: card.kind, createdBy: card.createdBy, deletedAt: card.deletedAt },
      channel,
    );
  }

  /** 批量补齐投票选项 / 指派 / 附件 */
  private async hydrate(cards: readonly Card[]): Promise<CardView[]> {
    if (cards.length === 0) return [];
    const cardIds = cards.map((card) => card.id);
    const [options, assignees, attachments] = await Promise.all([
      this.prisma.voteOption.findMany({
        where: { cardId: { in: cardIds } },
        orderBy: [{ cardId: 'asc' }, { position: 'asc' }],
      }),
      this.prisma.cardAssignee.findMany({ where: { cardId: { in: cardIds } } }),
      this.prisma.attachment.findMany({ where: { cardId: { in: cardIds } } }),
    ]);
    const files = await this.prisma.file.findMany({
      where: { id: { in: attachments.map((item) => item.fileId) } },
    });

    const optionsByCard = new Map<string, VoteOptionView[]>();
    for (const option of options) {
      const list = optionsByCard.get(option.cardId) ?? [];
      list.push({ id: option.id, label: option.label, position: option.position });
      optionsByCard.set(option.cardId, list);
    }
    const assigneeByCard = new Map<string, string[]>();
    for (const row of assignees) {
      const list = assigneeByCard.get(row.cardId) ?? [];
      list.push(row.userId);
      assigneeByCard.set(row.cardId, list);
    }
    return cards.map((card) =>
      this.toView(
        card,
        optionsByCard.get(card.id) ?? [],
        assigneeByCard.get(card.id) ?? [],
        attachments,
        files,
      ),
    );
  }

  private toView(
    card: Card,
    options: VoteOptionView[],
    assigneeIds: string[],
    attachments: readonly { id: string; fileId: string; cardId: string | null; position: number }[],
    files: readonly { id: string; originalName: string; mime: string; kind: string; sizeBytes: bigint; width: number | null; height: number | null; durationMs: number | null; previewStatus: string }[],
  ): CardView {
    const fileMap = new Map(files.map((file) => [file.id, file]));
    const cardAttachments: AttachmentView[] = attachments
      .filter((attachment) => attachment.cardId === card.id)
      .sort((a, b) => a.position - b.position)
      .map((attachment) => {
        const file = fileMap.get(attachment.fileId);
        return {
          id: attachment.id,
          fileId: attachment.fileId,
          position: attachment.position,
          originalName: file?.originalName ?? '',
          mime: file?.mime ?? '',
          kind: file?.kind ?? 'other',
          sizeBytes: (file?.sizeBytes ?? 0n).toString(),
          width: file?.width ?? null,
          height: file?.height ?? null,
          durationMs: file?.durationMs ?? null,
          previewStatus: file?.previewStatus ?? 'none',
        };
      });

    return {
      id: card.id,
      channelId: card.channelId,
      kind: card.kind,
      title: card.title,
      body: card.body,
      color: card.color,
      tags: card.tags,
      position: card.position,
      status: card.status,
      taskStatus: card.taskStatus,
      dueAt: card.dueAt?.toISOString() ?? null,
      closedAt: card.closedAt?.toISOString() ?? null,
      messageId: card.messageId?.toString() ?? null,
      sourceCardId: card.sourceCardId,
      createdBy: card.createdBy,
      data: card.data,
      options,
      assigneeIds,
      attachments: cardAttachments,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    };
  }

  private extractOptionLabels(dto: CreateCardDto): string[] {
    if (dto.options && dto.options.length >= 2) return dto.options;
    const dataOptions = (dto.data as { options?: unknown } | undefined)?.options;
    if (Array.isArray(dataOptions)) {
      return dataOptions.filter((item): item is string => typeof item === 'string');
    }
    return [];
  }

  private async validateAssignees(
    client: Prisma.TransactionClient | PrismaService,
    channelId: string,
    userIds: readonly string[],
  ): Promise<string[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const members = await client.channelMember.findMany({
      where: { channelId, userId: { in: unique } },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((member) => member.userId));
    const invalid = unique.filter((id) => !memberIds.has(id));
    if (invalid.length > 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '指派对象必须是频道成员', { invalid });
    }
    return unique;
  }

  /** 供消息模块引用（避免重复实现广播出口） */
  broadcastMessage(channelId: string, message: Parameters<typeof toMessageView>[0]): void {
    this.realtime.emitToRoom(rooms.channel(channelId), 'message:new', {
      message: toMessageView(message),
    });
  }
}
