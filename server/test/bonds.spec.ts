import { describe, expect, it } from 'vitest';
import {
  BOND_BOTH_RENEW_DELTA,
  BOND_INTIMACY_INITIAL,
  BOND_INTIMACY_MAX,
  BOND_END_REASON_ZERO,
  addDays,
  bondDayDelta,
  clampIntimacy,
  settleBond,
  shanghaiDay,
} from '../src/bond/bond-math';

/** 结算辅助：接受日 2026-10-01，已结算到接受日 */
function settle(
  intimacy: number,
  today: string,
  opts: { renewedAOn?: string[]; renewedBOn?: string[]; lastSettledOn?: string | null } = {},
) {
  return settleBond({
    intimacy,
    activeFrom: '2026-10-01',
    lastSettledOn: opts.lastSettledOn === undefined ? '2026-10-01' : opts.lastSettledOn,
    today,
    renewedAOn: opts.renewedAOn ?? [],
    renewedBOn: opts.renewedBOn ?? [],
  });
}

describe('羁绊日增量（模块三）', () => {
  it('双续 +5 / 单续 -10 / 都断 -20', () => {
    expect(bondDayDelta(true, true)).toBe(BOND_BOTH_RENEW_DELTA);
    expect(bondDayDelta(true, true)).toBe(5);
    expect(bondDayDelta(true, false)).toBe(-10);
    expect(bondDayDelta(false, true)).toBe(-10);
    expect(bondDayDelta(false, false)).toBe(-20);
  });

  it('clampIntimacy 夹在 0..100，脏数据归 0', () => {
    expect(clampIntimacy(150)).toBe(BOND_INTIMACY_MAX);
    expect(clampIntimacy(-5)).toBe(0);
    expect(clampIntimacy(Number.NaN)).toBe(0);
    expect(clampIntimacy(37)).toBe(37);
  });

  it('初始亲密度 10', () => {
    expect(BOND_INTIMACY_INITIAL).toBe(10);
  });
});

describe('羁绊懒结算', () => {
  it('双方每天都续：每日 +5，封顶 100', () => {
    const result = settle(10, '2026-10-04', {
      renewedAOn: ['2026-10-02', '2026-10-03'],
      renewedBOn: ['2026-10-02', '2026-10-03'],
    });
    expect(result.intimacy).toBe(20);
    expect(result.ended).toBe(false);
    expect(result.settledThrough).toBe('2026-10-03');
    expect(result.days.map((day) => day.delta)).toEqual([5, 5]);
    expect(result.days.every((day) => day.renewedA && day.renewedB)).toBe(true);

    const capped = settle(95, '2026-10-04', {
      renewedAOn: ['2026-10-02', '2026-10-03'],
      renewedBOn: ['2026-10-02', '2026-10-03'],
    });
    expect(capped.intimacy).toBe(100);
    expect(capped.days.map((day) => day.intimacy)).toEqual([100, 100]);
  });

  it('仅一方续：每日 -10', () => {
    const result = settle(50, '2026-10-03', { renewedAOn: ['2026-10-02'] });
    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toMatchObject({ day: '2026-10-02', renewedA: true, renewedB: false, delta: -10 });
    expect(result.intimacy).toBe(40);
    expect(result.ended).toBe(false);
  });

  it('都没续：每日 -20', () => {
    const result = settle(50, '2026-10-03');
    expect(result.days).toHaveLength(1);
    expect(result.days[0].delta).toBe(-20);
    expect(result.intimacy).toBe(30);
  });

  it('亲密度归零：立刻 ended 并停止后续天数', () => {
    const oneDay = settle(10, '2026-10-03');
    expect(oneDay.intimacy).toBe(0);
    expect(oneDay.ended).toBe(true);
    expect(oneDay.days).toHaveLength(1);
    expect(oneDay.days[0].ended).toBe(true);

    // 第 2 天归零：第 3 天不再计算
    const multi = settle(30, '2026-10-06');
    expect(multi.days).toHaveLength(2);
    expect(multi.intimacy).toBe(0);
    expect(multi.ended).toBe(true);
    expect(multi.settledThrough).toBe('2026-10-03');
    expect(BOND_END_REASON_ZERO).toBe('亲密度归零');
  });

  it('跨多天连续结算：双续与断签混合', () => {
    const result = settle(60, '2026-10-06', {
      renewedAOn: ['2026-10-02', '2026-10-03'],
      renewedBOn: ['2026-10-02', '2026-10-03'],
    });
    expect(result.days.map((day) => day.day)).toEqual([
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
    expect(result.days.map((day) => day.delta)).toEqual([5, 5, -20, -20]);
    expect(result.days.map((day) => day.intimacy)).toEqual([65, 70, 50, 30]);
    expect(result.intimacy).toBe(30);
    expect(result.settledThrough).toBe('2026-10-05');
  });

  it('接受日不计：当天与次日都不产生结算', () => {
    const sameDay = settle(10, '2026-10-01');
    expect(sameDay.days).toEqual([]);
    expect(sameDay.intimacy).toBe(10);
    expect(sameDay.settledThrough).toBe('2026-10-01');

    // 今天=次日，只结算到昨天=接受日，仍不计
    const nextDay = settle(10, '2026-10-02');
    expect(nextDay.days).toEqual([]);
    expect(nextDay.intimacy).toBe(10);

    // 第三天才开始考核
    const thirdDay = settle(10, '2026-10-03');
    expect(thirdDay.days.map((day) => day.day)).toEqual(['2026-10-02']);
  });

  it('lastSettledOn 为空时从接受日次日起算', () => {
    const result = settle(10, '2026-10-03', { lastSettledOn: null });
    expect(result.days.map((day) => day.day)).toEqual(['2026-10-02']);
    // 10 - 20 归零
    expect(result.intimacy).toBe(0);
    expect(result.ended).toBe(true);
  });

  it('addDays / shanghaiDay 按 Asia/Shanghai 日切', () => {
    expect(addDays('2026-10-01', 1)).toBe('2026-10-02');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // 23:59:59 CST 仍是同日；次日 00:00:00 CST 才翻篇
    expect(shanghaiDay(new Date('2026-10-01T15:59:59Z'))).toBe('2026-10-01');
    expect(shanghaiDay(new Date('2026-10-01T16:00:00Z'))).toBe('2026-10-02');
  });
});
