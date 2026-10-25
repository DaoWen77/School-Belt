import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadReceiptMerger, type ReadReceiptEntry } from '../src/common/utils/read-throttle';

describe('已读回执服务端合并（契约 §9：300ms 窗口）', () => {
  let flushed: ReadReceiptEntry[];

  beforeEach(() => {
    vi.useFakeTimers();
    flushed = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const merger = (windowMs = 300): ReadReceiptMerger =>
    new ReadReceiptMerger({
      windowMs,
      flush: async (entry) => {
        flushed.push(entry);
      },
    });

  it('窗口内多次上报只落库一次，且取最大 seq', async () => {
    const instance = merger();
    instance.submit('u1', 'c1', 5n);
    instance.submit('u1', 'c1', 9n);
    instance.submit('u1', 'c1', 7n); // 回退的 seq 被忽略
    expect(flushed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(299);
    expect(flushed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(flushed).toEqual([{ userId: 'u1', channelId: 'c1', seq: 9n }]);
    expect(instance.pendingCount).toBe(0);
  });

  it('不同频道互不合并', async () => {
    const instance = merger();
    instance.submit('u1', 'c1', 3n);
    instance.submit('u1', 'c2', 4n);
    await vi.advanceTimersByTimeAsync(300);
    expect(flushed).toHaveLength(2);
    expect(flushed.map((entry) => entry.channelId).sort()).toEqual(['c1', 'c2']);
  });

  it('窗口结束后的新上报会重新开窗', async () => {
    const instance = merger();
    instance.submit('u1', 'c1', 10n);
    await vi.advanceTimersByTimeAsync(300);
    instance.submit('u1', 'c1', 11n);
    await vi.advanceTimersByTimeAsync(300);
    expect(flushed.map((entry) => entry.seq)).toEqual([10n, 11n]);
  });

  it('flushAll 立即落库，close 后不再接收', async () => {
    const instance = merger();
    instance.submit('u1', 'c1', 1n);
    await instance.flushAll();
    expect(flushed).toHaveLength(1);

    await instance.close();
    instance.submit('u1', 'c1', 2n);
    await vi.advanceTimersByTimeAsync(1000);
    expect(flushed).toHaveLength(1);
  });

  it('落库失败不影响后续上报，错误交给 onError', async () => {
    const errors: unknown[] = [];
    const instance = new ReadReceiptMerger({
      windowMs: 300,
      flush: async () => {
        throw new Error('pg down');
      },
      onError: (error) => errors.push(error),
    });
    instance.submit('u1', 'c1', 2n);
    await vi.advanceTimersByTimeAsync(300);
    expect(errors).toHaveLength(1);

    const ok = merger();
    ok.submit('u1', 'c1', 3n);
    await vi.advanceTimersByTimeAsync(300);
    expect(flushed).toHaveLength(1);
  });
});
