'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { beltApi, connectBeltSocket, type BeltUser } from '@/lib/beltApi';
import type { BeltDmConversation, BeltFriendView, BeltFriends } from '@/lib/beltTypes';
import type { Message } from '@/lib/types';
import { randomUuid } from '@/lib/uuid';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltAvatar } from './BeltAvatar';

function clockOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dayOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 环带私聊：桌面端左列表 / 右聊天；移动端由 /belt/direct 与 /belt/direct/:id 两个路由分流。
 */
export function BeltDirectView({ user, conversationId }: { user: BeltUser; conversationId?: string }) {
  const [friends, setFriends] = useState<BeltFriends | null>(null);
  const [conversations, setConversations] = useState<BeltDmConversation[]>([]);
  const [selected, setSelected] = useState<BeltDmConversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
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
      const list = dmData.conversations ?? [];
      setConversations(list);
      if (conversationId) {
        const target = list.find((row) => row.id === conversationId);
        if (target) {
          setSelected(target);
          void open(target);
        }
      } else if (selectedRef.current) {
        const still = list.find((row) => row.id === selectedRef.current?.id);
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
    if (!conversationId) return;
    const target = conversations.find((row) => row.id === conversationId);
    if (target && selected?.id !== target.id) {
      setSelected(target);
      void open(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, conversations.length]);

  useEffect(() => {
    socket.current = connectBeltSocket(
      () => undefined,
      undefined,
      (payload) => {
        const data = payload as { channelId?: string; message?: Message };
        if (!data?.channelId || !data.message) return;
        if (selectedRef.current?.id !== data.channelId) return;
        setMessages((previous) =>
          previous.some((message) => message.id === data.message!.id) ? previous : [...previous, data.message!],
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
    setMenuId(null);
    try {
      const data = await beltApi<{ messages: Message[] }>(`/belt/conversations/${conversation.id}/messages`);
      setMessages(data.messages ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '私聊读取失败');
    }
  };

  const request = async () => {
    const normalized = handle.replace(/^@/, '').trim().toLowerCase();
    if (!normalized || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await beltApi('/belt/friendships/requests', {
        method: 'POST',
        body: JSON.stringify({ handle: normalized, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      setNotice(`已向 @${normalized} 发出链路申请。`);
      setHandle('');
      setNote('');
      setRequestOpen(false);
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

  const currentPeer = selected?.peer ?? null;
  const incoming = friends?.incoming ?? [];

  return (
    <div className={`belt-im${conversationId ? ' is-chat-route' : ''}`}>
      {error ? (
        <p className="belt-error" role="alert">
          <code>LINK_ERROR</code> {error}
        </p>
      ) : null}
      {notice ? <p className="belt-hint">{notice}</p> : null}

      {/* 左：会话列表 */}
      <aside className="belt-im-list">
        <div className="belt-im-list-head">
          <div>
            <p className="belt-page-kicker">DIRECT LINKS</p>
            <b>私聊链路</b>
          </div>
          <button type="button" className="belt-im-new" aria-label="发起好友申请" onClick={() => setRequestOpen((value) => !value)}>
            +
          </button>
        </div>

        {requestOpen ? (
          <div className="belt-im-request">
            <input className="belt-input" value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@handle" aria-label="好友 handle" />
            <input className="belt-input" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="附言（可选）" aria-label="好友申请附言" />
            <button type="button" className="belt-button is-signal" disabled={busy || !handle.trim()} onClick={() => void request()}>
              发送申请
            </button>
          </div>
        ) : null}

        {incoming.length > 0 ? (
          <div className="belt-im-incoming">
            <p>{incoming.length} 条待处理申请</p>
            {incoming.map((row) => (
              <div key={row.id} className="belt-im-incoming-row">
                <BeltAvatar fileId={row.peer.avatarFileId} name={row.peer.displayName} size="sm" />
                <span>@{row.peer.handle}</span>
                <button type="button" className="belt-button is-signal" disabled={busy} onClick={() => void respond(row, 'accept')}>同意</button>
                <button type="button" className="belt-button" disabled={busy} onClick={() => void respond(row, 'reject')}>拒绝</button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="belt-im-conversations">
          {conversations.length === 0 ? <p className="belt-hint">还没有私聊。点右上角 + 发起好友申请。</p> : null}
          {conversations.map((conversation) => {
            const active = selected?.id === conversation.id;
            const inner = (
              <>
                <BeltAvatar fileId={conversation.peer.avatarFileId} name={conversation.peer.displayName} />
                <span className="belt-im-conv-main">
                  <b>{conversation.peer.displayName}</b>
                  <small>{conversation.lastMessagePreview ?? '链路已建立，等待第一条信号。'}</small>
                </span>
                <span className="belt-im-conv-meta">
                  <small>{conversation.lastMessageAt ? clockOf(conversation.lastMessageAt) : ''}</small>
                  <i className={active ? 'is-on' : ''} />
                </span>
              </>
            );
            return (
              <Link
                key={conversation.id}
                href={`/belt/direct/${conversation.id}`}
                className={`belt-im-conv${active ? ' is-active' : ''}`}
                onClick={(event) => {
                  if (typeof window !== 'undefined' && window.matchMedia('(min-width: 821px)').matches) {
                    event.preventDefault();
                    void open(conversation);
                  }
                }}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      </aside>

      {/* 右：聊天窗口 */}
      <section className="belt-im-chat">
        {selected ? (
          <>
            <header className="belt-im-chat-head">
              <Link href="/belt/direct" className="belt-im-back" aria-label="返回会话列表">←</Link>
              <BeltAvatar fileId={currentPeer?.avatarFileId} name={currentPeer?.displayName ?? '对方'} size="sm" />
              <div className="belt-im-chat-title">
                <b>{currentPeer?.displayName ?? '私聊链路'}</b>
                <small>@{currentPeer?.handle ?? ''} · {selected.surface === 'bridge' ? 'BRIDGE' : 'BELT'}</small>
              </div>
              <div className="belt-im-chat-actions">
                <button type="button" className="belt-button" disabled={busy} onClick={() => void clearChat()}>清空</button>
                <button type="button" className="belt-button" disabled={busy} onClick={() => void manageFriend('block')}>拉黑</button>
                <button type="button" className="belt-danger-link" disabled={busy} onClick={() => void manageFriend('remove')}>删好友</button>
              </div>
            </header>

            <div className="belt-im-messages">
              {messages.length === 0 ? <p className="belt-hint">链路已建立，发第一条私密信号。</p> : null}
              {messages.map((message, index) => {
                const mine = message.senderId === user.id;
                const previous = index > 0 ? messages[index - 1] : null;
                const continuation =
                  Boolean(previous) &&
                  previous!.senderId === message.senderId &&
                  new Date(message.createdAt).getTime() - new Date(previous!.createdAt).getTime() < 5 * 60_000;
                const showDay = !previous || dayOf(previous.createdAt) !== dayOf(message.createdAt);
                return (
                  <div key={message.id}>
                    {showDay ? <div className="belt-im-day">{dayOf(message.createdAt)}</div> : null}
                    <div
                      className={`belt-im-row${mine ? ' is-mine' : ''}${continuation ? ' is-continuation' : ''}`}
                      onContextMenu={(event) => {
                        if (!mine) return;
                        event.preventDefault();
                        setMenuId(message.id);
                      }}
                    >
                      {!mine ? (
                        continuation ? <span className="belt-im-avatar-spacer" /> : (
                          <BeltAvatar fileId={currentPeer?.avatarFileId} name={currentPeer?.displayName ?? '对方'} size="sm" />
                        )
                      ) : null}
                      <div className={`belt-im-bubble${mine ? ' is-mine' : ''}`}>
                        {message.card ? (
                          <a className="belt-share-card" href={message.card.data?.url ?? `/belt/posts/${message.card.data?.postId ?? ''}`}>
                            <span className="belt-share-card-kicker">NEWS SHARE · {message.card.data?.sourceName ?? '环带电文'}</span>
                            <strong>{message.card.title}</strong>
                            <em>阅读全文 →</em>
                          </a>
                        ) : (
                          <p>{message.body}</p>
                        )}
                        <time>{clockOf(message.createdAt)}</time>
                        {mine ? (
                          <button type="button" className="belt-im-more" aria-label="消息操作" onClick={() => setMenuId((current) => (current === message.id ? null : message.id))}>
                            ⋯
                          </button>
                        ) : null}
                        {menuId === message.id && mine ? (
                          <button type="button" className="belt-im-recall" onClick={() => void recall(message)}>撤回</button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>

            <form className="belt-im-composer" onSubmit={send}>
              <input
                className="belt-input"
                value={draft}
                maxLength={4000}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="输入信号..."
                aria-label="私聊消息"
              />
              <button type="submit" className="belt-button is-signal" disabled={busy || !draft.trim()}>发送</button>
            </form>
          </>
        ) : (
          <div className="belt-im-empty">
            <p className="belt-page-kicker">SELECT A LINK</p>
            <h3>选择一条私聊链路</h3>
            <p>从左侧选择对话，或点击 + 发起好友申请。</p>
          </div>
        )}
      </section>
    </div>
  );
}
