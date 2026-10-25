/**
 * 已读回执服务端合并节流（契约 §9：客户端节流 500ms，服务端合并 300ms）。
 *
 * 纯内存实现，不依赖 Redis：单实例内对同一 (userId, channelId) 的多次上报
 * 合并为一个窗口内最大的 seq，窗口到期后仅落一次库。多实例部署时每个实例
 * 各自合并，落库语句用 `last_read_seq = GREATEST(last_read_seq, $seq)` 保证幂等。
 */

export interface ReadReceiptEntry {
  userId: string;
  channelId: string;
  seq: bigint;
}

export type ReadReceiptFlush = (entry: ReadReceiptEntry) => Promise<void>;

export interface ReadReceiptMergerOptions {
  /** 合并窗口，默认 300ms（契约 §9） */
  windowMs?: number;
  /** 落库回调 */
  flush: ReadReceiptFlush;
  /** 落库失败回调（默认丢弃并交给上层日志） */
  onError?: (error: unknown, entry: ReadReceiptEntry) => void;
}

export class ReadReceiptMerger {
  private readonly windowMs: number;
  private readonly flushFn: ReadReceiptFlush;
  private readonly onError?: (error: unknown, entry: ReadReceiptEntry) => void;

  /** key = `${userId}:${channelId}`，value = 待落库的最大 seq */
  private readonly pending = new Map<string, bigint>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inflight = new Set<Promise<void>>();
  private closed = false;

  constructor(options: ReadReceiptMergerOptions) {
    this.windowMs = options.windowMs ?? 300;
    this.flushFn = options.flush;
    this.onError = options.onError;
  }

  /** 待落库条目数（测试与监控用） */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * 上报一个已读位置。同一窗口内多次调用只保留最大 seq；
   * 回退或相等的 seq 直接忽略（契约 §3 单调序）。
   */
  submit(userId: string, channelId: string, seq: bigint): void {
    if (this.closed) return;
    const key = `${userId}:${channelId}`;
    const previous = this.pending.get(key);
    if (previous !== undefined && seq <= previous) return;

    this.pending.set(key, seq);
    if (this.timers.has(key)) return;

    const timer = setTimeout(() => {
      this.timers.delete(key);
      void this.flushKey(key);
    }, this.windowMs);
    // Node 下不阻塞进程退出
    timer.unref?.();
    this.timers.set(key, timer);
  }

  /** 立即落库所有挂起条目（停机、测试用） */
  async flushAll(): Promise<void> {
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(key);
      await this.flushKey(key);
    }
    await Promise.all([...this.inflight]);
  }

  /** 关闭合并器：清空定时器并落库 */
  async close(): Promise<void> {
    this.closed = true;
    await this.flushAll();
  }

  private async flushKey(key: string): Promise<void> {
    const seq = this.pending.get(key);
    if (seq === undefined) return;
    this.pending.delete(key);

    const separator = key.indexOf(':');
    const entry: ReadReceiptEntry = {
      userId: key.slice(0, separator),
      channelId: key.slice(separator + 1),
      seq,
    };

    const task = this.flushFn(entry)
      .catch((error: unknown) => {
        this.onError?.(error, entry);
      })
      .then(() => {
        this.inflight.delete(task);
      });
    this.inflight.add(task);
    await task;
  }
}
