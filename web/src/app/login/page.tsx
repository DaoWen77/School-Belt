'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE, WS_BASE, WS_PATH, api, errorOf } from '@/lib/api';
import { ServerSettings } from '@/components/ServerSettings';
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

        <ServerSettings />

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
