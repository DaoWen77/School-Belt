import { describe, expect, it } from 'vitest';
import {
  DING_DAILY_LIMIT,
  DING_QUOTA_EXHAUSTED,
  MENTION_MAX,
  dingQuota,
  parseMentionHandles,
  shanghaiDayStart,
} from '../src/belt/im-utils';

describe('@提及解析（模块六）', () => {
  it('解析基本呼号并归一为小写', () => {
    expect(parseMentionHandles('hi @Dijiang and @dijiang_bot')).toEqual([
      'dijiang',
      'dijiang_bot',
    ]);
  });

  it('去重且保持首次出现顺序', () => {
    expect(parseMentionHandles('@bob @alice @BOB @alice')).toEqual(['bob', 'alice']);
  });

  it('忽略过短 / 过长 / 非法字符', () => {
    // 1 位 → 不匹配；33 位 → 只取前 32 位
    expect(parseMentionHandles('@a @ab')).toEqual(['ab']);
    expect(parseMentionHandles(`@${'x'.repeat(33)}`)).toEqual([`${'x'.repeat(32)}`]);
    // 连字符终止呼号 → 只剩合法的 bad
    expect(parseMentionHandles('@bad-name')).toEqual(['bad']);
    expect(parseMentionHandles('@中文呼号')).toEqual([]);
  });

  it('无正文 / 空串 / 无 @ 时返回空数组', () => {
    expect(parseMentionHandles(null)).toEqual([]);
    expect(parseMentionHandles(undefined)).toEqual([]);
    expect(parseMentionHandles('')).toEqual([]);
    expect(parseMentionHandles('没有提及')).toEqual([]);
  });

  it(`最多 ${MENTION_MAX} 个，按出现顺序截断`, () => {
    const body = Array.from({ length: 30 }, (_, index) => `@user${index}`).join(' ');
    const handles = parseMentionHandles(body);
    expect(handles).toHaveLength(MENTION_MAX);
    expect(handles[0]).toBe('user0');
    expect(handles[MENTION_MAX - 1]).toBe(`user${MENTION_MAX - 1}`);
  });

  it('同一呼号大小写混写只计一次', () => {
    expect(parseMentionHandles('@Alice @alice @ALICE')).toEqual(['alice']);
  });
});

describe('DING 配额（模块六）', () => {
  it('默认每日 3 次', () => {
    expect(DING_DAILY_LIMIT).toBe(3);
    expect(dingQuota(0)).toEqual({ limit: 3, used: 0, remaining: 3 });
    expect(dingQuota(1)).toEqual({ limit: 3, used: 1, remaining: 2 });
    expect(dingQuota(2)).toEqual({ limit: 3, used: 2, remaining: 1 });
  });

  it('用尽后 remaining 归 0（不出现负数）', () => {
    expect(dingQuota(3)).toEqual({ limit: 3, used: 3, remaining: 0 });
    expect(dingQuota(99)).toEqual({ limit: 3, used: 99, remaining: 0 });
  });

  it('脏数据（负数 / NaN）裁到 0', () => {
    expect(dingQuota(-5)).toEqual({ limit: 3, used: 0, remaining: 3 });
    expect(dingQuota(Number.NaN)).toEqual({ limit: 3, used: 0, remaining: 3 });
  });

  it('超限文案固定', () => {
    expect(DING_QUOTA_EXHAUSTED).toBe('今日 DING 次数已用完（3/3）');
  });
});

describe('上海日界（模块六）', () => {
  it('北京 08:00 的 UTC 时刻与当日零点一致（UTC+8 无夏令时）', () => {
    // 2026-10-02 00:00 CST == 2026-10-01T16:00:00Z
    expect(shanghaiDayStart(new Date('2026-10-01T16:00:00Z')).toISOString()).toBe(
      '2026-10-01T16:00:00.000Z',
    );
    // 2026-10-02 23:59 CST 仍属于 10-02 这一天
    expect(shanghaiDayStart(new Date('2026-10-02T15:59:00Z')).toISOString()).toBe(
      '2026-10-01T16:00:00.000Z',
    );
    // UTC 15:59:59 之前的时刻被算进前一天
    expect(shanghaiDayStart(new Date('2026-10-01T15:59:59Z')).toISOString()).toBe(
      '2026-09-30T16:00:00.000Z',
    );
  });
});
