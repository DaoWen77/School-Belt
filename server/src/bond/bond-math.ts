/**
 * 羁绊火花结算算术（纯函数，不碰 DB、不依赖运行时时钟）。
 *
 * 所有「日」都是 Asia/Shanghai 日历日，用字符串 `YYYY-MM-DD` 表示，
 * 与数据库 `@db.Date`（UTC 00:00）一一对应，避免时区漂移。
 *
 * 规则（PRD 模块三）：
 * - 双方当天都续 → +5；仅一方续 → -10；都没续 → -20；
 * - 亲密度 clamp 到 0..100；归零即 end（endReason='亲密度归零'）；
 * - 接受日不考核，从次日开始；只结算到「昨天」，今天留待明天。
 */

export const BOND_INTIMACY_INITIAL = 10;
export const BOND_INTIMACY_MAX = 100;
export const BOND_BOTH_RENEW_DELTA = 5;
export const BOND_ONE_RENEW_DELTA = -10;
export const BOND_NONE_RENEW_DELTA = -20;
export const BOND_END_REASON_ZERO = '亲密度归零';

/** 单日增量：双续 +5 / 单续 -10 / 都断 -20 */
export function bondDayDelta(renewedA: boolean, renewedB: boolean): number {
  if (renewedA && renewedB) return BOND_BOTH_RENEW_DELTA;
  if (renewedA || renewedB) return BOND_ONE_RENEW_DELTA;
  return BOND_NONE_RENEW_DELTA;
}

/** 亲密度夹在 0..100（脏数据按 0 处理） */
export function clampIntimacy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(BOND_INTIMACY_MAX, Math.max(0, Math.trunc(value)));
}

/** 上海时区的日历日 `YYYY-MM-DD` */
export function shanghaiDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

/** `YYYY-MM-DD` 加减天数（纯 UTC 运算，无夏令时） */
export function addDays(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const utc = Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + offset);
  return new Date(utc).toISOString().slice(0, 10);
}

export interface BondSettleInput {
  /** 当前亲密度 */
  intimacy: number;
  /** 接受邀请的上海日历日：当天不考核，从次日开始 */
  activeFrom: string;
  /** 已结算到的日历日（含）；null = 从未结算，从 activeFrom 次日起算 */
  lastSettledOn: string | null;
  /** 今日（上海日历日）：只结算到昨天 */
  today: string;
  /** A 侧续过的日期 */
  renewedAOn?: readonly string[];
  /** B 侧续过的日期 */
  renewedBOn?: readonly string[];
}

export interface SettledDay {
  day: string;
  renewedA: boolean;
  renewedB: boolean;
  delta: number;
  intimacy: number;
  ended: boolean;
}

export interface BondSettleResult {
  intimacy: number;
  ended: boolean;
  /** 结算完毕后应写回的 lastSettledOn（未结算时原样返回） */
  settledThrough: string | null;
  /** 逐日明细，按时间升序；归零那天是最后一条 */
  days: SettledDay[];
}

/** 结算 [lastSettledOn+1 .. yesterday] 每一天；归零即停 */
export function settleBond(input: BondSettleInput): BondSettleResult {
  const renewedA = new Set(input.renewedAOn ?? []);
  const renewedB = new Set(input.renewedBOn ?? []);
  const yesterday = addDays(input.today, -1);
  let cursor = addDays(input.lastSettledOn ?? input.activeFrom, 1);
  let intimacy = clampIntimacy(input.intimacy);
  let settledThrough = input.lastSettledOn;
  const days: SettledDay[] = [];

  while (cursor <= yesterday) {
    const a = renewedA.has(cursor);
    const b = renewedB.has(cursor);
    const delta = bondDayDelta(a, b);
    intimacy = clampIntimacy(intimacy + delta);
    const ended = intimacy === 0;
    days.push({ day: cursor, renewedA: a, renewedB: b, delta, intimacy, ended });
    settledThrough = cursor;
    if (ended) break;
    cursor = addDays(cursor, 1);
  }

  return { intimacy, ended: intimacy === 0, settledThrough, days };
}
