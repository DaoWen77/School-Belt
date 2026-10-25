'use client';

import { useEffect, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import { IdentityBadges } from '@/components/im/IdentityBadges';

type FriendStatus = 'pending' | 'accepted' | 'rejected' | 'blocked' | 'removed';
type Surface = 'internal' | 'belt' | 'bridge';

interface FriendUser {
  id: string;
  handle: string;
  displayName: string;
  prefixes: string[];
}

interface FriendshipView {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendStatus;
  surface: Surface;
  contextPostId: string | null;
  requestNote: string | null;
  dmChannelId: string | null;
  requestedAt: string;
  respondedAt: string | null;
  peer: FriendUser;
}

interface FriendData {
  friends: FriendshipView[];
  incoming: FriendshipView[];
  outgoing: FriendshipView[];
  blocked: FriendshipView[];
}

type PageError = { code: string; message: string };

const PANEL = 'cut-corner-sm border border-line bg-panel p-4';
const HEADING = 'mb-2 font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-2';
const FIELD = 'w-full border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink';
const BUTTON = 'cut-corner-sm bg-ink px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40';
const SECONDARY = 'border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-ink hover:text-ink';

/**
 * Phase D 好友链路面板。
 * 同意后服务端才创建 DM；这里只调用好友 API，不直接建会话。
 */
export function FriendsSettings({ me }: { me: { id: string } | null }) {
  const [data, setData] = useState<FriendData | null>(null);
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PageError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      const next = await api<FriendData>('/friendships');
      setData({
        friends: next.friends ?? [],
        incoming: next.incoming ?? [],
        outgoing: next.outgoing ?? [],
        blocked: next.blocked ?? [],
      });
    } catch (caught) {
      setError(errorOf(caught));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (work: () => Promise<unknown>, message?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (message) setNotice(message);
      await load();
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const request = () => {
    if (!handle.trim()) return;
    void run(
      () =>
        api('/friendships/requests', {
          method: 'POST',
          body: JSON.stringify({ handle: handle.trim(), ...(note.trim() ? { note: note.trim() } : {}) }),
        }),
      `已向 @${handle.trim()} 发出好友链路申请。`,
    );
    setHandle('');
    setNote('');
  };

  const respond = (row: FriendshipView, action: 'accept' | 'reject' | 'block') => {
    void run(
      () =>
        api(`/friendships/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ action }),
        }),
      action === 'accept'
        ? `已与 @${row.peer.handle} 建立好友链路，私聊已出现在侧边栏。`
        : action === 'reject'
          ? '已拒绝该申请。'
          : '已阻断该链路。',
    );
  };

  const remove = (row: FriendshipView) => {
    if (!window.confirm(`解除与 @${row.peer.handle} 的好友链路？历史私聊将只读。`)) return;
    void run(
      () => api(`/friendships/${row.id}`, { method: 'DELETE' }),
      '好友链路已解除。',
    );
  };

  return (
    <section id="tab-friends" className={PANEL}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className={HEADING}>Friendship / 好友链路</p>
        <span className="border border-line px-1 font-sans text-[9px] uppercase tracking-[0.1em] text-ink-2">
          DM requires accepted link
        </span>
      </div>

      <p className="mb-3 border-l-2 border-ink pl-2 text-[10px] leading-relaxed text-ink-2">
        发起私聊前必须通过好友申请。同意后服务端才会创建私聊会话；群聊不受此限制。
      </p>

      {error ? (
        <p className="mb-2 flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink" role="alert">
          <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{error.code}</span>
          {error.message}
          <button type="button" className="ml-auto text-[10px] underline" onClick={() => setError(null)}>
            关闭
          </button>
        </p>
      ) : null}
      {notice ? <p className="mb-2 border border-line bg-chip px-2 py-1.5 text-[11px] text-ink">{notice}</p> : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 sm:col-span-1">
          <span className={HEADING}>精确 handle</span>
          <input className={FIELD} value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="例如 chen" aria-label="好友 handle" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={HEADING}>附言（可选）</span>
          <input className={FIELD} value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="说明这次链路的目的" aria-label="好友申请附言" />
        </label>
      </div>
      <button type="button" className={`${BUTTON} mt-2`} disabled={busy || !handle.trim()} onClick={request}>
        {busy ? '发送中…' : '发送好友申请'}
      </button>

      {!data ? (
        <p className="mt-3 text-[11px] text-ink-2">读取好友链路…</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {data.incoming.length > 0 ? (
            <div>
              <p className={HEADING}>收到的申请 / INCOMING</p>
              <ul className="flex flex-col">
                {data.incoming.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                    <IdentityBadges values={row.peer.prefixes} />
                    <span className="font-semibold text-ink">{row.peer.displayName}</span>
                    <span className="font-mono text-[9px] text-ink-2">@{row.peer.handle}</span>
                    <span className="border border-line px-1 text-[8px] uppercase text-ink-2">{row.surface}</span>
                    {row.requestNote ? <span className="truncate text-ink-2">「{row.requestNote}」</span> : null}
                    <span className="ml-auto flex gap-2">
                      <button type="button" className="text-[10px] text-ink underline" onClick={() => respond(row, 'accept')}>
                        同意
                      </button>
                      <button type="button" className="text-[10px] text-danger underline" onClick={() => respond(row, 'reject')}>
                        拒绝
                      </button>
                      <button type="button" className="text-[10px] text-ink-2 underline" onClick={() => respond(row, 'block')}>
                        阻断
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.outgoing.length > 0 ? (
            <div>
              <p className={HEADING}>发出的申请 / OUTGOING</p>
              <ul className="flex flex-col">
                {data.outgoing.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                    <span className="font-semibold text-ink">{row.peer.displayName}</span>
                    <span className="font-mono text-[9px] text-ink-2">@{row.peer.handle}</span>
                    <span className="border border-line px-1 text-[8px] uppercase text-ink-2">{row.surface}</span>
                    <span className="ml-auto text-[10px] text-ink-2">等待对方确认</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <p className={HEADING}>已建立 / FRIENDS</p>
            <ul className="flex flex-col">
              {data.friends.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-[11px] last:border-b-0">
                  <IdentityBadges values={row.peer.prefixes} />
                  <span className="font-semibold text-ink">{row.peer.displayName}</span>
                  <span className="font-mono text-[9px] text-ink-2">@{row.peer.handle}</span>
                  <span className="border border-line px-1 text-[8px] uppercase text-ink-2">
                    {row.surface === 'bridge' ? 'BRIDGE' : row.surface}
                  </span>
                  <span className="text-[9px] text-ink-2">{row.dmChannelId ? '私聊已建立' : '无会话'}</span>
                  <button type="button" className="ml-auto text-[10px] text-danger underline" onClick={() => remove(row)}>
                    解除
                  </button>
                </li>
              ))}
              {data.friends.length === 0 ? <li className="text-[11px] text-ink-2">还没有已建立的好友链路</li> : null}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
