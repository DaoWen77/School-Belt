import type { NotificationType, NotifyLevel } from '../../common/types/enums';

/**
 * 推送决策层（纯函数，无 IO）。
 *
 * 契约 §9 / docs/07：站内通知一定写库，推送不一定。判定顺序：
 *   1. 级别：none → 不推；mentions → 仅 mention / thread_reply / card_assigned 放行；
 *   2. 在线：该用户有活跃 WS 连接 → 只走 WS，不推（避免同一条通知出现两次）；
 *   3. 免打扰：DND 时段内非提及不推；mention 视为紧急，DND 内仍推（docs/07 §2、§4）。
 *
 * 与 docs/07 §2 的口径一致：system 不特殊放行，同样受级别与 DND 约束。
 */

export type PushDecisionReason =
  | 'allowed'
  | 'notify_none'
  | 'mentions_only'
  | 'active_socket'
  | 'dnd_window'
  | 'mention_urgent';

export interface PushDecisionInput {
  type: NotificationType;
  /** channel_members.notify_level；非频道通知传 'all' */
  channelNotifyLevel: NotifyLevel;
  /** user_settings.notify_level */
  globalNotifyLevel: NotifyLevel;
  dndEnabled: boolean;
  /** 'HH:mm' 或 'HH:mm:ss'，本地时区 */
  dndStart: string | null;
  dndEnd: string | null;
  timezone: string;
  now: Date;
  isMention: boolean;
  hasActiveSocket: boolean;
}

export interface PushDecision {
  push: boolean;
  reason: PushDecisionReason;
}

/** mentions 级别放行的通知类型（直接指向我的事情） */
const MENTION_LEVEL_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'mention',
  'thread_reply',
  'card_assigned',
]);

/** 'HH:mm[:ss]' → 当日分钟数；非法返回 null */
export function parseHhMm(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * 把 now 换算到指定 IANA 时区的“当日分钟数”。
 * timeZone 非法时回退 UTC（不因用户配置错误而丢通知）。
 */
export function localMinutesOfDay(now: Date, timeZone: string): number {
  const formatter = (tz: string): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  try {
    const parts = formatter(timeZone).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  } catch {
    const parts = formatter('UTC').formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  }
}

/** 免打扰判定：左闭右开 [start, end)；start > end 视为跨零点；start == end 视为未启用 */
export function isWithinDndWindow(
  now: Date,
  dndStart: string | null,
  dndEnd: string | null,
  timezone: string,
): boolean {
  const start = parseHhMm(dndStart);
  const end = parseHhMm(dndEnd);
  if (start === null || end === null || start === end) return false;
  const current = localMinutesOfDay(now, timezone);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** 生效级别：任一侧为 none 即静默；任一侧为 mentions 即只放行定向类 */
export function effectiveNotifyLevel(
  channelNotifyLevel: NotifyLevel,
  globalNotifyLevel: NotifyLevel,
): NotifyLevel {
  if (channelNotifyLevel === 'none' || globalNotifyLevel === 'none') return 'none';
  if (channelNotifyLevel === 'mentions' || globalNotifyLevel === 'mentions') return 'mentions';
  return 'all';
}

export function decidePush(input: PushDecisionInput): PushDecision {
  const level = effectiveNotifyLevel(input.channelNotifyLevel, input.globalNotifyLevel);

  if (level === 'none') return { push: false, reason: 'notify_none' };
  if (level === 'mentions' && !MENTION_LEVEL_TYPES.has(input.type)) {
    return { push: false, reason: 'mentions_only' };
  }
  if (input.hasActiveSocket) return { push: false, reason: 'active_socket' };

  const inDnd = input.dndEnabled
    ? isWithinDndWindow(input.now, input.dndStart, input.dndEnd, input.timezone)
    : false;
  if (inDnd) {
    return input.isMention
      ? { push: true, reason: 'mention_urgent' }
      : { push: false, reason: 'dnd_window' };
  }

  return { push: true, reason: 'allowed' };
}
