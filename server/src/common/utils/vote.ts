import { ErrorCode } from '../errors/error-codes';
import type { CardStatus } from '../types/enums';

/**
 * 投票校验（契约 §2.13 data 约定 / §7 /cards/:id/vote）：
 * - 单选（data.multi=false）必须恰好 1 个选项；
 * - 多选（data.multi=true）至少 1 个，去重后选项必须属于该卡；
 * - 已截止（closesAt <= now）或 state=closed → VOTE_CLOSED；
 * - 匿名单不落展示映射，聚合计数由 tallyBallots 完成。
 */

export interface VoteConfig {
  multi: boolean;
  anonymous: boolean;
  closesAt: string | null;
  quorum?: number;
}

export interface VoteConfigInput {
  multi?: boolean;
  anonymous?: boolean;
  closesAt?: string | null;
  quorum?: number;
}

export type VoteValidation =
  | { ok: true; optionIds: string[] }
  | { ok: false; code: ErrorCode; message: string };

/** 规范化 cards.data 中的投票配置，缺省为单选、实名、无截止 */
export function normalizeVoteConfig(raw: unknown): VoteConfig {
  const input = (raw ?? {}) as VoteConfigInput;
  return {
    multi: input.multi === true,
    anonymous: input.anonymous === true,
    closesAt: typeof input.closesAt === 'string' && input.closesAt.length > 0 ? input.closesAt : null,
    ...(typeof input.quorum === 'number' ? { quorum: input.quorum } : {}),
  };
}

/** 投票是否已截止：状态关闭或到达 closesAt */
export function isVoteClosed(
  config: VoteConfig,
  status: CardStatus,
  now: Date,
  cardClosedAt?: Date | null,
): boolean {
  if (status === 'closed' || status === 'archived') return true;
  if (cardClosedAt instanceof Date) return true;
  if (config.closesAt === null) return false;
  const closesAt = new Date(config.closesAt);
  if (Number.isNaN(closesAt.getTime())) return false;
  return closesAt.getTime() <= now.getTime();
}

export interface ValidateBallotInput {
  config: VoteConfig;
  optionIds: string[];
  /** 该卡片实际存在的选项 id */
  validOptionIds: readonly string[];
  cardStatus: CardStatus;
  now: Date;
  cardClosedAt?: Date | null;
}

export function validateBallot(input: ValidateBallotInput): VoteValidation {
  const { config, optionIds, validOptionIds, cardStatus, now, cardClosedAt } = input;

  if (isVoteClosed(config, cardStatus, now, cardClosedAt ?? null)) {
    return { ok: false, code: ErrorCode.VOTE_CLOSED, message: '投票已截止' };
  }
  if (!Array.isArray(optionIds) || optionIds.length === 0) {
    return { ok: false, code: ErrorCode.VALIDATION_FAILED, message: '至少选择一个选项' };
  }
  const unique = new Set(optionIds);
  if (unique.size !== optionIds.length) {
    return { ok: false, code: ErrorCode.VALIDATION_FAILED, message: '选项不可重复' };
  }
  if (!config.multi && unique.size !== 1) {
    return { ok: false, code: ErrorCode.VALIDATION_FAILED, message: '该投票为单选，只能选择一个选项' };
  }
  const valid = new Set(validOptionIds);
  for (const id of unique) {
    if (!valid.has(id)) {
      return { ok: false, code: ErrorCode.VALIDATION_FAILED, message: '存在不属于该投票的选项' };
    }
  }
  if (config.quorum !== undefined && config.quorum > 0 && unique.size > config.quorum) {
    return { ok: false, code: ErrorCode.VALIDATION_FAILED, message: `最多选择 ${config.quorum} 项` };
  }
  return { ok: true, optionIds: [...unique] };
}

/** 聚合计数：匿名投票同样只返回计数，不返回选民 */
export function tallyBallots(
  optionIds: readonly string[],
  ballots: readonly { optionId: string; userId?: string }[],
): { counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {};
  for (const id of optionIds) counts[id] = 0;
  for (const ballot of ballots) {
    if (counts[ballot.optionId] === undefined) continue;
    counts[ballot.optionId] = (counts[ballot.optionId] ?? 0) + 1;
  }
  return { counts, total: ballots.length };
}

/** 投票结果对外投影：匿名投票 voters 恒为空数组（契约 §6 vote:updated） */
export function projectVoteResult(
  config: VoteConfig,
  optionIds: readonly string[],
  ballots: readonly { optionId: string; userId: string }[],
): { counts: Record<string, number>; total: number; voters: string[] } {
  const { counts, total } = tallyBallots(optionIds, ballots);
  const voters = config.anonymous ? [] : [...new Set(ballots.map((b) => b.userId))];
  return { counts, total, voters };
}
