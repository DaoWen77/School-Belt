import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdentityService } from '../common/identity/identity.service';
import { ExpService } from '../social/exp.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import { taskFee, taskNet } from './task-money';
import type {
  ApplyTaskDto,
  CreateTaskDto,
  ListTasksQuery,
  UpdateTaskDto,
} from './belt.dto';

/** 平台金库账号 handle（0028_escrow 插入；5% 手续费唯一去向） */
export const TREASURY_HANDLE = 'platform_treasury';

export interface TaskUserCard {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  prefixes: string[];
}

export interface TaskEscrowView {
  state: string;
  amountCents: number;
  feeCents: number;
}

export interface TaskCard {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  feeCents: number;
  netCents: number;
  deadline: string | null;
  status: string;
  createdAt: string;
  editedAt: string | null;
  creator: TaskUserCard;
  taker: TaskUserCard | null;
  myRole: 'creator' | 'taker' | 'visitor';
  applicationCount: number;
  myApplicationStatus: string | null;
  escrow: TaskEscrowView | null;
  canApply: boolean;
  canSelect: boolean;
  canSubmit: boolean;
  canAccept: boolean;
  canCancel: boolean;
  canEdit: boolean;
}

export interface TaskApplicationCard {
  id: string;
  message: string | null;
  status: string;
  createdAt: string;
  applicant: TaskUserCard;
}

const USER_CARD_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  avatarFileId: true,
  tags: true,
  globalRole: true,
  displayOrganizationId: true,
} satisfies Prisma.UserSelect;

const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  priceCents: true,
  deadline: true,
  status: true,
  createdAt: true,
  editedAt: true,
  creatorId: true,
  takerId: true,
  creator: { select: USER_CARD_SELECT },
  taker: { select: USER_CARD_SELECT },
  escrow: { select: { state: true, amountCents: true, feeCents: true } },
  _count: { select: { applications: true } },
} satisfies Prisma.TaskSelect;

const APPLICATION_SELECT = {
  id: true,
  message: true,
  status: true,
  createdAt: true,
  applicant: { select: USER_CARD_SELECT },
} satisfies Prisma.TaskApplicationSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;
type UserRow = Prisma.UserGetPayload<{ select: typeof USER_CARD_SELECT }>;
type ApplicationRow = Prisma.TaskApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

const CONFLICT = '委托状态已变更，请刷新后重试';

function conflict(message = CONFLICT): AppError {
  return new AppError(ErrorCode.TASK_CONFLICT, message);
}

function notFound(taskId: string): AppError {
  return new AppError(ErrorCode.TASK_NOT_FOUND, '委托不存在', { taskId });
}

/**
 * 环带委托交易（模块五）。
 *
 * 资金红线：冻结 / 打款 / 退款全部在 prisma.withTransaction 内，条件扣款防竞态，
 * 同一笔交易的 ledger 行共享 groupId，幂等键 `task:*:<taskId>` 兜住重复请求。
 * 金额分配只走 task-money.ts（5% 向下取整）。
 */
@Injectable()
export class BeltTasksService {
  private readonly logger = new Logger(BeltTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly exp: ExpService,
  ) {}

  // ───────────────────────────── 读 ─────────────────────────────

