'use client';

import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[95] border-b border-danger/40 bg-danger px-3 py-1.5 text-center font-mono text-[11px] font-bold tracking-[0.08em] text-white">
      网络已断开 · 消息将在恢复后重发
    </div>
  );
}
