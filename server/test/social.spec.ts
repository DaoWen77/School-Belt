import { describe, expect, it } from 'vitest';
import {
  CLERK_DOUBLE_PENALTY,
  EXP_REWARDS,
  LEVELS,
  MAX_LEVEL,
  VIOLATION_PENALTY,
  levelLabel,
  levelOf,
  progressOf,
} from '../src/social/level';
import { MAJORITY_MIN_VOTES, clerkEligibility, majorityOf } from '../src/moderation/majority';

describe('EXP 等级（模块二）', () => {
  it('阈值表：Lv0 0 / Lv1 20 / Lv2 60 / Lv3 140 / Lv4 300 / Lv5 600 / Lv6 1000', () => {
    expect([...LEVELS]).toEqual([0, 20, 60, 140, 300, 600, 1000]);
    expect(MAX_LEVEL).toBe(6);
  });

  it('levelOf 边界：阈值上取整，封顶 Lv6', () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(19)).toBe(0);
    expect(levelOf(20)).toBe(1);
    expect(levelOf(59)).toBe(1);
    expect(levelOf(60)).toBe(2);
    expect(levelOf(139)).toBe(2);
    expect(levelOf(140)).toBe(3);
    expect(levelOf(299)).toBe(3);
    expect(levelOf(300)).toBe(4);
    expect(levelOf(599)).toBe(4);
    expect(levelOf(600)).toBe(5);
    expect(levelOf(999)).toBe(5);
    expect(levelOf(1000)).toBe(6);
    expect(levelOf(999_999)).toBe(6);
    // 脏数据：负数与 NaN 一律 Lv0
    expect(levelOf(-5)).toBe(0);
    expect(levelOf(Number.NaN)).toBe(0);
  });

  it('levelLabel 夹在 0..6', () => {
    expect(levelLabel(0)).toBe('Lv0');
    expect(levelLabel(4)).toBe('Lv4');
    expect(levelLabel(6)).toBe('Lv6');
    expect(levelLabel(42)).toBe('Lv6');
  });

  it('progressOf：Lv1 内部进度与下一阈值', () => {
    expect(progressOf(25)).toEqual({
      level: 1,
      levelLabel: 'Lv1',
      expIntoLevel: 5,
      expForNextLevel: 40,
      nextLevelAt: 60,
    });
    expect(progressOf(0)).toEqual({
      level: 0,
      levelLabel: 'Lv0',
      expIntoLevel: 0,
      expForNextLevel: 20,
      nextLevelAt: 20,
    });
  });

  it('progressOf：封顶后 nextLevelAt 为 null、差距为 0', () => {
    const capped = progressOf(1234);
    expect(capped.level).toBe(6);
    expect(capped.expIntoLevel).toBe(234);
    expect(capped.expForNextLevel).toBe(0);
    expect(capped.nextLevelAt).toBeNull();
  });

  it('奖励与罚分常量', () => {
    expect(EXP_REWARDS).toEqual({
      daily_login: 1,
      post: 5,
      comment: 2,
      like_received: 1,
      task_done: 10,
    });
    expect(VIOLATION_PENALTY).toBe(-20);
    expect(CLERK_DOUBLE_PENALTY).toBe(-40);
  });
});

describe('众包投票多数决（模块二）', () => {
  it('总票不足 3 不结案', () => {
    expect(MAJORITY_MIN_VOTES).toBe(3);
    expect(majorityOf({ violation: 1, clear: 0 })).toBe('pending');
    expect(majorityOf({ violation: 1, clear: 1 })).toBe('pending');
    expect(majorityOf({ violation: 2, clear: 0 })).toBe('pending');
    expect(majorityOf({ violation: 0, clear: 0 })).toBe('pending');
  });

  it('2-1 违规 → violation', () => {
    expect(majorityOf({ violation: 2, clear: 1 })).toBe('violation');
  });

  it('1-2 无违规 → clear', () => {
    expect(majorityOf({ violation: 1, clear: 2 })).toBe('clear');
  });

  it('票数打平（2-2 / 3-3）→ clear，严格过半才算违规', () => {
    expect(majorityOf({ violation: 2, clear: 2 })).toBe('clear');
    expect(majorityOf({ violation: 3, clear: 3 })).toBe('clear');
    expect(majorityOf({ violation: 3, clear: 1 })).toBe('violation');
  });
});

describe('风纪委资格（模块二）', () => {
  it('Lv3 拒绝，并给出中文原因', () => {
    const result = clerkEligibility({ level: 3, violations30d: 0 });
    expect(result.levelOk).toBe(false);
    expect(result.canApply).toBe(false);
    expect(result.requiredLevel).toBe(4);
    expect(result.reasons.join()).toContain('等级不足');
  });

  it('Lv4 且 30 天无违规 → 通过，无原因', () => {
    const result = clerkEligibility({ level: 4, violations30d: 0 });
    expect(result.levelOk).toBe(true);
    expect(result.cleanOk).toBe(true);
    expect(result.canApply).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(clerkEligibility({ level: 6, violations30d: 0 }).canApply).toBe(true);
  });

  it('Lv4 但 30 天内有违规 → 拒绝', () => {
    const result = clerkEligibility({ level: 5, violations30d: 2 });
    expect(result.cleanOk).toBe(false);
    expect(result.canApply).toBe(false);
    expect(result.reasons.join()).toContain('2 条违规');
  });

  it('已有 pending 申请 → 拒绝', () => {
    const result = clerkEligibility({ level: 4, violations30d: 0, hasPending: true });
    expect(result.canApply).toBe(false);
    expect(result.reasons.join()).toContain('待审');
  });

  it('脏数据不炸：负数违规数按 0 处理', () => {
    const result = clerkEligibility({ level: 4, violations30d: -3 });
    expect(result.violations30d).toBe(0);
    expect(result.canApply).toBe(true);
  });
});
