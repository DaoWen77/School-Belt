import { describe, expect, it } from 'vitest';
import { AppError } from '../src/common/errors/app-error';
import { ErrorCode } from '../src/common/errors/error-codes';
import {
  clampLimit,
  decodeKeyCursor,
  decodeSeqCursor,
  encodeKeyCursor,
  encodeSeqCursor,
  maxSeq,
} from '../src/common/utils/cursor';

describe('cursor 编解码（契约 §3）', () => {
  it('消息游标是可往返的 base64url 不透明串', () => {
    const cursor = encodeSeqCursor(123n);
    expect(cursor).not.toContain('123');
    expect(decodeSeqCursor(cursor)).toBe(123n);
  });

  it('支持 number / string 输入', () => {
    expect(decodeSeqCursor(encodeSeqCursor(7))).toBe(7n);
    expect(decodeSeqCursor(encodeSeqCursor('9007199254740993'))).toBe(9007199254740993n);
  });

  it('非法游标统一抛 VALIDATION_FAILED', () => {
    for (const bad of ['', 'not-a-cursor!', Buffer.from('id:12').toString('base64url')]) {
      expect(() => decodeSeqCursor(bad)).toThrowError(AppError);
      try {
        decodeSeqCursor(bad);
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
      }
    }
  });

  it('负数或非数字序号无法编码', () => {
    expect(() => encodeSeqCursor('abc')).toThrowError(AppError);
    expect(() => encodeSeqCursor(-1)).toThrowError(AppError);
  });

  it('复合游标（卡片 / 搜索）按分量解析', () => {
    const cursor = encodeKeyCursor([1000, 'abc']);
    expect(decodeKeyCursor(cursor, 2)).toEqual(['1000', 'abc']);
    expect(() => decodeKeyCursor(cursor, 3)).toThrowError(AppError);
  });

  it('limit 上限 100、默认 50（契约 §3）', () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(20)).toBe(20);
    expect(clampLimit(500)).toBe(100);
    expect(() => clampLimit(0)).toThrowError(AppError);
  });

  it('已读游标只前进不后退', () => {
    expect(maxSeq(10n, 11n)).toBe(11n);
    expect(maxSeq(10n, 9n)).toBe(10n);
    expect(maxSeq(10n, 10n)).toBe(10n);
  });
});