  async list(actor: AuthUser, query: ListTasksQuery): Promise<{ items: TaskCard[] }> {
    const where: Prisma.TaskWhereInput = {};
    if (query.scope === 'posted') where.creatorId = actor.id;
    else if (query.scope === 'taken') where.takerId = actor.id;
    if (query.status) where.status = query.status;
    else if (query.scope === 'all') where.status = { in: ['open', 'in_progress'] };

    const rows = await this.prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      select: TASK_SELECT,
    });
    const mine = await this.myApplicationMap(actor.id, rows.map((row) => row.id));
    const cards = await this.toCards(rows, actor.id, mine);
    return { items: cards };
  }

  async detail(
    actor: AuthUser,
    taskId: string,
  ): Promise<{
    task: TaskCard;
    applications?: TaskApplicationCard[];
    myApplication?: TaskApplicationCard;
  }> {
    const row = await this.prisma.task.findUnique({ where: { id: taskId }, select: TASK_SELECT });
    if (!row) throw notFound(taskId);

    const myRow = await this.prisma.taskApplication.findFirst({
      where: { taskId, applicantId: actor.id },
      select: APPLICATION_SELECT,
    });
    const prefixes = await this.prefixMap([row.creator, row.taker, myRow?.applicant]);

    const result: {
      task: TaskCard;
      applications?: TaskApplicationCard[];
      myApplication?: TaskApplicationCard;
    } = {
      task: this.buildCard(row, actor.id, myRow?.status ?? null, prefixes),
    };
    if (myRow) result.myApplication = this.buildApplication(myRow, prefixes);
    if (row.creatorId === actor.id) {
      const applicationRows = await this.prisma.taskApplication.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
        select: APPLICATION_SELECT,
      });
      const appPrefixes = await this.prefixMap([
        ...applicationRows.map((application) => application.applicant),
        ...prefixUsers(row),
      ]);
      result.applications = applicationRows.map((application) =>
        this.buildApplication(application, appPrefixes),
      );
    }
    return result;
  }

  // ───────────────────────────── 发布 / 编辑 ─────────────────────────────

  async create(actor: AuthUser, dto: CreateTaskDto): Promise<{ task: TaskCard }> {
    const row = await this.prisma.task.create({
      data: {
        creatorId: actor.id,
        title: dto.title,
        description: dto.description,
        priceCents: dto.priceCents,
        deadline: dto.deadline ?? null,
      },
      select: TASK_SELECT,
    });
    return { task: await this.cardOf(row, actor.id, null) };
  }

  async update(actor: AuthUser, taskId: string, dto: UpdateTaskDto): Promise<{ task: TaskCard }> {
    const existing = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, creatorId: true, status: true },
    });
    if (!existing) throw notFound(taskId);
    if (existing.creatorId !== actor.id) {
      throw new AppError(ErrorCode.FORBIDDEN, '只有委托人可以编辑委托');
    }
    if (existing.status !== 'open') throw conflict('委托已不在招募中，不能编辑');

    const row = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
        ...(dto.deadline !== undefined ? { deadline: dto.deadline } : {}),
        editedAt: new Date(),
      },
      select: TASK_SELECT,
    });
    const mine = await this.myApplicationMap(actor.id, [taskId]);
    return { task: await this.cardOf(row, actor.id, mine.get(taskId) ?? null) };
  }

  // ───────────────────────────── 申请 ─────────────────────────────

  async apply(
    actor: AuthUser,
    taskId: string,
    dto: ApplyTaskDto,
  ): Promise<{ application: TaskApplicationCard }> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, creatorId: true, status: true },
    });
    if (!task) throw notFound(taskId);
    if (task.creatorId === actor.id) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '不能申请自己发布的委托');
    }
    if (task.status !== 'open') throw conflict('委托已不在招募中');

    try {
      const row = await this.prisma.taskApplication.create({
        data: { taskId, applicantId: actor.id, message: dto.message ?? null },
        select: APPLICATION_SELECT,
      });
      return { application: this.buildApplication(row, await this.prefixMap([row.applicant])) };
    } catch (error) {
      if (PrismaService.isUniqueViolation(error)) throw conflict('你已申请过该委托');
      throw error;
    }
  }

  // ───────────────────────────── 选择接单人（冻结资金）─────────────────────────────

  async select(
    actor: AuthUser,
    taskId: string,
    applicationId: string,
  ): Promise<{ task: TaskCard; escrow: TaskEscrowView }> {
    try {
      const escrow = await this.prisma.withTransaction(async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
          select: { id: true, creatorId: true, status: true, priceCents: true },
        });
        if (!task) throw notFound(taskId);
        if (task.creatorId !== actor.id) {
          throw new AppError(ErrorCode.FORBIDDEN, '只有委托人可以选择接单人');
        }
        if (task.status !== 'open') throw conflict('委托已不在招募中');

        const application = await tx.taskApplication.findUnique({
          where: { id: applicationId },
          select: { id: true, taskId: true, applicantId: true, status: true },
        });
        if (!application || application.taskId !== taskId) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, '申请不存在或不属于该委托');
        }
        if (application.status !== 'pending') throw conflict('该申请已被处理');

        const existing = await tx.escrow.findUnique({
          where: { taskId },
          select: { state: true },
        });
        if (existing) throw conflict('该委托已存在托管记录');

        // 状态机闸门：只有 open 能被抢到 in_progress（行锁 + 条件更新），
        // 与并发的取消 / 选择互斥。
        const moved = await tx.task.updateMany({
          where: { id: taskId, status: 'open' },
          data: {
            status: 'in_progress',
            takerId: application.applicantId,
            acceptedApplicationId: application.id,
          },
        });
        if (moved.count === 0) throw conflict('委托已不在招募中');

        const priceCents = task.priceCents;
        let balanceAfter: number;
        try {
          // 条件扣款：余额不足时行不匹配（P2025），避免先查后改的竞态。
          const debited = await tx.user.update({
            where: { id: task.creatorId, balanceCents: { gte: priceCents } },
            data: { balanceCents: { decrement: priceCents } },
            select: { balanceCents: true },
          });
          balanceAfter = debited.balanceCents;
        } catch (error) {
          if (PrismaService.isNotFound(error)) {
            throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, '商券余额不足');
          }
          throw error;
        }

        await tx.ledgerEntry.create({
          data: {
            userId: task.creatorId,
            amountCents: -priceCents,
            balanceAfterCents: balanceAfter,
            kind: 'task_escrow',
            refType: 'task',
            refId: taskId,
            groupId: randomUUID(),
            idempotencyKey: `task:escrow:${taskId}`,
            memo: '冻结委托资金',
          },
        });

        const created = await tx.escrow.create({
          data: {
            taskId,
            amountCents: priceCents,
            feeCents: taskFee(priceCents),
            state: 'held',
          },
          select: { state: true, amountCents: true, feeCents: true },
        });

        await tx.taskApplication.update({
          where: { id: application.id },
          data: { status: 'selected' },
        });
        await tx.taskApplication.updateMany({
          where: { taskId, status: 'pending', id: { not: application.id } },
          data: { status: 'rejected' },
        });

        return created;
      });

      const row = await this.requireTaskRow(taskId);
      const mine = await this.myApplicationMap(actor.id, [taskId]);
      return {
        task: await this.cardOf(row, actor.id, mine.get(taskId) ?? null),
        escrow: {
          state: escrow.state,
          amountCents: escrow.amountCents,
          feeCents: escrow.feeCents,
        },
      };
    } catch (error) {
      // 并发重复选择：幂等键唯一冲突 → 409，不重复冻结。
      if (PrismaService.isUniqueViolation(error)) throw conflict('该委托已被处理');
      throw error;
    }
  }

  // ───────────────────────────── 提交交付 ─────────────────────────────

  async submit(actor: AuthUser, taskId: string): Promise<{ task: TaskCard }> {
    await this.prisma.withTransaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: { id: true, takerId: true, status: true },
      });
      if (!task) throw notFound(taskId);
      if (task.takerId !== actor.id) {
        throw new AppError(ErrorCode.FORBIDDEN, '只有接单人才能提交交付');
      }
      if (task.status !== 'in_progress') throw conflict('委托当前不可提交');
      const moved = await tx.task.updateMany({
        where: { id: taskId, status: 'in_progress' },
        data: { status: 'submitted' },
      });
      if (moved.count === 0) throw conflict('委托当前不可提交');
    });
    return { task: await this.taskFor(actor.id, taskId) };
  }

  // ───────────────────────────── 验收打款 ─────────────────────────────

  async accept(
    actor: AuthUser,
    taskId: string,
  ): Promise<{
    task: TaskCard;
    payout: { grossCents: number; feeCents: number; netCents: number };
    myBalanceCents: number;
  }> {
    const { takerId, payout } = await this.prisma.withTransaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: { id: true, creatorId: true, takerId: true, status: true },
      });
      if (!task) throw notFound(taskId);
      if (task.creatorId !== actor.id) {
        throw new AppError(ErrorCode.FORBIDDEN, '只有委托人可以验收打款');
      }
      if (task.status !== 'submitted') throw conflict('委托尚未提交交付');
      if (!task.takerId) throw conflict('委托缺少接单人');

      const escrow = await tx.escrow.findUnique({
        where: { taskId },
        select: { amountCents: true, feeCents: true, state: true },
      });
      if (!escrow || escrow.state !== 'held') throw conflict('托管资金状态异常');

      const grossCents = escrow.amountCents;
      const feeCents = escrow.feeCents;
      const netCents = taskNet(grossCents, feeCents);
      const groupId = randomUUID();

      // 状态机闸门：submitted → completed 只能成功一次（行锁 + 条件更新）。
      const closed = await tx.task.updateMany({
        where: { id: taskId, status: 'submitted' },
        data: { status: 'completed' },
      });
      if (closed.count === 0) throw conflict('委托状态已变更，请刷新后重试');

      const creditedTaker = await tx.user.update({
        where: { id: task.takerId },
        data: { balanceCents: { increment: netCents } },
        select: { balanceCents: true },
      });

      const rows: Prisma.LedgerEntryCreateManyInput[] = [
        {
          userId: task.takerId,
          amountCents: netCents,
          balanceAfterCents: creditedTaker.balanceCents,
          kind: 'task_payout',
          refType: 'task',
          refId: taskId,
          groupId,
          idempotencyKey: `task:payout:${taskId}`,
          memo: '委托交付报酬',
        },
      ];
      if (feeCents > 0) {
        const treasury = await tx.user.findUnique({
          where: { handle: TREASURY_HANDLE },
          select: { id: true },
        });
        if (!treasury) {
          throw new AppError(ErrorCode.INTERNAL, '平台金库账号缺失，无法结算手续费');
        }
        const creditedTreasury = await tx.user.update({
          where: { id: treasury.id },
          data: { balanceCents: { increment: feeCents } },
          select: { balanceCents: true },
        });
        rows.push({
          userId: treasury.id,
          amountCents: feeCents,
          balanceAfterCents: creditedTreasury.balanceCents,
          kind: 'fee',
          refType: 'task',
          refId: taskId,
          groupId,
          idempotencyKey: `task:fee:${taskId}`,
          memo: `委托手续费 5%（任务 ${taskId.slice(0, 8)}）`,
        });
      }
      await tx.ledgerEntry.createMany({ data: rows });

      await tx.escrow.update({
        where: { taskId },
        data: { state: 'released', settledAt: new Date() },
      });
      return { takerId: task.takerId, payout: { grossCents, feeCents, netCents } };
    });

    // EXP 是旁路奖励：失败只 warn，不回滚已完成的打款。
    await this.awardQuietly(takerId, taskId);
    const me = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { balanceCents: true },
    });
    return {
      task: await this.taskFor(actor.id, taskId),
      payout,
      myBalanceCents: me?.balanceCents ?? 0,
    };
  }

  // ───────────────────────────── 取消 / 退款 ─────────────────────────────

  async cancel(actor: AuthUser, taskId: string): Promise<{ task: TaskCard }> {
    try {
      await this.prisma.withTransaction(async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
          select: { id: true, creatorId: true, status: true },
        });
        if (!task) throw notFound(taskId);
        if (task.creatorId !== actor.id) {
          throw new AppError(ErrorCode.FORBIDDEN, '只有委托人可以取消委托');
        }
        if (task.status !== 'open' && task.status !== 'in_progress') {
          throw conflict('委托当前不可取消');
        }
        const closed = await tx.task.updateMany({
          where: { id: taskId, status: { in: ['open', 'in_progress'] } },
          data: { status: 'cancelled' },
        });
        if (closed.count === 0) throw conflict('委托当前不可取消');

        const escrow = await tx.escrow.findUnique({
          where: { taskId },
          select: { amountCents: true, state: true },
        });
        if (escrow && escrow.state === 'held') {
          const refunded = await tx.user.update({
            where: { id: task.creatorId },
            data: { balanceCents: { increment: escrow.amountCents } },
            select: { balanceCents: true },
          });
          await tx.ledgerEntry.create({
            data: {
              userId: task.creatorId,
              amountCents: escrow.amountCents,
              balanceAfterCents: refunded.balanceCents,
              kind: 'task_refund',
              refType: 'task',
              refId: taskId,
              groupId: randomUUID(),
              idempotencyKey: `task:refund:${taskId}`,
              memo: '解冻委托资金',
            },
          });
          await tx.escrow.update({
            where: { taskId },
            data: { state: 'refunded', settledAt: new Date() },
          });
        }
      });
      return { task: await this.taskFor(actor.id, taskId) };
    } catch (error) {
      if (PrismaService.isUniqueViolation(error)) throw conflict('该委托已退款');
      throw error;
    }
  }

  // ───────────────────────────── 卡片组装 ─────────────────────────────

  private async taskFor(viewerId: string, taskId: string): Promise<TaskCard> {
    const row = await this.requireTaskRow(taskId);
    const mine = await this.myApplicationMap(viewerId, [taskId]);
    return this.cardOf(row, viewerId, mine.get(taskId) ?? null);
  }

  private async requireTaskRow(taskId: string): Promise<TaskRow> {
    const row = await this.prisma.task.findUnique({ where: { id: taskId }, select: TASK_SELECT });
    if (!row) throw notFound(taskId);
    return row;
  }

  private async cardOf(
    row: TaskRow,
    viewerId: string,
    myApplicationStatus: string | null,
  ): Promise<TaskCard> {
    const prefixes = await this.prefixMap([row.creator, row.taker]);
    return this.buildCard(row, viewerId, myApplicationStatus, prefixes);
  }

  private async toCards(
    rows: readonly TaskRow[],
    viewerId: string,
    mine: Map<string, string>,
  ): Promise<TaskCard[]> {
    const prefixes = await this.prefixMap(rows.flatMap((row) => prefixUsers(row)));
    return rows.map((row) => this.buildCard(row, viewerId, mine.get(row.id) ?? null, prefixes));
  }

  private buildCard(
    row: TaskRow,
    viewerId: string,
    myApplicationStatus: string | null,
    prefixes: Record<string, string[]>,
  ): TaskCard {
    const feeCents = row.escrow?.feeCents ?? taskFee(row.priceCents);
    const netCents = taskNet(row.escrow?.amountCents ?? row.priceCents, feeCents);
    const isCreator = row.creatorId === viewerId;
    const isTaker = row.takerId === viewerId;
    const myRole = isCreator ? 'creator' : isTaker ? 'taker' : 'visitor';

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      priceCents: row.priceCents,
      feeCents,
      netCents,
      deadline: row.deadline ? row.deadline.toISOString() : null,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      creator: this.buildUser(row.creator, prefixes),
      taker: row.taker ? this.buildUser(row.taker, prefixes) : null,
      myRole,
      applicationCount: row._count.applications,
      myApplicationStatus,
      escrow: row.escrow
        ? {
            state: row.escrow.state,
            amountCents: row.escrow.amountCents,
            feeCents: row.escrow.feeCents,
          }
        : null,
      canApply:
        row.status === 'open' && !isCreator && myApplicationStatus === null,
      canSelect: isCreator && row.status === 'open' && row.escrow === null,
      canSubmit: isTaker && row.status === 'in_progress',
      canAccept: isCreator && row.status === 'submitted',
      canCancel: isCreator && (row.status === 'open' || row.status === 'in_progress'),
      canEdit: isCreator && row.status === 'open',
    };
  }

  private buildApplication(
    row: ApplicationRow,
    prefixes: Record<string, string[]>,
  ): TaskApplicationCard {
    return {
      id: row.id,
      message: row.message,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      applicant: this.buildUser(row.applicant, prefixes),
    };
  }

  private buildUser(user: UserRow, prefixes: Record<string, string[]>): TaskUserCard {
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      avatarFileId: user.avatarFileId,
      prefixes: prefixes[user.id] ?? [],
    };
  }

  private async prefixMap(
    users: ReadonlyArray<UserRow | null | undefined>,
  ): Promise<Record<string, string[]>> {
    const unique = new Map<string, UserRow>();
    for (const user of users) {
      if (user) unique.set(user.id, user);
    }
    const rows = [...unique.values()];
    if (rows.length === 0) return {};
    return this.identity.prefixesForMany(rows);
  }

  private async myApplicationMap(
    viewerId: string,
    taskIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.prisma.taskApplication.findMany({
      where: { applicantId: viewerId, taskId: { in: [...taskIds] } },
      select: { taskId: true, status: true },
    });
    return new Map(rows.map((row) => [row.taskId, row.status as string]));
  }

  private async awardQuietly(takerId: string, taskId: string): Promise<void> {
    try {
      await this.exp.award(takerId, 'task_done', {
        refType: 'task',
        refId: taskId,
        idempotencyKey: `task:done:${taskId}`,
      });
    } catch (error) {
      this.logger.warn(`EXP 钩子失败（task_done/${taskId}）：${(error as Error).message}`);
    }
  }
}

function prefixUsers(row: TaskRow): Array<UserRow | null> {
  return row.taker ? [row.creator, row.taker] : [row.creator];
}
