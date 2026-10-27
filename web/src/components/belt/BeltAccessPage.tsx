'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { beltApi, BeltApiError } from '@/lib/beltApi';
import { beltSession } from '@/lib/beltSession';
import { session } from '@/lib/session';
import { BeltDenial } from './BeltDenial';

type Phase = 'idle' | 'checking' | 'granted' | 'denied' | 'error';

interface InternalAuthResult {
  accessToken: string;
  refreshToken: string;
}

export function BeltAccessPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!beltSession.hasTokens()) {
      router.replace('/belt/login?next=%2Fbelt%2Faccess');
    }
  }, [router]);

  const check = async () => {
    if (phase === 'checking' || phase === 'granted' || phase === 'denied') return;
    setPhase('checking');
    setMessage(null);
    try {
      const data = await beltApi<{ code: string; next: string }>('/belt/access/internal/check', {
        method: 'POST',
        body: JSON.stringify({ next: '/' }),
      });
      const exchanged = await beltApi<InternalAuthResult>('/auth/handoff/exchange', {
        method: 'POST',
        body: JSON.stringify({ code: data.code }),
      });
      session.setTokens(exchanged.accessToken, exchanged.refreshToken);
      setPhase('granted');
      window.setTimeout(() => {
        window.location.assign(data.next || '/');
      }, 900);
    } catch (caught) {
      if (caught instanceof BeltApiError) {
        if (caught.status === 401) {
          beltSession.clear();
          router.replace('/belt/login?next=%2Fbelt%2Faccess');
          return;
        }
        if (caught.code === 'PROTOCOL_DENIED' || caught.status === 403) {
          setPhase('denied');
          return;
        }
        setMessage(`${caught.code} · ${caught.message}`);
      } else {
        setMessage(caught instanceof Error ? caught.message : '链路校验失败');
      }
      setPhase('error');
    }
  };

  if (phase === 'denied') {
    return <BeltDenial onDone={() => router.replace('/belt/channel')} />;
  }

  return (
    <div className="belt-root">
      <div className="belt-gate">
        <div className="belt-gate-panel">
          <p className="belt-gate-kicker">O.M.V INTERNAL // ACCESS GATE</p>
          <h1>
            INTERNAL LINK
            <small>返回帝江号 / 仅 `[极光科技]` 身份可通过</small>
          </h1>
          <div className="mt-4 border-l-2 border-[var(--ef-signal)] pl-3 text-[11px] leading-[1.8] text-[var(--ef-ink-2)]">
            <p>这里不是普通登录。协议会现场校验你的环带身份标签。</p>
            <p>无标签将触发红色协议拒绝，并在 3 秒后强制断开回外环。</p>
          </div>
          {phase === 'granted' ? (
            <div className="mt-4 border border-[var(--ef-signal)] bg-[var(--ef-signal)] p-3 font-mono text-[11px] font-bold text-[var(--ef-on-signal)]">
              ACCESS GRANTED / 链路已建立
            </div>
          ) : null}
          {message ? (
            <p className="belt-error mt-3" role="alert">
              <code>LINK_DENIED</code> {message}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="belt-button is-signal"
              disabled={phase === 'checking' || phase === 'granted'}
              onClick={() => void check()}
            >
              {phase === 'checking' ? '正在校验…' : phase === 'granted' ? '链路已建立' : '返回帝江号'}
            </button>
            <Link href="/belt/channel" className="belt-button">
              返回环带
            </Link>
          </div>
          <div className="belt-gate-foot">
            <span>当前身份：{beltSession.hasTokens() ? 'BELT SESSION' : 'NO SESSION'}</span>
            <span>·</span>
            <span>交接码 60 秒单次有效</span>
          </div>
        </div>
      </div>
    </div>
  );
}
