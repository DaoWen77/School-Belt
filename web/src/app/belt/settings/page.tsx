'use client';

import { ServerSettings } from '@/components/ServerSettings';

/** 文明环带设置页：登录后也可修改 API/WS 服务器地址（穿透/公网部署）。 */
export default function BeltSettingsPage() {
  return (
    <div className="belt-root">
      <div className="min-h-dvh bg-paper px-5 py-8 text-ink">
        <header className="mb-4 border-b border-line pb-3">
          <p className="font-mono text-[10px] font-bold tracking-[0.2em] text-signal">
            CIVILIZATION BELT // RELAY 07
          </p>
          <h1 className="text-2xl font-black tracking-tight">环带设置 / SETTINGS</h1>
          <p className="mt-1 text-[12px] text-ink-2">服务器地址 · 数据链路 · 身份</p>
        </header>
        <div className="mx-auto max-w-2xl">
          <ServerSettings variant="belt" />
          <p className="mt-4 text-[10px] leading-relaxed text-ink-2">
            保存后整页重载；API 与 WS 地址对环带登录、消息、实时推送同时生效。
          </p>
        </div>
      </div>
    </div>
  );
}
