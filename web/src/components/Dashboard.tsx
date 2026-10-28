'use client';

import { useEffect, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import { session } from '@/lib/session';
import type { ApiUser } from '@/lib/types';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { ArchiveView } from '@/components/im/ArchiveView';
import { ActivityRadar } from '@/components/im/ActivityRadar';
import { BeltEntryButton } from '@/components/im/BeltEntryButton';

interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  lastActiveAt: string | null;
}

/**
 * O.M.V 工作台 · 站长指挥中枢。
 * 取代旧聊天室主页：只保留档案库、活跃度雷达、IoT 设备面板，以及接入环塔的巨型入口。
 */
export function Dashboard() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    if (!session.hasTokens()) {
      window.location.replace('/login');
      return;
    }
    api<{ user: ApiUser }>('/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));

    api<{ devices: DeviceRow[] }>('/device')
      .then((data) => setDevices(data.devices ?? []))
      .catch((caught) => setError(errorOf(caught).message));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setBooted(true), 120);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-paper/95 px-5 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold tracking-[0.2em] text-signal">
            AURORA TECH · COMMAND HUB
          </p>
          <h1 className="text-lg font-black leading-tight tracking-tight">O.M.V 工作台</h1>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <IdentityBadges values={user.prefixes ?? []} />
              <span className="font-mono text-[11px] text-ink-2">@{user.handle}</span>
            </>
          ) : null}
          <BeltEntryButton />
        </div>
      </header>

      {/* 主体：指挥中枢三面板 */}
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-5 py-5 lg:grid-cols-3">
        {/* 档案库 */}
        <section className={`lg:col-span-2 motion-view ${booted ? '' : 'opacity-0'}`}>
          <div className="mb-2 flex items-baseline justify-between border-b border-line pb-2">
            <h2 className="font-black tracking-tight">站长档案库</h2>
            <span className="font-mono text-[10px] text-ink-2">ARCHIVE / 素材与任务</span>
          </div>
          <ArchiveView />
        </section>

        {/* 右侧：活跃度 + IoT */}
        <div className="flex flex-col gap-4">
          <section className="border border-line bg-panel p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-black tracking-tight">团队活跃度</h2>
              <span className="font-mono text-[10px] text-ink-2">RADAR / 7D</span>
            </div>
            <div className="h-64">
              <ActivityRadar />
            </div>
          </section>

          <section className="border border-line bg-panel p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-black tracking-tight">IoT 设备</h2>
              <span className="font-mono text-[10px] text-ink-2">{devices.length} ONLINE</span>
            </div>
            {error ? <p className="text-[11px] text-danger">{error}</p> : null}
            {devices.length === 0 && !error ? (
              <p className="py-6 text-center text-[11px] text-ink-2">
                暂无绑定设备。ESP32 用 6 位绑定码接入。
              </p>
            ) : null}
            <ul className="flex flex-col gap-1.5">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between border-b border-line/60 pb-1.5 text-[12px]"
                >
                  <span className="font-medium">{device.name}</span>
                  <span className="font-mono text-[10px] text-ink-2">
                    {device.platform}
                    {device.lastActiveAt ? ` · ${new Date(device.lastActiveAt).toLocaleString()}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      {/* 巨型接入按钮（若顶栏入口不够醒目） */}
      <footer className="mx-auto max-w-6xl px-5 pb-10">
        <div className="flex flex-col items-center gap-3 border-t border-line pt-6">
          <p className="font-mono text-[10px] tracking-[0.2em] text-ink-2">
            CIVILIZATION BELT · 环塔
          </p>
          <BeltEntryButton />
        </div>
      </footer>
    </div>
  );
}
