/**
 * IM 纯函数（模块六）：@提及解析、DING 配额、上海日界。
 * 不碰 DB，便于单测（test/im.spec.ts）。
 */

/** 单条消息最多记录 20 个提及 */
export const MENTION_MAX = 20;
/** 每人每自然日 DING 上限 */
export const DING_DAILY_LIMIT = 3;
/** 超限文案（前端直接展示） */
export const DING_QUOTA_EXHAUSTED = '今日 DING 次数已用完（3/3）';

/** @handle：小写字母 / 数字 / 下划线，2..32 位（大小写不敏感） */
const MENTION_PATTERN = /@([a-z0-9_]{2,32})/gi;

/**
 * 从正文解析 @ 呼号：归一为小写、去重、按出现顺序、最多 20 个。
 * 是否命中频道成员由调用方再过滤（忽略非成员）。
 */
export function parseMentionHandles(body: string | null | undefined): string[] {
  if (!body) return [];
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const handle = match[1]?.toLowerCase();
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
    if (handles.length >= MENTION_MAX) break;
  }
  return handles;
}

export interface DingQuota {
  limit: number;
  used: number;
  remaining: number;
}

/** 今日 DING 用量视图（脏数据裁剪到非负） */
export function dingQuota(used: number, limit = DING_DAILY_LIMIT): DingQuota {
  const safeLimit = Math.max(1, Math.trunc(limit) || DING_DAILY_LIMIT);
  const safeUsed = Math.max(0, Math.trunc(used) || 0);
  return { limit: safeLimit, used: safeUsed, remaining: Math.max(0, safeLimit - safeUsed) };
}

/** 上海时区当日 00:00 对应的 UTC 时刻（Asia/Shanghai 恒为 UTC+8，无夏令时） */
export function shanghaiDayStart(now: Date = new Date()): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
  return new Date(`${day}T00:00:00.000+08:00`);
}
