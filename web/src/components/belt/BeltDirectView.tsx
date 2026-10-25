'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { beltApi, connectBeltSocket, type BeltUser } from '@/lib/beltApi';
import type {
  BeltDmConversation,
  BeltFriendView,
  BeltFriends,
} from '@/lib/beltTypes';
import type { Message } from '@/lib/types';
import { randomUuid } from '@/lib/uuid';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltAvatar } from './BeltAvatar';

function clockOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function BeltDirectView({ user }: { user: BeltUser }) {
  const [friends, setFriends] = useState<BeltFriends | null>(null);
  const [conversations, setConversations] = useState<BeltDmConversation[]>([]);
  const [selected, setSelected] = useState<BeltDmConversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const socket = useRef<ReturnType<typeof connectBeltSocket>>(null);
  const selectedRef = useRef<BeltDmConversation | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  selectedRef.current = selected;

  const load = async () => {
    try {
      const [friendData, dmData] = await Promise.all([
        beltApi<BeltFriends>('/belt/friendships'),
        beltApi<{ conversations: BeltDmConversation[] }>('/belt/conversations'),
      ]);
      setFriends(friendData);
      setConversations(dmData.conversations ?? []);
      if (selectedRef.current) {
        const still = (dmData.conversations ?? []).find((row) => row.id === selectedRef.current?.id);
        if (!still) {
          setSelected(null);
          setMessages([]);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '链路读取失败');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    socket.current = connectBeltSocket(
      () => undefined,
      undefined,
      (payload) => {
        const data = payload as { channelId?: string; message?: Message };
        if (!data?.channelId || !data.message) return;
        if (selectedRef.current?.id !== data.channelId) return;
        setMessages((previous) =>
          previous.some((message) => message.id === data.message!.id)
            ? previous
            : [...previous, data.message!],
        );
      },
      () => void load(),
    );
    return () => {
      socket.current?.disconnect();
      socket.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const open = async (conversation: BeltDmConversation) => {
    setSelected(conversation);
    setError(null);
    try {
      const data = await beltApi<{ messages: Message[] }>(`/belt/conversations/${conversation.id}/messages`);
      setMessages(data.messages ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '私聊读取失败');
    }
  };

  const request = async () => {
    if (!handle.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await beltApi('/belt/friendships/requests', {
        method: 'POST',
        body: JSON.stringify({ handle: handle.trim(), ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      setNotice(`已向 @${handle.trim()} 发出链路申请。对方同意后才会生成私聊。`);
      setHandle('');
      setNote('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '申请失败');
    } finally {
      setBusy(false);
    }
  };

  const respond = async (row: BeltFriendView, action: 'accept' | 'reject' | 'block') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await beltApi(`/belt/friendships/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      setNotice(action === 'accept' ? `已与 @${row.peer.handle} 建立链路。` : '链路状态已更新。');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await beltApi<{ message: Message }>(`/belt/conversations/${selected.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: draft.trim(), clientMsgId: randomUuid() }),
      });
      setMessages((previous) =>
        previous.some((message) => message.id === data.message.id) ? previous : [...previous, data.message],
      );
      setDraft('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  const clearChat = async () => {
    if (!selected || busy) return;
    if (!window.confirm('清空这段私聊记录？只对你的账号隐藏，对方仍可看到。')) return;
    setBusy(true);
    setError(null);
    try {
      await beltApi(`/belt/conversations/${selected.id}/messages`, { method: 'DELETE' });
      setMessages([]);
      setNotice('本地链路记录已清空。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '清空失败');
    } finally {
      setBusy(false);
    }
  };

  const manageFriend = async (action: 'block' | 'remove') => {
    if (!selected || busy) return;
    const copy = action === 'block' ? '拉黑后不再接收对方消息，也不能再发送。' : '删除好友后这段私聊链路会关闭。';
    if (!window.confirm(copy)) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'block') {
        await beltApi(`/belt/friendships/${selected.friendshipId}`, {
          method: 'PATCH',
          body: JSON.stringify({ action: 'block' }),
        });
      } else {
        await beltApi(`/belt/friendships/${selected.friendshipId}`, { method: 'DELETE' });
      }
      setSelected(null);
      setMessages([]);
      setNotice(action === 'block' ? '已拉黑该链路。' : '好友已删除。');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const recall = async (message: Message) => {
    if (!selected || busy) return;
    setBusy(true);
    setMenuId(null);
    try {
      await beltApi(`/belt/conversations/${selected.id}/messages/${message.id}`, { method: 'DELETE' });
      setMessages((previous) => previous.filter((item) => item.id !== message.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤回失败');
    } finally {
      setBusy(false);
    }
  };

  const peers = new Map(conversations.map((conversation) => [conversation.id, conversation.peer]));
  const currentPeer = selected ? peers.get(selected.id) ?? selected.peer : null;

  return (
    <div className="belt-direct mt-4">
      {error ? (
        <p className="belt-error" role="alert">
          <code>LINK_ERROR</code> {error}
        </p>
      ) : null}
      {notice ? <p className="belt-panel belt-hint">{notice}</p> : null}

      <section className="belt-panel">
        <div className="belt-panel-head">
          <h2>建立链路 / FRIEND REQUEST</h2>
          <span className="belt-hint">同意后才会生成私聊</span>
        </div>
        <div className="belt-form-row">
          <label className="belt-field">
            <span>精确 handle</span>
            <input className="belt-input" value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="外环呼号" aria-label="好友 handle" />
          </label>
          <label className="belt-field">
            <span>附言</span>
            <input className="belt-input" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="链路目的（可选）" aria-label="好友申请附言" />
          </label>
          <button type="button" className="belt-button is-signal" disabled={busy || !handle.trim()} onClick={() => void request()}>
            发送申请
          </button>
        </div>
        {friends?.incoming.length ? (
          <div className="mt-3">
            <p className="belt-page-kicker">INCOMING / 待处理</p>
            <ul className="belt-ledger">
              {friends.incoming.map((row) => (
                <li key={row.id} className="belt-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                  <div>
                    <div className="belt-row-meta">
                      <IdentityBadges values={row.peer.prefixes} />
                      <span>{row.peer.displayName}</span>
                      <span>@{row.peer.handle}</span>
                      <span className="belt-stamp">{row.surface}</span>
                    </div>
                    {row.requestNote ? <p className="belt-row-deck">「{row.requestNote}」</p> : null}
                  </div>
                  <div className="belt-row-side">
                    <button type="button" className="belt-button is-signal" disabled={busy} onClick={() => void respond(row, 'accept')}>
                      同意
                    </button>
                    <button type="button" className="belt-button" disabled={busy} onClick={() => void respond(row, 'reject')}>
                      拒绝
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="belt-direct-grid mt-3">
        <section className="belt-panel">
          <div className="belt-panel-head">
            <h2>私聊 / DIRECT</h2>
            <span className="belt-hint">{conversations.length}</span>
          </div>
          {conversations.length === 0 ? <div className="belt-empty">还没有已建立的私聊。先发送好友申请。</div> : null}
          <div className="belt-ledger">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className="belt-row w-full text-left"
                data-active={selected?.id === conversation.id}
                onClick={() => void open(conversation)}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <BeltAvatar fileId={conversation.peer.avatarFileId} name={conversation.peer.displayName} size="sm" />
                  <div className="min-w-0">
                  <div className="belt-row-title">{conversation.peer.displayName}</div>
                  <div className="belt-row-meta">
                    <IdentityBadges values={conversation.peer.prefixes} />
                    <span>@{conversation.peer.handle}</span>
                    <span className="belt-stamp">{conversation.surface === 'bridge' ? 'BRIDGE' : 'BELT'}</span>
                  </div>
                  <p className="belt-row-deck">{conversation.lastMessagePreview ?? '链路已建立，等待第一条信号。'}</p>
                  </div>
                </div>
                <div className="belt-row-side">
                  <span>{conversation.lastMessageAt ? clockOf(conversation.lastMessageAt) : '—'}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="belt-panel belt-direct-chat">
          {selected ? (
            <>
              <div className="belt-panel-head">
                <h2>{currentPeer ? `@${currentPeer.handle}` : 'PRIVATE LINK'}</h2>
                <div className="belt-row-side">
                  <span className="belt-stamp is-signal">{selected.surface === 'bridge' ? 'BRIDGE' : 'BELT'}</span>
                  <button type="button" className="belt-button" disabled={busy} onClick={() => void clearChat()}>
                    清空记录
                  </button>
                  <button type="button" className="belt-button" disabled={busy} onClick={() => void manageFriend('block')}>
                    拉黑
                  </button>
                  <button type="button" className="belt-danger-link" disabled={busy} onClick={() => void manageFriend('remove')}>
                    删除好友
                  </button>
                </div>
              </div>
              <div className="belt-direct-messages">
                {messages.length === 0 ? <div className="belt-empty">链路已建立。发第一条私密信号。</div> : null}
                {messages.map((message) => {
                  const mine = message.senderId === user.id;
                  const peer = currentPeer;
                  return (
                    <div
                      key={message.id}
                      className={`belt-direct-message${mine ? ' is-mine' : ''}`}
                      data-mine={mine}
                      onContextMenu={(event) => {
                        if (!mine) return;
                        event.preventDefault();
                        setMenuId(message.id);
                      }}
                    >
                      <BeltAvatar
                        fileId={mine ? user.avatarFileId : peer?.avatarFileId}
                        name={mine ? user.displayName : peer?.displayName ?? '对方'}
                        size="sm"
                        neon={!mine}
                      />
                      <div className="min-w-0">
                        <div className="belt-message-author">
                          <b>{mine ? user.displayName : peer?.displayName ?? '对方'}</b>
                          <span>{clockOf(message.createdAt)}</span>
                          {mine ? (
                            <button type="button" className="belt-message-more" aria-label="消息操作" onClick={() => setMenuId((current) => (current === message.id ? null : message.id))}>
                              ⋯
                            </button>
                          ) : null}
                        </div>
                        {message.card ? (
                          <a className="belt-share-card" href={message.card.data?.url ?? `/belt/posts/${message.card.data?.postId ?? ''}`}>
                            <span className="belt-share-card-kicker">NEWS SHARE · {message.card.data?.sourceName ?? '环带电文'}</span>
                            <strong>{message.card.title}</strong>
                            <em>阅读全文 →</em>
                          </a>
                        ) : null}
                        {message.body ? <p className="belt-message-body">{message.body}</p> : null}
                        {menuId === message.id && mine ? (
                          <div className="belt-message-menu" role="menu">
                            <button type="button" onClick={() => void recall(message)}>撤回 / DELETE</button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>
              <form className="belt-composer mt-2" onSubmit={send}>
                <input
                  className="belt-input"
                  value={draft}
                  maxLength={4000}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="发送私密信号…"
                  aria-label="私聊消息"
                />
                <button type="submit" className="belt-button is-signal" disabled={busy || !draft.trim()}>
                  发送
                </button>
              </form>
            </>
          ) : (
            <div className="belt-empty">
              选择一条私聊链路
              <br />
              或从悬赏委托发起跨环带联络。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
