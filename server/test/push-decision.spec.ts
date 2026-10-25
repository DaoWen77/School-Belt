import { describe, expect, it } from 'vitest';
import {
  decidePush,
  effectiveNotifyLevel,
  isWithinDndWindow,
  localMinutesOfDay,
  type PushDecisionInput,
} from '../src/notifications/push/push-decision';

const NOON_SHANGHAI = new Date('2026-10-22T04:00:00.000Z'); // 12:00 Asia/Shanghai
const MIDNIGHT_SHANGHAI = new Date('2026-10-22T15:30:00.000Z'); // 23:30 Asia/Shanghai

function input(overrides: Partial<PushDecisionInput> = {}): PushDecisionInput {
  return {
    type: 'mention',
    channelNotifyLevel: 'all',
    globalNotifyLevel: 'all',
    dndEnabled: false,
    dndStart: null,
    dndEnd: null,
    timezone: 'Asia/Shanghai',
    now: NOON_SHANGHAI,
    isMention: true,
    hasActiveSocket: false,
    ...overrides,
  };
}

describe('推送决策（契约 §9 / docs/07）', () => {
  it('all 级别、无 DND、离线：允许推送', () => {
    expect(decidePush(input({ type: 'system', isMention: false }))).toEqual({
      push: true,
      reason: 'allowed',
    });
  });

  it('none 级别：任何类型都不推（频道或全站任一为 none 即静默）', () => {
    expect(decidePush(input({ channelNotifyLevel: 'none' }))).toEqual({
      push: false,
      reason: 'notify_none',
    });
    expect(decidePush(input({ globalNotifyLevel: 'none' }))).toEqual({
      push: false,
      reason: 'notify_none',
    });
  });

  it('mentions 级别：mention / thread_reply / card_assigned 放行', () => {
    for (const type of ['mention', 'thread_reply', 'card_assigned'] as const) {
      expect(decidePush(input({ channelNotifyLevel: 'mentions', type })).push).toBe(true);
    }
  });

  it('mentions 级别：system 等非定向类型不推', () => {
    expect(
      decidePush(input({ channelNotifyLevel: 'mentions', type: 'system', isMention: false })),
    ).toEqual({ push: false, reason: 'mentions_only' });
  });

  it('生效级别取最严格的一侧', () => {
    expect(effectiveNotifyLevel('all', 'mentions')).toBe('mentions');
    expect(effectiveNotifyLevel('none', 'all')).toBe('none');
    expect(effectiveNotifyLevel('all', 'all')).toBe('all');
  });

  it('免打扰时段内普通通知不推，mention 作为紧急通知仍推', () => {
    const dnd = {
      dndEnabled: true,
      dndStart: '22:00',
      dndEnd: '08:00',
      now: MIDNIGHT_SHANGHAI,
    };
    expect(
      decidePush(input({ ...dnd, type: 'thread_reply', isMention: false })),
    ).toEqual({ push: false, reason: 'dnd_window' });
    expect(decidePush(input({ ...dnd, type: 'mention', isMention: true }))).toEqual({
      push: true,
      reason: 'mention_urgent',
    });
  });

  it('跨零点免打扰：23:30 与 07:00 都在窗口内，12:00 不在', () => {
    const start = '22:00';
    const end = '08:00';
    expect(isWithinDndWindow(MIDNIGHT_SHANGHAI, start, end, 'Asia/Shanghai')).toBe(true);
    expect(
      isWithinDndWindow(new Date('2026-10-21T23:00:00.000Z'), start, end, 'Asia/Shanghai'),
    ).toBe(true); // 07:00
    expect(isWithinDndWindow(NOON_SHANGHAI, start, end, 'Asia/Shanghai')).toBe(false);
  });

  it('时区参与换算：同一时刻 UTC 不在窗口、上海在窗口', () => {
    const instant = new Date('2026-10-22T17:30:00.000Z'); // UTC 17:30 / 上海 01:30
    expect(localMinutesOfDay(instant, 'Asia/Shanghai')).toBe(90);
    expect(isWithinDndWindow(instant, '22:00', '08:00', 'Asia/Shanghai')).toBe(true);
    expect(isWithinDndWindow(instant, '22:00', '08:00', 'UTC')).toBe(false);
  });

  it('用户在线（有活跃 WS）时只走 WS，不推', () => {
    expect(decidePush(input({ hasActiveSocket: true }))).toEqual({
      push: false,
      reason: 'active_socket',
    });
    // 在线优先级高于 DND：即使 mention 紧急也不再推
    expect(
      decidePush(
        input({
          hasActiveSocket: true,
          dndEnabled: true,
          dndStart: '22:00',
          dndEnd: '08:00',
          now: MIDNIGHT_SHANGHAI,
        }),
      ),
    ).toEqual({ push: false, reason: 'active_socket' });
  });

  it('免打扰未开启 / start==end 视为不生效', () => {
    expect(isWithinDndWindow(MIDNIGHT_SHANGHAI, '22:00', '08:00', 'Asia/Shanghai')).toBe(true);
    expect(
      isWithinDndWindow(MIDNIGHT_SHANGHAI, '22:00', '22:00', 'Asia/Shanghai'),
    ).toBe(false);
    expect(
      decidePush(
        input({
          type: 'thread_reply',
          isMention: false,
          dndEnabled: false,
          dndStart: '22:00',
          dndEnd: '08:00',
          now: MIDNIGHT_SHANGHAI,
        }),
      ).push,
    ).toBe(true);
  });

  it('非法时区回退 UTC，不抛异常', () => {
    expect(() => localMinutesOfDay(NOON_SHANGHAI, 'Not/AZone')).not.toThrow();
    expect(localMinutesOfDay(NOON_SHANGHAI, 'Not/AZone')).toBe(240); // 04:00 UTC
  });

  it('左闭右开：start 时刻算窗口内，end 时刻不算', () => {
    expect(isWithinDndWindow(new Date('2026-10-22T14:00:00.000Z'), '22:00', '08:00', 'Asia/Shanghai')).toBe(true); // 22:00
    expect(isWithinDndWindow(new Date('2026-10-22T00:00:00.000Z'), '22:00', '08:00', 'Asia/Shanghai')).toBe(false); // 08:00
  });
});
