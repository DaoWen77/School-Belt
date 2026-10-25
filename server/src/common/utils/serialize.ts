/**
 * 响应序列化辅助：
 * - messages.id 为 BIGINT，Prisma 返回 bigint，直接 JSON.stringify 会抛错；
 * - 对外统一转成十进制字符串（契约 §3 游标语义同源），客户端按不透明 ID 处理。
 */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toJsonSafe(item);
    }
    return result;
  }
  return value;
}

/** 只保留对象中非 undefined 的键，避免响应里出现空字段 */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output as Partial<T>;
}

/** 统一的分页返回结构 */
export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
}
