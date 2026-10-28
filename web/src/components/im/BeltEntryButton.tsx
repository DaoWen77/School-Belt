'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';

interface HandoffResult {
  code: string;
  next: string;
  expiresIn: number;
}

/**
 * 内部 → 环塔入口。
 * 点击后先播放 1.5 秒终端连线，再跳转 /belt/handoff 兑换 belt 会话。
 */
export function BeltEntryButton() {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(false);
  const [handoff, setHandoff] = useState<HandoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setElapsed(false);
    const timer = window.setTimeout(() => setElapsed(true), 1500);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !elapsed || error) return;
    if (!handoff) return;
    window.location.assign(
      `/belt/handoff?code=${encodeURIComponent(handoff.code)}&next=${encodeURIComponent(handoff.next)}`,
    );
  }, [open, elapsed, handoff, error]);

  const enter = async () => {
    if (open) return;
    setOpen(true);
    setElapsed(false);
    setHandoff(null);
    setError(null);
    try {
      const data = await api<HandoffResult>('/access/belt/handoff', {
        method: 'POST',
        body: JSON.stringify({ next: '/belt/channel' }),
      });
      setHandoff(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '外部链路不可用');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void enter()}
        className="mt-1 flex w-full items-center justify-between gap-1 border border-line px-2 py-1.5 text-[10px] font-semibold text-ink-2 hover:border-ink hover:text-ink"
      >
        <span className="font-sans uppercase tracking-[0.12em]">External Link</span>
        <span>接入环塔 ↗</span>
      </button>

      {open && typeof document !== 'undefined' ? createPortal(
        <div className="belt-entry" role="dialog" aria-modal="true" aria-busy="true">
          <div className="belt-entry-frame">
            <div className="belt-entry-top">
              <span>O.M.V // EXTERNAL RELAY</span>
              <span>LINK 07 / 1.5s</span>
            </div>
            <div className="belt-entry-lines">
              <div className="belt-entry-line" style={{ animationDelay: '0.12s' }}>
                <span className="muted">[00:00.0]</span> &gt; 正在建立物理链路...
              </div>
              <div className="belt-entry-line" style={{ animationDelay: '0.55s' }}>
                <span className="muted">[00:00.5]</span> &gt; 解密频段... <span className="ok">[LOCK]</span>
              </div>
              <div className="belt-entry-line" style={{ animationDelay: '0.98s' }}>
                <span className="muted">[00:01.0]</span> &gt; 握手成功 <span className="ok">[OK]</span>
              </div>
              <div className="belt-entry-line" style={{ animationDelay: '1.25s' }}>
                <span className="muted">[00:01.3]</span> ROUTE: <span className="ok">BELT-07</span>
              </div>
            </div>
            <div className="belt-entry-bar">
              <span />
            </div>
            {error ? (
              <div className="belt-error mt-3">
                <code>LINK_ERROR</code> {error}
                <button type="button" className="belt-button ml-auto" onClick={() => setOpen(false)}>
                  关闭
                </button>
              </div>
            ) : null}
            {elapsed && !handoff && !error ? (
              <p className="mt-2 text-[10px] text-[var(--ef-ink-2)]">等待链路确认…</p>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
