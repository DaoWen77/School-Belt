'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { beltApi, BeltApiError } from '@/lib/beltApi';
import type { BeltBondCard, BeltBondType, BeltBonds } from '@/lib/beltTypes';
import { BeltAvatar } from './BeltAvatar';

const TYPE_LABEL: Record<string, string> = { buddy: '死党', mentor: '大佬', partner: '搭档', pal: '搭子' };

const EMPTY: BeltBonds = { incoming: [], outgoing: [], active: [], ended: [] };

function errText(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/** 404/401/403 一律降级成页面提示，空态照常渲染，不阻塞浏览。 */
function degradeText(caught: unknown, fallback: string): string {
  if (caught instanceof BeltApiError) {
    if (caught.status === 404) return '羁绊链路尚未开放，先当作这里还没有羁绊。';
    if (caught.status === 401 || caught.status === 403) return '当前身份无法读取羁绊，稍后可刷新重试。';
  }
  return errText(caught, fallback);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN');
}

function normalize(payload: Partial<BeltBonds> | null | undefined): BeltBonds {
  const list = (value: unknown) => (Array.isArray(value) ? (value as BeltBondCard[]) : []);
  return {
    incoming: list(payload?.incoming),
    outgoing: list(payload?.outgoing),
    active: list(payload?.active),
    ended: list(payload?.ended),
  };
}

function bondLabel(bond: BeltBondCard): string {
  return bond.typeLabel || TYPE_LABEL[bond.type] || bond.type;
}

export function BeltBondsView() {
  const [data, setData] = useState<BeltBonds>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteHandle, setInviteHandle] = useState('');
  const [inviteType, setInviteType] = useState<BeltBondType>('buddy');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    beltApi<Partial<BeltBonds>>('/belt/bonds')
      .then((payload) => {
        if (cancelled) return;
        setData(normalize(payload));
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(degradeText(caught, '羁绊读取失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const act = async (bondId: string, path: string, done: string) => {
    setBusyId(bondId);
    setNotice(null);
    try {
      const result = await beltApi<{ bond?: BeltBondCard; renewedToday?: boolean; bothRenewed?: boolean }>(path, {
        method: 'POST',
      });
      setNotice(result?.bothRenewed ? '双方都已延续 · 亲密度 +5' : done);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setNotice(degradeText(caught, '羁绊操作失败'));
    } finally {
      setBusyId(null);
    }
  };

  const sendInvite = async () => {
    const handle = inviteHandle.trim().replace(/^@/, '');
    if (!handle || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    try {
      await beltApi('/belt/bonds/invite', {
        method: 'POST',
        body: JSON.stringify({ handle, type: inviteType }),
      });
      setNotice(`已向 @${handle} 发出${TYPE_LABEL[inviteType] ?? ''}羁绊邀请。`);
      setInviteOpen(false);
      setInviteHandle('');
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setInviteError(degradeText(caught, '羁绊邀请失败'));
    } finally {
      setInviteBusy(false);
    }
  };

  const identity = (bond: BeltBondCard) => (
    <div className="belt-bond-who">
      <BeltAvatar
        fileId={bond.peer?.avatarFileId}
        name={bond.peer?.displayName || bond.peer?.handle || '?'}
        size="md"
      />
      <div className="belt-bond-id">
        <b>{bond.peer?.displayName || bond.peer?.handle || '未知干员'}</b>
        <span>@{bond.peer?.handle}</span>
      </div>
      <span className="belt-stamp is-signal">{bondLabel(bond)}</span>
    </div>
  );

  const isEmpty =
    !loading && !data.active.length && !data.incoming.length && !data.outgoing.length && !data.ended.length;

  const pendingRenew = data.active.filter((bond) => !bond.renewedToday).length;

  return (
    <div className="belt-bonds">
      <header className="belt-bonds-head">
        <p className="belt-page-kicker">BONDS // 羁绊链路</p>
        <div className="belt-bonds-head-meta">
          <span className="belt-bond-pill">当前 {data.active.length}</span>
          <span className="belt-bond-pill">待处理 {data.incoming.length}</span>
          <span className="belt-bond-pill">今日待续 {pendingRenew}</span>
          <button
            type="button"
            className="belt-button is-signal"
            onClick={() => {
              setInviteError(null);
              setInviteOpen(true);
            }}
          >
            发起羁绊
          </button>
          <div className="belt-menu" ref={menuRef}>
            <button
              type="button"
              className="belt-button belt-menu-trigger"
              aria-label="羁绊操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="belt-menu-pop" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="belt-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setReloadKey((value) => value + 1);
                  }}
                >
                  刷新
                </button>
                <button type="button" role="menuitem" className="belt-menu-item" onClick={() => setMenuOpen(false)}>
                  关闭
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {error ? (
        <p className="belt-error" role="alert">
          <code>BONDS_PARTIAL</code> {error}
        </p>
      ) : null}
      {notice ? (
        <p className="belt-panel belt-hint belt-bonds-notice" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <section className="belt-panel" aria-live="polite">
          <p className="belt-hint">正在同步羁绊链路…</p>
        </section>
      ) : null}

      {!loading && data.active.length > 0 ? (
        <section className="belt-bonds-section" aria-label="当前羁绊">
          <header className="belt-bonds-section-head">
            <h2>当前羁绊</h2>
            <span>{data.active.length}</span>
          </header>
          <div className="belt-bond-list">
            {data.active.map((bond) => {
              const intimacy = Math.max(0, Math.min(100, Math.round(Number(bond.intimacy) || 0)));
              const both = Boolean(bond.bothRenewedToday);
              const mine = Boolean(bond.renewedToday);
              const peerOnly = Boolean(bond.peerRenewedToday) && !mine && !both;
              const busy = busyId === bond.id;
              return (
                <article className="belt-bond-card" key={bond.id}>
                  {identity(bond)}
                  <div className="belt-bond-intimacy">
                    <span
                      className="belt-bond-intimacy-track"
                      role="img"
                      aria-label={`亲密度 ${intimacy} / 100`}
                    >
                      <i style={{ width: `${intimacy}%` }} />
                    </span>
                    <span className="belt-bond-intimacy-num">
                      {intimacy}
                      <small>/100</small>
                    </span>
                  </div>
                  <footer className="belt-bond-foot">
                    <span className={`belt-bond-state${both ? ' is-max' : mine || peerOnly ? ' is-warm' : ''}`}>
                      {both ? '双方都已延续 +5' : mine ? '今日已延续' : peerOnly ? '对方已延续' : '今日尚未延续'}
                    </span>
                    <button
                      type="button"
                      className="belt-button is-signal"
                      disabled={both || mine || busy}
                      onClick={() => void act(bond.id, `/belt/bonds/${bond.id}/renew`, '今日延续完成')}
                    >
                      {both ? '双方已完成' : mine ? '今日已延续' : busy ? '延续中…' : '延续羁绊'}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {!loading && data.incoming.length > 0 ? (
        <section className="belt-bonds-section" aria-label="待我处理">
          <header className="belt-bonds-section-head">
            <h2>待我处理</h2>
            <span>{data.incoming.length}</span>
          </header>
          <div className="belt-bond-list">
            {data.incoming.map((bond) => (
              <article className="belt-bond-card is-pending" key={bond.id}>
                {identity(bond)}
                <p className="belt-bond-meta">邀约于 {fmtDate(bond.createdAt)}</p>
                <footer className="belt-bond-foot">
                  <span className="belt-bond-state">等待你确认</span>
                  <div className="belt-bond-actions">
                    <button
                      type="button"
                      className="belt-button is-signal"
                      disabled={busyId === bond.id}
                      onClick={() => void act(bond.id, `/belt/bonds/${bond.id}/accept`, '已同意羁绊')}
                    >
                      同意
                    </button>
                    <button
                      type="button"
                      className="belt-button"
                      disabled={busyId === bond.id}
                      onClick={() => void act(bond.id, `/belt/bonds/${bond.id}/decline`, '已婉拒邀请')}
                    >
                      婉拒
                    </button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && data.outgoing.length > 0 ? (
        <section className="belt-bonds-section" aria-label="等待对方">
          <header className="belt-bonds-section-head">
            <h2>等待对方</h2>
            <span>{data.outgoing.length}</span>
          </header>
          <div className="belt-bond-list">
            {data.outgoing.map((bond) => (
              <article className="belt-bond-card is-pending" key={bond.id}>
                {identity(bond)}
                <p className="belt-bond-meta">已于 {fmtDate(bond.createdAt)} 发出</p>
                <footer className="belt-bond-foot">
                  <span className="belt-bond-state is-warm">等待中 · 等对方确认</span>
                </footer>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && data.ended.length > 0 ? (
        <details className="belt-bonds-ended">
          <summary>
            已解除<span>{data.ended.length}</span>
          </summary>
          <div className="belt-bond-list">
            {data.ended.map((bond) => (
              <article className="belt-bond-card is-ended" key={bond.id}>
                {identity(bond)}
                <p className="belt-bond-meta">
                  结束原因：{bond.endReason || '未记录'} · {fmtDate(bond.endedAt ?? bond.createdAt)}
                </p>
              </article>
            ))}
          </div>
        </details>
      ) : null}

      {isEmpty ? (
        <section className="belt-empty belt-bonds-empty">
          <p>还没有羁绊。去频道里找人，发出第一张羁绊卡片。</p>
          <button
            type="button"
            className="belt-button is-signal"
            onClick={() => {
              setInviteError(null);
              setInviteOpen(true);
            }}
          >
            发起羁绊
          </button>
          <Link className="belt-button" href="/belt/channel">
            去频道里找人
          </Link>
        </section>
      ) : null}

      {inviteOpen ? (
        <div className="belt-modal-backdrop" role="presentation" onClick={() => !inviteBusy && setInviteOpen(false)}>
          <section
            className="belt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="发起羁绊"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="belt-page-kicker">BOND INVITE</p>
            <h2>发起羁绊</h2>
            <label className="belt-field">
              <span>对方呼号</span>
              <input
                className="belt-input"
                value={inviteHandle}
                maxLength={40}
                placeholder="@handle"
                onChange={(event) => setInviteHandle(event.target.value)}
              />
            </label>
            <div className="belt-bond-types" role="group" aria-label="关系类型">
              {(Object.keys(TYPE_LABEL) as BeltBondType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`belt-button${inviteType === type ? ' is-signal' : ''}`}
                  aria-pressed={inviteType === type}
                  onClick={() => setInviteType(type)}
                >
                  {TYPE_LABEL[type]}
                </button>
              ))}
            </div>
            {inviteError ? (
              <p className="belt-error" role="alert">
                {inviteError}
              </p>
            ) : null}
            <div className="belt-modal-actions">
              <button type="button" className="belt-button" disabled={inviteBusy} onClick={() => setInviteOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="belt-button is-signal"
                disabled={inviteBusy || !inviteHandle.trim()}
                onClick={() => void sendInvite()}
              >
                {inviteBusy ? '发送中…' : '发出邀请'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
