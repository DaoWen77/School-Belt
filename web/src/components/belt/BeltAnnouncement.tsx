'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { beltApi } from '@/lib/beltApi';

type Level = 'info' | 'warning' | 'critical';

interface Announcement {
  id: string;
  body: string;
  level?: string;
}

const DISMISS_KEY = 'dj-belt-announcement-dismissed';
const ACK_KEY = 'dj-belt-announcement-ack';

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * 环塔顶部全服公告（功能大搬家后公告移到外网）。
 * info = 顶部滚动弹幕；warning = 横幅；critical = 全屏强弹窗（按 id 记录已确认）。
 */
export function BeltAnnouncement({ refreshKey = 0 }: { refreshKey?: number }) {
  const [item, setItem] = useState<Announcement | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [ackId, setAckId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    beltApi<{ announcement: Announcement | null }>('/belt/announcement')
      .then((data) => {
        setItem(data.announcement ?? null);
        setDismissedId(readKey(DISMISS_KEY));
        setAckId(readKey(ACK_KEY));
      })
      .catch(() => setItem(null));
  }, [refreshKey]);

  if (!item) return null;

  const level: Level = item.level === 'warning' || item.level === 'critical' ? item.level : 'info';
  const dismiss = () => {
    setDismissedId(item.id);
    writeKey(DISMISS_KEY, item.id);
  };
  const acknowledge = () => {
    setAckId(item.id);
    writeKey(ACK_KEY, item.id);
  };

  if (level === 'critical') {
    if (ackId === item.id) return null;
    const node = (
      <div className="belt-ann-critical" role="alertdialog" aria-modal="true" aria-label="紧急全服公告">
        <div className="belt-ann-critical-card">
          <p className="belt-page-kicker">CRITICAL // 紧急公告</p>
          <p className="belt-ann-critical-body">{item.body}</p>
          {/* 确认是唯一且中性的出口：不用危险色诱导 */}
          <button type="button" className="belt-button is-signal" onClick={acknowledge}>
            我知道了
          </button>
        </div>
      </div>
    );
    return mounted ? createPortal(node, document.body) : null;
  }

  if (dismissedId === item.id) return null;

  if (level === 'warning') {
    return (
      <div className="belt-ann-warning" role="alert">
        <span className="belt-ann-kicker">警示 / WARNING</span>
        <p>{item.body}</p>
        <button type="button" className="belt-ann-close" aria-label="关闭全服公告" onClick={dismiss}>
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="belt-ann-marquee" role="status">
      <span className="belt-ann-kicker">全服公告 / ANNOUNCEMENT</span>
      <div className="belt-ann-track">
        <p>{item.body}</p>
      </div>
      <button type="button" className="belt-ann-close" aria-label="关闭全服公告" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
