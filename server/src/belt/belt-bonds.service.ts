import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdentityService } from '../common/identity/identity.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import {
  BOND_END_REASON_ZERO,
  BOND_INTIMACY_INITIAL,
  addDays,
  settleBond,
  shanghaiDay,
} from '../bond/bond-math';
import type { BondTypeDto, InviteBondDto } from './belt.dto';

/** 羁绊类型中文短标签（卡片直接展示） */
export const BOND_TYPE_LABEL: Readonly<Record<BondTypeDto, string>> = {
  buddy: '死党',
  mentor: '大佬',
  partner: '搭档',
  pal: '搭子',
};

const BOND_END_REASON_ACTIVE = '主动解除';
const BOND_END_REASON_DECLINED = '邀请被拒绝';

export interface BondPeer {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  prefixes: string[];
}

export interface BondCard {
  id: string;
  type: BondTypeDto;
  typeLabel: string;
  status: 'pending' | 'active' | 'ended';
  intimacy: number;
  peer: BondPeer;
  invitedByMe: boolean;
  renewedToday: boolean;
  bothRenewedToday: boolean;
  createdAt: string;
  endedAt: string | null;
  endReason: string | null;
}

export interface BondLists {
  incoming: BondCard[];
  outgoing: BondCard[];
  active: BondCard[];
  ended: BondCard[];
}

const PEER_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  avatarFileId: true,
  tags: true,
  globalRole: true,
} satisfies Prisma.UserSelect;

const BOND_SELECT = {
  id: true,
  type: true,
  status: true,
  intimacy: true,
  userAId: true,
  userBId: true,
  inviterId: true,
  lastRenewA: true,
  lastRenewB: true,
  lastSettledOn: true,
  createdAt: true,
  endedAt: true,
  endReason: true,
  a: { select: PEER_SELECT },
  b: { select: PEER_SELECT },
} satisfies Prisma.BondSelect;

type BondRow = Prisma.BondGetPayload<{ select: typeof BOND_SELECT }>;
type PeerRow = Prisma.UserGetPayload<{ select: typeof PEER_SELECT }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 规范序：uuid 字符串升序，a < b（DB 唯一键依赖） */
function canonicalPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/** @db.Date 读回是 UTC 00:00，直接切日历日 */
function toDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * 羁绊（死党 / 大佬 / 搭档 / 搭子）。
 *
 * 亲密度采用**懒结算**：没有 cron，任何读路径（列表 / 接受 / 续火花）先把
 * [lastSettledOn+1 .. 昨天] 的每一天补齐，再读或写。算术全在 bond-math.ts。
 */
