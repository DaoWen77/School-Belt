'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** 全服公告 banner：GET /announcements/current；按 id 记录关闭，不重复骚扰。 */
export function AnnouncementBanner() {
  const [item, setItem] = useState<{ id: string; body: string; title?: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void api<unknown>('/announcements/current')
      .then((data) => {
        const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
        const raw = (record.announcement ?? record) as Record<string, unknown>;
        const body = typeof raw.body === 'string' ? raw.body : typeof raw.content === 'string' ? raw.content : '';
        const id = typeof raw.id === 'string' ? raw.id : '';
        if (!body || !id) return;
        setItem({ id, body, title: typeof raw.title === 'string' ? raw.title : undefined });
        try {
          setDismissed(window.localStorage.getItem('dj-announcement-dismissed') === id);
        } catch {
          setDismissed(false);
        }
      })
      .catch(() => undefined);
  }, []);

  if (!item || dismissed) return null;

  return (
    <div className="motion-banner-in flex shrink-0 items-start gap-2 border-b border-ink bg-accent px-3 py-1.5 text-on-accent md:px-5">
      <span className="mt-0.5 shrink-0 border border-ink px-1 font-sans text-[9px] font-bold uppercase tracking-[0.08em]">公告</span>
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-[11px] leading-relaxed">{item.title ? `${item.title}：` : ''}{item.body}</p>
      <button
        type="button"
        aria-label="关闭全服公告"
        className="shrink-0 px-1 text-[14px] font-bold"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem('dj-announcement-dismissed', item.id);
          } catch {
            /* ignore */
          }
        }}
      >
        ×
      </button>
    </div>
  );
}
