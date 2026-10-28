'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { beltApi, type BeltAuthResult } from '@/lib/beltApi';
import { beltSession } from '@/lib/beltSession';

export function BeltHandoffPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'link' | 'granted'>('link');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const code = query.get('code') ?? '';
    const rawNext = query.get('next') ?? '/belt/channel';
    const next = rawNext.startsWith('/belt') ? rawNext : '/belt/channel';
    if (!code) {
      setError('未收到交接码。');
      return;
    }
    let cancelled = false;
    beltApi<BeltAuthResult>('/belt/auth/handoff/exchange', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
      .then((data) => {
        if (cancelled) return;
        beltSession.setTokens(data.accessToken, data.refreshToken);
        setPhase('granted');
        window.setTimeout(() => router.replace(next), 420);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '交接失败');
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="belt-root">
      <div className="belt-gate">
        <div className="belt-gate-panel">
          <p className="belt-gate-kicker">O.M.V → BELT-07</p>
          <h1>
            {phase === 'granted' ? 'LINK ESTABLISHED' : 'HANDOFF'}
            <small>
              {error
                ? error
                : phase === 'granted'
                  ? '链路已建立。正在转入环塔终端…'
                  : '正在兑换交接码，建立外环会话…'}
            </small>
          </h1>
          {error ? (
            <div className="belt-gate-foot">
              <Link href="/belt/login">返回环塔登录</Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
