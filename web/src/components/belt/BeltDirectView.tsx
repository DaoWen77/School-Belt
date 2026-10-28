'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { askConfirm } from '@/lib/confirm';
import { beltApi, connectBeltSocket, type BeltUser } from '@/lib/beltApi';
import type { BeltDmConversation } from '@/lib/beltTypes';
import type { Message } from '@/lib/types';
import { randomUuid } from '@/lib/uuid';
import { BeltAvatar } from './BeltAvatar';
import { notifyRtcDisabled } from '@/lib/rtcDisabled';

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

/** 私聊主视图：左侧边栏选中会话后，这里只渲染聊天窗口。 */
export function BeltDirectView({ user, conversationId }: { user: BeltUser; conversationId?: string }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<BeltDmConversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const socket = useRef<ReturnType<typeof connectBeltSocket>>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  const selected = conversations.find((row) => row.id === conversationId) ?? null;

  useEffect(() => {
    let cancelled = false;
    beltApi<{ conversations: BeltDmConversation[] }>('/belt/directs')
      .then((data) => {
        if (!cancelled) setConversations(data.conversations ?? []);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '链路读取失败');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setError(null);
    setMenuId(null);
    beltApi<{ messages: Message[] }>(`/belt/directs/${conversationId}/messages`)
      .then((data) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '私聊读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    socket.current = connectBeltSocket(
      () => undefined,
      undefined,
      (payload) => {
        const data = payload as { channelId?: string; message?: Message };
        if (!data?.channelId || !data.message) return;
        if (data.channelId !== conversationId) return;
        setMessages((previous) =>
          previous.some((message) => message.id === data.message!.id) ? previous : [...previous, data.message!],
        );
      },
    );
    return () => {
      socket.current?.disconnect();
      socket.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await beltApi<{ message: Message }>(`/belt/directs/${selected.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: draft.trim(), clientMsgId: randomUuid() }),
      });
      setMessages((previous) =>
        previous.some((message) => message.id === data.message.id) ? previous : [...previous, data.message],
      );
      setDraft('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  const clearChat = async () => {
    if (!selected || busy) return;
    if (
      !(await askConfirm('清空这段私聊记录？只对你的账号隐藏，对方仍可看到。', {
        title: '清空私聊记录',
        confirmText: '清空记录',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await beltApi(`/belt/directs/${selected.id}/messages`, { method: 'DELETE' });
      setMessages([]);
      setNotice('本地链路记录已清空。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '清空失败');
    } finally {
      setBusy(false);
    }
  };


  const recall = async (message: Message) => {
    if (!selected || busy) return;
    setBusy(true);
    setMenuId(null);
    try {
      await beltApi(`/belt/directs/${selected.id}/messages/${message.id}`, { method: 'DELETE' });
      setMessages((previous) => previous.filter((item) => item.id !== message.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤回失败');
    } finally {
      setBusy(false);
    }
  };

  const startCall = async (_mode?: 'audio' | 'video') => {
    notifyRtcDisabled();
  };

  if (!conversationId) {
    return (
      <div className="belt-im-empty-page">
        <p className="belt-page-kicker">DIRECT LINK / 通讯链路</p>
        <h3>请从左侧选择通讯链路</h3>
        <p>侧边栏「私聊链路」里点选联系人，立即开始聊天。</p>
      </div>
    );
  }

  const peer = selected?.peer ?? null;

  return (
    <section className="belt-im-only">
      {error ? (
        <p className="belt-error" role="alert">
          <code>LINK_ERROR</code> {error}
        </p>
      ) : null}
      {notice ? <p className="belt-hint">{notice}</p> : null}
      {!loaded ? <p className="belt-hint">正在接入链路…</p> : null}
      {loaded && !selected ? <p className="belt-hint">该会话不存在或已关闭。</p> : null}

      {selected ? (
        <div className="belt-im-chat">
          <header className="belt-im-chat-head">
            <Link href="/belt/direct" className="belt-im-back" aria-label="返回">←</Link>
            {peer?.handle ? (
              <Link
                className="belt-msg-link"
                href={`/belt/u/${encodeURIComponent(peer.handle)}`}
                aria-label={`查看 ${peer.displayName} 的主页`}
              >
                <BeltAvatar fileId={peer.avatarFileId} name={peer.displayName} size="sm" />
              </Link>
            ) : (
              <BeltAvatar fileId={peer?.avatarFileId} name={peer?.displayName ?? '对方'} size="sm" />
            )}
            <div className="belt-im-chat-title">
              {peer?.handle ? (
                <Link className="belt-author-link" href={`/belt/u/${encodeURIComponent(peer.handle)}`}>
                  <b>{peer.displayName}</b>
                </Link>
              ) : (
                <b>{peer?.displayName ?? '私聊链路'}</b>
              )}
              <small>@{peer?.handle ?? ''} · {selected.surface === 'bridge' ? 'BRIDGE' : 'BELT'}</small>
            </div>
            <div className="belt-im-chat-actions">
              <button type="button" className="belt-channel-call" aria-label="发起语音通讯" onClick={() => void startCall('audio')}>
                <span className="belt-call-icon belt-call-audio" /><small>VOICE</small>
              </button>
              <button type="button" className="belt-channel-call" aria-label="发起视频通讯" onClick={() => void startCall('video')}>
                <span className="belt-call-icon belt-call-video" /><small>VIDEO</small>
              </button>
              <button type="button" className="belt-button" disabled={busy} onClick={() => void clearChat()}>清空</button>
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
                        <BeltAvatar fileId={peer?.avatarFileId} name={peer?.displayName ?? '对方'} size="sm" />
                      )
                    ) : null}
                    <div className={`belt-im-bubble${mine ? ' is-mine' : ''}`}>
                      {message.card ? (
                        <a className="belt-share-card" href={message.card.data?.url ?? `/belt/posts/${message.card.data?.postId ?? ''}`}>
                          <span className="belt-share-card-kicker">NEWS SHARE · {message.card.data?.sourceName ?? '环塔电文'}</span>
                          <strong>{message.card.title}</strong>
                          <em>阅读全文 →</em>
                        </a>
                      ) : message.body?.startsWith('AURORA_CALL:') ? (
                        (() => {
                          const [, callId, mode, caller] = message.body.split(':');
                          return (
                            <a className="belt-call-card" href={`/belt/rtc?callId=${callId}&mode=${mode || 'audio'}`} onClick={(event) => { event.preventDefault(); notifyRtcDisabled(); }}>
                              <span>📡 VOICE LINK · 语音链路</span>
                              <strong>{decodeURIComponent(caller || '对方')} 邀请你加入通讯</strong>
                              <em>点击加入 →</em>
                            </a>
                          );
                        })()
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
        </div>
      ) : null}
    </section>
  );
}
