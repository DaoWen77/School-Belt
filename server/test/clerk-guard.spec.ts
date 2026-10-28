import { describe, expect, it } from 'vitest';
import { clerkEligibility } from '../src/moderation/majority';
import { CLERK_REQUIRED_LEVEL } from '../src/social/level';
import { STICKER_MAX } from '../src/belt/belt-stickers.service';

describe('风纪重复申请拦截（模块四补丁）', () => {
  it('已是风纪委员：canApply=false 且原因含「你已是风纪委员」', () => {
    const result = clerkEligibility({ level: 6, violations30d: 0, isClerk: true });
    expect(result.canApply).toBe(false);
    expect(result.reasons.join('；')).toContain('你已是风纪委员');
  });

  it('已是风纪委员时即便等级/违规都达标也不可申请', () => {
    const result = clerkEligibility({
      level: CLERK_REQUIRED_LEVEL + 2,
      violations30d: 0,
      hasPending: false,
      isClerk: true,
    });
    expect(result.levelOk).toBe(true);
    expect(result.cleanOk).toBe(true);
    expect(result.canApply).toBe(false);
  });

  it('未标记 isClerk 时行为不变（向后兼容）', () => {
    const result = clerkEligibility({ level: CLERK_REQUIRED_LEVEL, violations30d: 0 });
    expect(result.canApply).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(clerkEligibility({ level: 6, violations30d: 0, isClerk: false }).canApply).toBe(true);
  });

  it('已是风纪委员的原因排在最前，便于前端直接展示', () => {
    const result = clerkEligibility({ level: 0, violations30d: 3, isClerk: true });
    expect(result.reasons[0]).toBe('你已是风纪委员');
    expect(result.reasons.length).toBeGreaterThan(1);
  });
});

describe('表情包上限（模块四补丁）', () => {
  it('单人上限 100', () => {
    expect(STICKER_MAX).toBe(100);
  });
});
