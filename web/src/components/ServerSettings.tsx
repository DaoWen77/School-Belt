'use client';

import { useState } from 'react';
import { API_BASE, WS_BASE, WS_PATH, readServerSetting } from '@/lib/api';

function validHttp(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validWs(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * 公共服务器设置组件：内网登录页与环塔登录页共用。
 * 写 localStorage 的 dj-server-api / dj-server-ws，api.ts / beltApi.ts 都从这里读取。
 */
export function ServerSettings({ variant = 'internal' }: { variant?: 'internal' | 'belt' }) {
  const [open, setOpen] = useState(false);
  const [serverApi, setServerApi] = useState(() => readServerSetting('api'));
  const [serverWs, setServerWs] = useState(() => readServerSetting('ws'));
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; status?: number; latencyMs?: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const testServer = async () => {
    const base = (serverApi.trim() || API_BASE).replace(/\/+$/, '');
    if (!validHttp(base)) {
      setError('API 地址必须是 http/https');
      return;
    }
    setError(null);
    setTesting(true);
    setTest(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const started = performance.now();
    try {
      const response = await fetch(`${base}/readyz`, { cache: 'no-store', signal: controller.signal });
      setTest({
        ok: response.ok,
        status: response.status,
        latencyMs: Math.round(performance.now() - started),
        message: response.ok ? '连接成功' : `HTTP ${response.status}`,
      });
    } catch (caught) {
      setTest({
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        message: controller.signal.aborted ? '超时（5s）' : caught instanceof Error ? caught.message : '连接失败',
      });
    } finally {
      window.clearTimeout(timer);
      setTesting(false);
    }
  };

  const saveServer = () => {
    const apiValue = serverApi.trim().replace(/\/+$/, '');
    const wsValue = serverWs.trim().replace(/\/+$/, '');
    if (apiValue && !validHttp(apiValue)) {
      setError('API 地址必须是 http/https');
      return;
    }
    if (wsValue && !validWs(wsValue)) {
      setError('WS 地址必须是 http/https/ws/wss');
      return;
    }
    try {
      if (apiValue) window.localStorage.setItem('dj-server-api', apiValue);
      else window.localStorage.removeItem('dj-server-api');
      if (wsValue) window.localStorage.setItem('dj-server-ws', wsValue);
      else window.localStorage.removeItem('dj-server-ws');
      window.location.reload();
    } catch {
      setError('浏览器禁止写入 localStorage');
    }
  };

  const resetServer = () => {
    try {
      window.localStorage.removeItem('dj-server-api');
      window.localStorage.removeItem('dj-server-ws');
      window.location.reload();
    } catch {
      setError('浏览器禁止操作 localStorage');
    }
  };

  const field = 'w-full border border-line bg-paper px-2.5 py-2 text-[13px] text-ink outline-none focus:border-ink';
  const label = 'block font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-2';

  return (
    <div className="mb-3 border border-line bg-panel p-2.5">
      <button
        type="button"
        className="flex w-full items-center justify-between font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-ink"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        服务器设置 / Server
        <span className="text-ink-2">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="mt-2">
          <p className="mb-2 font-mono text-[9px] leading-relaxed text-ink-2">
            {variant === 'belt'
              ? '手机穿透测试：API 与 WS 都填 ofalias 给 3000 端口映射的公网 http 地址（TCP 隧道下 Socket.IO 会自动升级）。'
              : '当前 '}
            {API_BASE}
            <br />
            PATH {WS_PATH}
          </p>
          <label className="mb-2 flex flex-col gap-1">
            <span className={label}>API Base URL</span>
            <input
              className={field}
              value={serverApi}
              onChange={(event) => setServerApi(event.target.value)}
              placeholder={API_BASE}
              aria-label="API Base URL"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="mb-2 flex flex-col gap-1">
            <span className={label}>WS URL（空 = 沿用 API host）</span>
            <input
              className={field}
              value={serverWs}
              onChange={(event) => setServerWs(event.target.value)}
              placeholder={WS_BASE}
              aria-label="WS URL"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => void testServer()} disabled={testing} className="cut-corner-sm border border-line px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 hover:border-ink hover:text-ink disabled:opacity-40">
              {testing ? '测试中…' : '测试连接'}
            </button>
            <button type="button" onClick={saveServer} className="cut-corner-sm bg-accent px-2.5 py-1.5 text-[11px] font-bold text-on-accent">
              保存并重载
            </button>
            <button type="button" onClick={resetServer} className="cut-corner-sm border border-line px-2.5 py-1.5 text-[11px] text-ink-2">
              恢复默认
            </button>
          </div>
          {test ? (
            <p className={`mt-2 break-all text-[10px] ${test.ok ? 'text-ink-2' : 'text-danger'}`} role="status">
              {test.ok ? '✓' : '✕'} {test.message}
              {typeof test.status === 'number' ? ` · HTTP ${test.status}` : ''}
              {typeof test.latencyMs === 'number' ? ` · ${test.latencyMs}ms` : ''}
            </p>
          ) : null}
          {error ? <p className="mt-1 text-[10px] text-danger" role="alert">{error}</p> : null}
          <p className="mt-2 text-[9px] leading-relaxed text-ink-2">测试只 GET /readyz，不保存；保存后整页重载。空值 = 环境变量或同源。</p>
        </div>
      ) : null}
    </div>
  );
}