@Injectable()
export class BeltBondsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  /** 我的羁绊四分类；active 先补结算 */
  async list(actor: AuthUser): Promise<BondLists> {
    const today = shanghaiDay();
    const involved: Prisma.BondWhereInput = {
      OR: [{ userAId: actor.id }, { userBId: actor.id }],
    };

    return this.prisma.withTransaction(async (tx) => {
      await this.settleAll(tx, actor.id, today);
      const rows = await tx.bond.findMany({
        where: { ...involved, status: { not: 'ended' } },
        orderBy: { createdAt: 'desc' },
        select: BOND_SELECT,
      });
      const endedRows = await tx.bond.findMany({
        where: { ...involved, status: 'ended' },
        orderBy: [{ endedAt: 'desc' }, { createdAt: 'desc' }],
        take: 5,
        select: BOND_SELECT,
      });

      const cards = await this.toCards([...rows, ...endedRows], actor.id, today);
      const open = cards.slice(0, rows.length);
      const ended = cards.slice(rows.length);
      const pending = open.filter((card) => card.status === 'pending');
      return {
        incoming: pending.filter((card) => !card.invitedByMe),
        outgoing: pending.filter((card) => card.invitedByMe),
        active: open.filter((card) => card.status === 'active'),
        ended,
      };
    });
  }

  /** 发起羁绊邀请（呼号定位对方） */
  async invite(actor: AuthUser, dto: InviteBondDto): Promise<{ bond: BondCard }> {
    const target = await this.prisma.user.findUnique({
      where: { handle: dto.handle },
      select: { id: true },
    });
    if (!target) throw new AppError(ErrorCode.USER_NOT_FOUND, '呼号不存在');
    if (target.id === actor.id) throw new AppError(ErrorCode.VALIDATION_FAILED, '不能对自己发起羁绊');

    const [userAId, userBId] = canonicalPair(actor.id, target.id);
    const today = shanghaiDay();
    try {
      const bond = await this.prisma.withTransaction(async (tx) => {
        const existing = await tx.bond.findFirst({
          where: { userAId, userBId, type: dto.type },
          select: { id: true, status: true },
        });
        if (existing && existing.status !== 'ended') throw new AppError(ErrorCode.BOND_CONFLICT);
        // 唯一键 (a,b,type) 覆盖 ended：重建前先清掉旧记录，历史不参与判定
        if (existing) await tx.bond.delete({ where: { id: existing.id } });
        return tx.bond.create({
          data: { type: dto.type, status: 'pending', userAId, userBId, inviterId: actor.id },
          select: BOND_SELECT,
        });
      });
      return { bond: await this.toCard(bond, actor.id, today) };
    } catch (error) {
      if (PrismaService.isUniqueViolation(error)) throw new AppError(ErrorCode.BOND_CONFLICT);
      throw error;
    }
  }

  /** 接受邀请：从接受日起算（当天不考核，次日起结算） */
  async accept(actor: AuthUser, id: string): Promise<{ bond: BondCard }> {
    const today = shanghaiDay();
    const bond = await this.prisma.withTransaction(async (tx) => {
      const row = await this.load(tx, id, actor.id);
      if (row.status !== 'pending') throw new AppError(ErrorCode.BOND_CONFLICT, '该羁绊已不是待接受状态');
      if (row.inviterId === actor.id) throw new AppError(ErrorCode.FORBIDDEN, '只有被邀请人可以接受');
      // 读路径顺带把我其余 active 羁绊也补结算（接受到今天为止）
      await this.settleAll(tx, actor.id, today);
      return tx.bond.update({
        where: { id: row.id },
        data: {
          status: 'active',
          intimacy: BOND_INTIMACY_INITIAL,
          lastRenewA: null,
          lastRenewB: null,
          lastSettledOn: toDate(today),
          endedAt: null,
          endReason: null,
        },
        select: BOND_SELECT,
      });
    });
    return { bond: await this.toCard(bond, actor.id, today) };
  }

  /** 拒绝邀请：仅被邀请人，pending → ended */
  async decline(actor: AuthUser, id: string): Promise<{ bond: BondCard }> {
    const today = shanghaiDay();
    const bond = await this.prisma.withTransaction(async (tx) => {
      const row = await this.load(tx, id, actor.id);
      if (row.status !== 'pending') throw new AppError(ErrorCode.BOND_CONFLICT, '该羁绊已不是待接受状态');
      if (row.inviterId === actor.id) throw new AppError(ErrorCode.FORBIDDEN, '只有被邀请人可以拒绝');
      return tx.bond.update({
        where: { id: row.id },
        data: { status: 'ended', endedAt: new Date(), endReason: BOND_END_REASON_DECLINED },
        select: BOND_SELECT,
      });
    });
    return { bond: await this.toCard(bond, actor.id, today) };
  }

  /** 续火花：先补结算到昨天，再记今天（同日重复幂等） */
  async renew(
    actor: AuthUser,
    id: string,
  ): Promise<{ bond: BondCard; renewedToday: true; bothRenewed: boolean }> {
    const today = shanghaiDay();
    const bond = await this.prisma.withTransaction(async (tx) => {
      const row = await this.load(tx, id, actor.id);
      if (row.status !== 'active') throw new AppError(ErrorCode.BOND_CONFLICT, '只有生效中的羁绊可以续火花');

      const settled = await this.settleRow(tx, row, today);
      if (settled.ended) throw new AppError(ErrorCode.BOND_CONFLICT, '亲密度归零，羁绊已结束');

      const renewData =
        actor.id === row.userAId ? { lastRenewA: toDate(today) } : { lastRenewB: toDate(today) };
      return tx.bond.update({ where: { id: row.id }, data: renewData, select: BOND_SELECT });
    });
    const card = await this.toCard(bond, actor.id, today);
    return { bond: card, renewedToday: true, bothRenewed: card.bothRenewedToday };
  }

  /** 解除羁绊：双方任一方可解 */
  async end(actor: AuthUser, id: string): Promise<{ bond: BondCard }> {
    const today = shanghaiDay();
    const bond = await this.prisma.withTransaction(async (tx) => {
      const row = await this.load(tx, id, actor.id);
      if (row.status === 'ended') throw new AppError(ErrorCode.BOND_CONFLICT, '羁绊已结束');
      return tx.bond.update({
        where: { id: row.id },
        data: { status: 'ended', endedAt: new Date(), endReason: BOND_END_REASON_ACTIVE },
        select: BOND_SELECT,
      });
    });
    return { bond: await this.toCard(bond, actor.id, today) };
  }

  // ───────────────────────────── 懒结算 ─────────────────────────────

  /** 补结算我与某人的全部 active 羁绊 */
  private async settleAll(
    tx: Prisma.TransactionClient,
    userId: string,
    today: string,
  ): Promise<void> {
    const rows = await tx.bond.findMany({
      where: { status: 'active', OR: [{ userAId: userId }, { userBId: userId }] },
      select: BOND_SELECT,
    });
    for (const row of rows) await this.settleRow(tx, row, today);
  }

  /**
   * 结一条：结算 [lastSettledOn+1 .. 昨天]；
   * 归零即 ended（endReason=亲密度归零）并停在其发生那天。
   */
  private async settleRow(
    tx: Prisma.TransactionClient,
    row: BondRow,
    today: string,
  ): Promise<{ ended: boolean; intimacy: number }> {
    const lastSettledOn = toDay(row.lastSettledOn);
    if (lastSettledOn && lastSettledOn >= addDays(today, -1)) {
      return { ended: row.status === 'ended', intimacy: row.intimacy };
    }

    const renewedA = toDay(row.lastRenewA);
    const renewedB = toDay(row.lastRenewB);
    const result = settleBond({
      intimacy: row.intimacy,
      activeFrom: toDay(row.createdAt) ?? today,
      lastSettledOn,
      today,
      renewedAOn: renewedA ? [renewedA] : [],
      renewedBOn: renewedB ? [renewedB] : [],
    });
    if (result.days.length === 0 || !result.settledThrough) {
      return { ended: false, intimacy: result.intimacy };
    }

    await tx.bond.update({
      where: { id: row.id },
      data: result.ended
        ? {
            intimacy: result.intimacy,
            lastSettledOn: toDate(result.settledThrough),
            status: 'ended',
            endedAt: new Date(),
            endReason: BOND_END_REASON_ZERO,
          }
        : { intimacy: result.intimacy, lastSettledOn: toDate(result.settledThrough) },
    });
    return { ended: result.ended, intimacy: result.intimacy };
  }

  // ───────────────────────────── 视图 ─────────────────────────────

  private async load(
    tx: Prisma.TransactionClient,
    id: string,
    viewerId: string,
  ): Promise<BondRow> {
    if (!UUID_RE.test(id)) throw new AppError(ErrorCode.BOND_NOT_FOUND);
    const row = await tx.bond.findUnique({ where: { id }, select: BOND_SELECT });
    if (!row || (row.userAId !== viewerId && row.userBId !== viewerId)) {
      throw new AppError(ErrorCode.BOND_NOT_FOUND);
    }
    return row;
  }

  private peerOf(row: BondRow, viewerId: string): PeerRow {
    return row.userAId === viewerId ? row.b : row.a;
  }

  private async toCard(row: BondRow, viewerId: string, today: string): Promise<BondCard> {
    const peer = this.peerOf(row, viewerId);
    const prefixes = await this.identity.prefixesForMany([peer]);
    return this.buildCard(row, viewerId, today, prefixes[peer.id] ?? []);
  }

  private async toCards(
    rows: readonly BondRow[],
    viewerId: string,
    today: string,
  ): Promise<BondCard[]> {
    const unique = new Map<string, PeerRow>();
    for (const row of rows) {
      const peer = this.peerOf(row, viewerId);
      if (!unique.has(peer.id)) unique.set(peer.id, peer);
    }
    const prefixes = await this.identity.prefixesForMany([...unique.values()]);

    return rows.map((row) => {
      const peer = this.peerOf(row, viewerId);
      return this.buildCard(row, viewerId, today, prefixes[peer.id] ?? []);
    });
  }

  private buildCard(
    row: BondRow,
    viewerId: string,
    today: string,
    peerPrefixes: string[],
  ): BondCard {
    const peer = this.peerOf(row, viewerId);
    const myRenew = toDay(row.userAId === viewerId ? row.lastRenewA : row.lastRenewB);
    const peerRenew = toDay(row.userAId === viewerId ? row.lastRenewB : row.lastRenewA);
    return {
      id: row.id,
      type: row.type,
      typeLabel: BOND_TYPE_LABEL[row.type],
      status: row.status,
      intimacy: row.intimacy,
      peer: {
        id: peer.id,
        handle: peer.handle,
        displayName: peer.displayName,
        avatarFileId: peer.avatarFileId,
        prefixes: peerPrefixes,
      },
      invitedByMe: row.inviterId === viewerId,
      renewedToday: myRenew === today,
      bothRenewedToday: myRenew === today && peerRenew === today,
      createdAt: row.createdAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      endReason: row.endReason,
    };
  }
}
