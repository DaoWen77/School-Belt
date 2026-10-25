import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

/**
 * 游标编解码（契约 §3）：
 * - 消息游标 = base64url(`seq:<id>`)，不透明字符串，客户端不得解析；
 * - 其他列表（卡片 / 搜索）使用 `k:<part1>:<part2>` 复合游标，同样是 base64url。
 */

const SEQ_PREFIX = 'seq:';
const KEY_PREFIX = 'k:';

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function fromBase64Url(cursor: string): string {
  // Buffer 对非法 base64url 是宽松的，先做字符集校验
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(cursor)) {
    throw invalidCursor();
  }
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (text.length === 0) throw invalidCursor();
  return text;
}

function invalidCursor(): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, '游标格式非法', { field: 'cursor' });
}

/** 把消息单调序号编码为不透明游标 */
export function encodeSeqCursor(seq: bigint | number | string): string {
  const value = typeof seq === 'bigint' ? seq.toString() : String(seq);
  if (!/^\d+$/.test(value)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '序号必须为非负整数', { field: 'seq' });
  }
  return toBase64Url(`${SEQ_PREFIX}${value}`);
}

/** 解析消息游标；非法输入统一 VALIDATION_FAILED，绝不把库内 id 语义泄露给客户端 */
export function decodeSeqCursor(cursor: string): bigint {
  if (typeof cursor !== 'string' || cursor.length === 0) throw invalidCursor();
  let text: string;
  try {
    text = fromBase64Url(cursor);
  } catch {
    throw invalidCursor();
  }
  if (!text.startsWith(SEQ_PREFIX)) throw invalidCursor();
  const raw = text.slice(SEQ_PREFIX.length);
  if (!/^\d{1,19}$/.test(raw)) throw invalidCursor();
  const value = BigInt(raw);
  if (value < 0n) throw invalidCursor();
  return value;
}

/** 复合游标：用于 cards / search 等按 (排序键, id) 分页的场景 */
export function encodeKeyCursor(parts: readonly (string | number)[]): string {
  if (parts.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, '复合游标至少需要一个分量');
  }
  return toBase64Url(`${KEY_PREFIX}${parts.map((p) => String(p)).join(':')}`);
}

export function decodeKeyCursor(cursor: string, expectedParts: number): string[] {
  if (typeof cursor !== 'string' || cursor.length === 0) throw invalidCursor();
  let text: string;
  try {
    text = fromBase64Url(cursor);
  } catch {
    throw invalidCursor();
  }
  if (!text.startsWith(KEY_PREFIX)) throw invalidCursor();
  const parts = text.slice(KEY_PREFIX.length).split(':');
  if (parts.length !== expectedParts || parts.some((p) => p.length === 0)) throw invalidCursor();
  return parts;
}

/** 契约 §3：单次 limit ≤ 100，默认 50 */
export function clampLimit(limit: number | undefined | null, fallback = 50, max = 100): number {
  if (limit === undefined || limit === null || Number.isNaN(limit)) return fallback;
  if (!Number.isFinite(limit) || limit < 1) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'limit 必须为正整数', { field: 'limit' });
  }
  return Math.min(Math.floor(limit), max);
}

/** 未读计数与已读游标的单调合并：只允许前进，不允许回退 */
export function maxSeq(current: bigint, incoming: bigint): bigint {
  return incoming > current ? incoming : current;
}
