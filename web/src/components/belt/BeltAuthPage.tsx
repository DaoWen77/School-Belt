'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { beltApi, BeltApiError, type BeltAuthResult } from '@/lib/beltApi';
import { beltSession } from '@/lib/beltSession';
import { ServerSettings } from '@/components/ServerSettings';

export function BeltAuthPage({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('/belt/channel');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const raw = query.get('next') ?? '';
    if (raw.startsWith('/belt')) setNext(raw);
    if (beltSession.hasTokens()) router.replace(raw.startsWith('/belt') ? raw : '/belt/channel');
  }, [router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await beltApi<BeltAuthResult>(
        mode === 'login' ? '/belt/auth/login' : '/belt/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({
            handle: handle.trim(),
            password,
            ...(mode === 'register' ? { displayName: displayName.trim() } : {}),
          }),
        },
      );
      beltSession.setTokens(data.accessToken, data.refreshToken);
      router.replace(next);
    } catch (caught) {
      if (caught instanceof BeltApiError) setError({ code: caught.code, message: caught.message });
      else setError({ code: 'LINK_ERROR', message: caught instanceof Error ? caught.message : '接入失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="belt-root">
      <div className="belt-gate">
        <div className="belt-gate-panel">
          <p className="belt-gate-kicker">CIVILIZATION BELT // RELAY 07</p>
          <h1>
            CIVILIZATION
            <small>{mode === 'login' ? '环带身份接入 / EXTERNAL LINK' : '申请环带身份 / NEW CALLSIGN'}</small>
          </h1>

          <form className="belt-gate-form" onSubmit={submit}>
            <label className="belt-field">
              <span>CALLSIGN / 呼号</span>
              <input
                className="belt-input"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                autoComplete="username"
                maxLength={24}
                placeholder="小写字母、数字、下划线"
                required
              />
            </label>
            {mode === 'register' ? (
              <label className="belt-field">
                <span>DISPLAY NAME / 显示名</span>
                <input
                  className="belt-input"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="nickname"
                  maxLength={40}
                  placeholder="外环识别名"
                  required
                />
              </label>
            ) : null}
            <label className="belt-field">
              <span>PASSPHRASE / 口令</span>
              <input
                className="belt-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="至少 8 位"
                required
              />
            </label>

            {error ? (
              <p className="belt-error" role="alert">
                <code>{error.code}</code> {error.message}
              </p>
            ) : null}

            <button
              type="submit"
              className="belt-button is-signal"
              disabled={busy || !handle.trim() || password.length < 8 || (mode === 'register' && !displayName.trim())}
            >
              {busy ? '正在握手…' : mode === 'login' ? '建立环带链路' : '申请接入'}
            </button>
          </form>

          <div className="belt-gate-foot">
            {mode === 'login' ? (
              <>
                <span>没有环带身份？</span>
                <Link href={`/belt/register?next=${encodeURIComponent(next)}`}>申请接入</Link>
              </>
            ) : (
              <>
                <span>已有环带身份？</span>
                <Link href={`/belt/login?next=${encodeURIComponent(next)}`}>返回登录</Link>
              </>
            )}
            <span>·</span>
            <span>内部账号请从舰内入口【接入文明环带】进入。</span>
          </div>

          <div className="mt-3">
            <ServerSettings variant="belt" />
          </div>
        </div>
      </div>
    </div>
  );
}
