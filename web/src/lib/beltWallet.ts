import { useEffect, useState } from 'react';
import { beltApi } from './beltApi';
import type { BeltWallet } from './beltTypes';

let cached: number | null = null;
const listeners = new Set<(cents: number) => void>();
let inflight: Promise<void> | null = null;

export function setWalletBalance(cents: number): void {
  cached = cents;
  for (const listener of listeners) listener(cents);
}

/** 拉一次余额；并发调用复用同一请求，失败静默降级（不打断页面）。 */
export function refreshWallet(): Promise<void> {
  if (inflight) return inflight;
  inflight = beltApi<BeltWallet>('/belt/me/wallet')
    .then((data) => {
      if (typeof data?.balanceCents === 'number') setWalletBalance(data.balanceCents);
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 全局商券余额（分）：首次挂载拉取，打赏成功后由 setWalletBalance 广播刷新。 */
export function useBeltWallet(): number | null {
  const [cents, setCents] = useState<number | null>(cached);
  useEffect(() => {
    listeners.add(setCents);
    if (cached === null) void refreshWallet();
    else setCents(cached);
    return () => {
      listeners.delete(setCents);
    };
  }, []);
  return cents;
}

export function fmtCents(cents: number | null | undefined): string {
  return (Math.max(0, cents ?? 0) / 100).toFixed(2);
}
