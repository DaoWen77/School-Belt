import { CLERK_CLEAN_DAYS, CLERK_REQUIRED_LEVEL } from '../social/level';

/**
 * 众包投票多数决（模块二）。
 * 规则：总票 ≥ 3 即结案；violation 票严格超过总票一半 → violation，否则 clear。
 */
export const MAJORITY_MIN_VOTES = 3;

export interface VerdictTally {
  violation: number;
  clear: number;
}

/** pending = 票数不够，工单继续开放 */
export type ReportOutcome = 'pending' | 'violation' | 'clear';

export function majorityOf(tally: VerdictTally): ReportOutcome {
  const violation = Math.max(0, Math.trunc(tally.violation));
  const clear = Math.max(0, Math.trunc(tally.clear));
  const total = violation + clear;
  if (total < MAJORITY_MIN_VOTES) return 'pending';
  return violation > total / 2 ? 'violation' : 'clear';
}

export interface ClerkEligibilityInput {
  level: number;
  /** 过去 30 天作为被举报人且已判违规的工单数 */
  violations30d: number;
  /** 是否已有 pending 申请 */
  hasPending?: boolean;
}

export interface ClerkEligibility {
  level: number;
  requiredLevel: number;
  levelOk: boolean;
  violations30d: number;
  cleanOk: boolean;
  canApply: boolean;
  /** 给前端直接展示的中文原因 */
  reasons: string[];
}

/** 风纪委资格：Lv4 + 30 天无违规 + 没有待审申请 */
export function clerkEligibility(input: ClerkEligibilityInput): ClerkEligibility {
  const level = Number.isFinite(input.level) ? Math.max(0, Math.trunc(input.level)) : 0;
  const violations30d = Number.isFinite(input.violations30d)
    ? Math.max(0, Math.trunc(input.violations30d))
    : 0;
  const levelOk = level >= CLERK_REQUIRED_LEVEL;
  const cleanOk = violations30d === 0;
  const reasons: string[] = [];
  if (!levelOk) reasons.push(`等级不足：需 Lv${CLERK_REQUIRED_LEVEL}，当前 Lv${level}`);
  if (!cleanOk) reasons.push(`最近 ${CLERK_CLEAN_DAYS} 天有 ${violations30d} 条违规记录`);
  if (input.hasPending) reasons.push('你已有一份待审的风纪委申请');
  return {
    level,
    requiredLevel: CLERK_REQUIRED_LEVEL,
    levelOk,
    violations30d,
    cleanOk,
    canApply: levelOk && cleanOk && !input.hasPending,
    reasons,
  };
}
