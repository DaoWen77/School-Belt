import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/common/errors/error-codes';
import {
  isVoteClosed,
  normalizeVoteConfig,
  projectVoteResult,
  tallyBallots,
  validateBallot,
} from '../src/common/utils/vote';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const OPTIONS = ['opt-a', 'opt-b', 'opt-c'];

const single = normalizeVoteConfig({ multi: false, anonymous: false, closesAt: null });
const multi = normalizeVoteConfig({ multi: true, anonymous: false, closesAt: null });

function validate(
  config: typeof single,
  optionIds: string[],
  overrides: Partial<Parameters<typeof validateBallot>[0]> = {},
) {
  return validateBallot({
    config,
    optionIds,
    validOptionIds: OPTIONS,
    cardStatus: 'open',
    now: NOW,
    ...overrides,
  });
}

describe('投票校验（契约 §7 /cards/:id/vote）', () => {
  it('单选只允许 1 个选项', () => {
    expect(validate(single, ['opt-a']).ok).toBe(true);
    const result = validate(single, ['opt-a', 'opt-b']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('多选允许 2+ 个选项，并保持去重后的结果', () => {
    const result = validate(multi, ['opt-a', 'opt-b']);
    expect(result).toEqual({ ok: true, optionIds: ['opt-a', 'opt-b'] });
  });

  it('重复选项直接拒绝', () => {
    const result = validate(multi, ['opt-a', 'opt-a']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('重复');
  });

  it('不属于该投票的选项被拒绝', () => {
    const result = validate(multi, ['opt-a', 'opt-x']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('空选票被拒绝', () => {
    expect(validate(multi, []).ok).toBe(false);
  });

  it('已到 closesAt 返回 VOTE_CLOSED', () => {
    const closedConfig = normalizeVoteConfig({
      multi: false,
      closesAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    const result = validate(closedConfig, ['opt-a']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.VOTE_CLOSED);
  });

  it('卡片状态 closed 时即使未到截止时间也拒绝', () => {
    const result = validate(single, ['opt-a'], { cardStatus: 'closed' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.VOTE_CLOSED);
  });

  it('quorum 限制最多可选项数', () => {
    const limited = normalizeVoteConfig({ multi: true, quorum: 1 });
    expect(validate(limited, ['opt-a']).ok).toBe(true);
    expect(validate(limited, ['opt-a', 'opt-b']).ok).toBe(false);
  });

  it('isVoteClosed 覆盖状态 / closedAt / closesAt 三种来源', () => {
    expect(isVoteClosed(single, 'open', NOW)).toBe(false);
    expect(isVoteClosed(single, 'closed', NOW)).toBe(true);
    expect(isVoteClosed(single, 'archived', NOW)).toBe(true);
    const past = normalizeVoteConfig({ closesAt: new Date(NOW.getTime() - 1).toISOString() });
    expect(isVoteClosed(past, 'open', NOW)).toBe(true);
    expect(isVoteClosed(single, 'open', NOW, new Date())).toBe(true);
  });

  it('计票与匿名投影：匿名不返回 voters', () => {
    const ballots = [
      { optionId: 'opt-a', userId: 'u1' },
      { optionId: 'opt-a', userId: 'u2' },
      { optionId: 'opt-b', userId: 'u3' },
    ];
    expect(tallyBallots(OPTIONS, ballots)).toEqual({
      counts: { 'opt-a': 2, 'opt-b': 1, 'opt-c': 0 },
      total: 3,
    });

    const anonymous = normalizeVoteConfig({ anonymous: true });
    const projected = projectVoteResult(anonymous, OPTIONS, ballots);
    expect(projected.voters).toEqual([]);
    expect(projected.total).toBe(3);
    expect(projected.counts).toEqual({ 'opt-a': 2, 'opt-b': 1, 'opt-c': 0 });

    const named = projectVoteResult(single, OPTIONS, ballots);
    expect(named.voters.sort()).toEqual(['u1', 'u2', 'u3']);
  });
});
