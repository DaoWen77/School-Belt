'use client';

import { useEffect, useState } from 'react';
import { beltApi } from '@/lib/beltApi';

/** 文明环带顶部全服公告（功能大搬家后公告移到外网）。 */
export function BeltAnnouncement() {
  const [item, setItem] = useState<{ id: string; body: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    beltApi<{ announcement: { id: string; body: string } | null }>('/belt/announcement')
      .then((data) => {
        if (!data.announcement) return;
        try {
          if (window.localStorage.getItem('dj-belt-announcement-dismissed') === data.announcement.id) {
            return;
          }
        } catch {
          /* ignore */
        }
        setItem(data.announcement);
      })
      .catch(() => setItem(null));
  }, []);

  if (!item || dismissed) return null;

  return (
    <div className="belt-announcement" role="status">
      <span className="belt-announcement-kicker">全服公告 / ANNOUNCEMENT</span>
      <p>{item.body}</p>
      <button
        type="button"
        aria-label="关闭全服公告"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem('dj-belt-announcement-dismissed', item.id);
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
