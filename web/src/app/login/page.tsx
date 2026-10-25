'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE, WS_BASE, WS_PATH, api, errorOf, readServerSetting } from '@/lib/api';
import { session } from '@/lib/session';

type Mode = 'login' | 'register';
interface FormError {
  code: string;
  message: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverApi, setServerApi] = useState(() => readServerSetting('api'));
  const [serverWs, setServerWs] = useState(() => readServerSetting('ws'));
  const [serverTesting, setServerTesting] = useState(false);
  const [serverTest, setServerTest] = useState<{ ok: boolean; status?: number; latencyMs?: number; message: string } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (session.hasTokens()) router.replace('/');
  }, [router]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const validHttp = (value: string) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const validWs = (value: string) => {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  const testServer = async () => {
    const base = (serverApi.trim() || API_BASE).replace(/\/+$/, '');
    if (!validHttp(base)) {
      setServerTest(null);
      setServerError('API 地址必须是 http/https');
      return;
    }
    setServerError(null);
    setServerTesting(true);
    setServerTest(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const started = performance.now();
    try {
      const response = await fetch(`${base}/readyz`, { cache: 'no-store', signal: controller.signal });
      setServerTest({
        ok: response.ok,
        status: response.status,
        latencyMs: Math.round(performance.now() - started),
        message: response.ok ? '连接成功' : `HTTP ${response.status}`,
      });
    } catch (caught) {
      setServerTest({
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        message: controller.signal.aborted ? '超时（5s）' : caught instanceof Error ? caught.message : '连接失败',
      });
    } finally {
      window.clearTimeout(timer);
      setServerTesting(false);
    }
  };

  const saveServer = () => {
    const apiValue = serverApi.trim().replace(/\/+$/, '');
    const wsValue = serverWs.trim().replace(/\/+$/, '');
    if (apiValue && !validHttp(apiValue)) {
      setServerError('API 地址必须是 http/https');
      return;
    }
    if (wsValue && !validWs(wsValue)) {
      setServerError('WS 地址必须是 http/https/ws/wss');
      return;
    }
    try {
      if (apiValue) window.localStorage.setItem('dj-server-api', apiValue);
      else window.localStorage.removeItem('dj-server-api');
      if (wsValue) window.localStorage.setItem('dj-server-ws', wsValue);
      else window.localStorage.removeItem('dj-server-ws');
      window.location.reload();
    } catch {
      setServerError('浏览器禁止写入 localStorage');
    }
  };

  const resetServer = () => {
    try {
      window.localStorage.removeItem('dj-server-api');
      window.localStorage.removeItem('dj-server-ws');
      window.location.reload();
    } catch {
      setServerError('浏览器禁止操作 localStorage');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login'
          ? { handle: handle.trim(), password }
          : { handle: handle.trim(), password, displayName: displayName.trim() || handle.trim(), inviteCode: inviteCode.trim() };
      const result = await api<{ accessToken: string; refreshToken: string }>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      session.setTokens(result.accessToken, result.refreshToken);
      try {
        window.sessionStorage.setItem('dj-login-wipe', '1');
      } catch {
        /* ignore */
      }
      setGranted(true);
      window.setTimeout(() => router.replace('/'), 420);
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full border border-line bg-paper px-2.5 py-2 text-[13px] text-ink outline-none focus:border-ink';
  const label = 'block font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-2';

  return (
    <div className="relative grid min-h-dvh place-items-center bg-paper px-4 py-10 text-ink">
      <div className="motion-login-bg" aria-hidden="true" />
      <div className="motion-tri pointer-events-none fixed left-0 right-0 top-0 z-[5]" aria-hidden="true">
        <i style={{ background: '#161616' }} />
        <i />
        <i />
      </div>
      {granted ? (
        <div className="motion-granted" role="status" aria-live="assertive">
          <span>ACCESS GRANTED / 链路已建立</span>
        </div>
      ) : null}
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-ink-2">
            <span>DIJIANG / BROADCAST</span>
            <span className="motion-clock">{now.toLocaleDateString('zh-CN')} {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
          </div>
          <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-2">Invite only / 邀请制</p>
          <h1 className="motion-login-title mt-1 font-sans text-4xl font-extrabold leading-none tracking-tight">帝江号</h1>
          <p className="mt-1 font-sans text-[10px] uppercase tracking-[0.24em] text-ink-2">Dijiang / Broadcast</p>
        </div>

        <div className="mb-3 border border-line bg-panel">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left"
            aria-expanded={serverOpen}
            aria-controls="server-settings"
            onClick={() => setServerOpen((value) => !value)}
          >
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">服务器设置 / Server</span>
            <span className="text-[11px] text-ink-2">{serverOpen ? '−' : '+'}</span>
          </button>
          {serverOpen ? (
            <div id="server-settings" className="border-t border-line px-3 py-2.5">
              <p className="mb-2 break-all font-mono text-[9px] text-ink-2">
                当前 API {API_BASE}
                <br />
                当前 WS {WS_BASE}
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
                <button
                  type="button"
                  onClick={() => void testServer()}
                  disabled={serverTesting}
                  className="cut-corner-sm border border-line px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 hover:border-ink hover:text-ink disabled:opacity-40"
                >
                  {serverTesting ? '测试中…' : '测试连接'}
                </button>
                <button type="button" onClick={saveServer} className="cut-corner-sm bg-ink px-2.5 py-1.5 text-[11px] font-bold text-white">
                  保存并重载
                </button>
                <button type="button" onClick={resetServer} className="cut-corner-sm border border-line px-2.5 py-1.5 text-[11px] text-ink-2">
                  恢复默认
                </button>
              </div>
              {serverTest ? (
                <p className={`mt-2 break-all text-[10px] ${serverTest.ok ? 'text-ink-2' : 'text-danger'}`} role="status">
                  {serverTest.ok ? '✓' : '✕'} {serverTest.message}
                  {typeof serverTest.status === 'number' ? ` · HTTP ${serverTest.status}` : ''}
                  {typeof serverTest.latencyMs === 'number' ? ` · ${serverTest.latencyMs}ms` : ''}
                </p>
              ) : null}
              {serverError ? <p className="mt-1 text-[10px] text-danger" role="alert">{serverError}</p> : null}
              <p className="mt-2 text-[9px] leading-relaxed text-ink-2">测试只 GET /readyz，不保存；保存后整页重载，登录/WS/AI 代理使用新地址。空值 = 环境变量或同源。</p>
            </div>
          ) : null}
        </div>

        <div className="cut-corner border border-ink bg-panel p-4">
          <div className="mb-3 flex gap-1.5" role="group" aria-label="登录或注册">
            <button
              type="button"
              aria-pressed={mode === 'login'}
              onClick={() => switchMode('login')}
              className={`cut-corner-sm px-3 py-1.5 text-[12px] font-bold ${mode === 'login' ? 'bg-accent text-on-accent' : 'border border-line text-ink-2 hover:border-ink hover:text-ink'}`}
            >
              登录
            </button>
            <button
              type="button"
              aria-pressed={mode === 'register'}
              onClick={() => switchMode('register')}
              className={`cut-corner-sm px-3 py-1.5 text-[12px] font-bold ${mode === 'register' ? 'bg-accent text-on-accent' : 'border border-line text-ink-2 hover:border-ink hover:text-ink'}`}
            >
              邀请码注册
            </button>
          </div>

          <form className="motion-login-form flex flex-col gap-3" onSubmit={submit}>
            <label className="flex flex-col gap-1">
              <span className={label}>账号 handle</span>
              <input className={field} value={handle} onChange={(event) => setHandle(event.target.value)} autoComplete="username" required placeholder="chen" spellCheck={false} />
            </label>
            {mode === 'register' ? (
              <label className="flex flex-col gap-1">
                <span className={label}>显示名</span>
                <input className={field} value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={40} placeholder="陈工" />
              </label>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className={label}>密码</span>
              <input
                className={field}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 8 : undefined}
                placeholder={mode === 'register' ? '至少 8 位' : ''}
              />
            </label>
            {mode === 'register' ? (
              <label className="flex flex-col gap-1">
                <span className={label}>邀请码</span>
                <input className={field} value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="off" required placeholder="XXXX-XXXX" spellCheck={false} />
              </label>
            ) : null}

            {error ? (
              <p className="flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink" role="alert">
                <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase tracking-[0.06em] text-on-accent">{error.code}</span>
                <span className="min-w-0 flex-1">{error.message}</span>
              </p>
            ) : null}

            <button type="submit" disabled={busy || !handle.trim() || !password} className="cut-corner-sm mt-1 bg-ink px-3 py-2 text-[13px] font-bold text-white disabled:bg-chip disabled:text-ink-2 disabled:opacity-100">
              {busy ? '接入中…' : mode === 'login' ? '登录' : '注册并登录'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-ink-2">
          密码至少 8 位；注册需要有效邀请码。失败时原样显示服务端错误码（AUTH_INVALID / INVITE_INVALID / RATE_LIMITED…）。
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] text-ink-2/80">
          <span>API {API_BASE}</span>
          <span>WS {WS_BASE}</span>
          <span>PATH {WS_PATH}</span>
        </div>
      </div>
    </div>
  );
}
