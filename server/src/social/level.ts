/**
 * EXP 等级（模块二）：阈值表与纯函数，无 IO，供单测与 service 共用。
 * 阈值口径：Lv0 0 / Lv1 20 / Lv2 60 / Lv3 140 / Lv4 300 / Lv5 600 / Lv6 1000，封顶 Lv6。
 */
export const LEVELS = [0, 20, 60, 140, 300, 600, 1000] as const;

/** 封顶等级 = 6 */
export const MAX_LEVEL = LEVELS.length - 1;

/** 行为奖励（EXP） */
export const EXP_REWARDS = {
  daily_login: 1,
  post: 5,
  comment: 2,
  like_received: 1,
  task_done: 10,
} as const;

export type RewardReason = keyof typeof EXP_REWARDS;
export type ExpReasonName = RewardReason | 'admin';

/** 违规扣分：普通 -20，风纪委双倍 -40（只扣 EXP，流水保留） */
export const VIOLATION_PENALTY = -20;
export const CLERK_DOUBLE_PENALTY = -40;

/** 风纪委门槛：Lv4 且 30 天内无违规 */
export const CLERK_REQUIRED_LEVEL = 4;
export const CLERK_CLEAN_DAYS = 30;

export function levelOf(exp: number): number {
  if (!Number.isFinite(exp) || exp < LEVELS[1]!) return 0;
  let level = 0;
  for (let index = 1; index < LEVELS.length; index += 1) {
    if (exp >= LEVELS[index]!) level = index;
  }
  return level;
}

export function levelLabel(level: number): string {
  const safe = Number.isFinite(level) ? Math.max(0, Math.min(Math.floor(level), MAX_LEVEL)) : 0;
  return `Lv${safe}`;
}

export interface LevelProgress {
  level: number;
  levelLabel: string;
  /** 当前等级内已积累的 EXP */
  expIntoLevel: number;
  /** 升到下一级还差多少；封顶时为 0 */
  expForNextLevel: number;
  /** 下一级阈值；封顶时为 null */
  nextLevelAt: number | null;
}

export function progressOf(exp: number): LevelProgress {
  const safe = Number.isFinite(exp) && exp > 0 ? Math.floor(exp) : 0;
  const level = levelOf(safe);
  const floor = LEVELS[level]!;
  const next = LEVELS[level + 1];
  if (next === undefined) {
    return {
      level,
      levelLabel: levelLabel(level),
      expIntoLevel: safe - floor,
      expForNextLevel: 0,
      nextLevelAt: null,
    };
  }
  return {
    level,
    levelLabel: levelLabel(level),
    expIntoLevel: safe - floor,
    expForNextLevel: next - floor,
    nextLevelAt: next,
  };
}
