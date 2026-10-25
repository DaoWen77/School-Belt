'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { beltApi, beltFileUrl, connectBeltSocket, type BeltUser } from '@/lib/beltApi';
import { resolvePublicUrl } from '@/lib/fileUrl';
import type { BeltAttachment, BeltChannel, BeltMessage } from '@/lib/beltTypes';
import { randomUuid } from '@/lib/uuid';
import { IdentityBadges } from '@/components/im/IdentityBadges';
import { BeltAvatar } from './BeltAvatar';
import { BeltLightbox } from './BeltLightbox';
import { BeltRTCInviteModal, type RtcInviteMember } from './BeltRTCInviteModal';
import { notifyRtcDisabled } from '@/lib/rtcDisabled';

function clockOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

interface PendingAttachment extends BeltAttachment {
  pending?: boolean;
}

export function BeltChannelView({ user }: { user: BeltUser }) {
  const router = useRouter();
  const [channel, setChannel] = useState<BeltChannel | null>(null);
  const [messages, setMessages] = useState<BeltMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<{ open: boolean; mode: 'audio' | 'video'; members: RtcInviteMember[]; selected: string[]; loading: boolean }>({
    open: false,
    mode: 'audio',
    members: [],
    selected: [],
    loading: false,
  });
  const [incoming, setIncoming] = useState<{ callId: string; mode: string; caller: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [state, setState] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ src: string; kind: 'image' | 'video'; title: string } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const socket = useRef<ReturnType<typeof connectBeltSocket>>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onRefresh = () => {
      if (channel) void beltApi<{ messages: BeltMessage[] }>(`/belt/channels/${channel.id}/messages?limit=100`).then((page) => setMessages(page.messages)).catch(() => undefined);
    };
    window.addEventListener('belt:refresh', onRefresh);
    return () => window.removeEventListener('belt:refresh', onRefresh);
  }, [channel?.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    beltApi<{ channels: BeltChannel[] }>('/belt/channels')
      .then(async (data) => {
        if (cancelled) return;
        const requested = new URLSearchParams(window.location.search).get('channelId');
        const first =
          data.channels.find((item) => item.id === requested) ??
          data.channels.find((item) => item.visibility === 'public' && !item.organizationId) ??
          data.channels[0] ??
          null;
        setChannel(first);
        if (!first) return;
        const page = await beltApi<{ messages: BeltMessage[] }>(
          `/belt/channels/${first.id}/messages?limit=100`,
        );
        if (!cancelled) setMessages(page.messages);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '频道读取失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!channel) return;
    socket.current = connectBeltSocket(
      (payload) => {
        const message = payload as BeltMessage;
        if (!message?.id || message.channelId !== channel.id) return;
        setMessages((previous) =>
          previous.some((item) => item.id === message.id) ? previous : [...previous, message],
        );
        if (message.senderId !== user.id && message.body?.startsWith('AURORA_CALL:')) {
          const [, callId, mode, caller, invitees] = message.body.split(':');
          const invited = invitees ? invitees.split(',').filter(Boolean) : [];
          if (callId && (invited.length === 0 || invited.includes(user.id))) {
            setIncoming({ callId, mode: mode || 'audio', caller: decodeURIComponent(caller || '成员') });
          }
        }
      },
      setState,
    );
    return () => {
      socket.current?.disconnect();
      socket.current = null;
    };
  }, [channel?.id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  const upload = async (file: File) => {
    if (!channel || uploading) return;
    setUploading(true);
    setError(null);
    const tempId = randomUuid();
    try {
      const asAttachment: PendingAttachment = {
        id: tempId,
        fileId: tempId,
        originalName: file.name,
        mime: file.type,
        kind: file.type.startsWith('video/') ? 'video' : 'image',
        sizeBytes: String(file.size),
        width: null,
        height: null,
        durationMs: null,
        url: URL.createObjectURL(file),
        pending: true,
      };
      setAttachments((previous) => [...previous, asAttachment]);
      const presign = await beltApi<{
        fileId: string;
        uploadUrl: string;
        headers?: Record<string, string>;
      }>('/belt/files/attachments/presign', {
        method: 'POST',
        body: JSON.stringify({
          channelId: channel.id,
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
        }),
      });
      try {
        const response = await fetch(resolvePublicUrl(presign.uploadUrl), {
          method: 'PUT',
          headers: presign.headers ?? {},
          body: file,
        });
        if (!response.ok) throw new Error(`上传失败 HTTP ${response.status}`);
        await beltApi(`/belt/files/${presign.fileId}/complete`, { method: 'POST', body: '{}' });
      } catch {
        // 浏览器直传被 CORS/PNA 拦截时的同源回退；仍使用同一预签名文件记录。
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(new Error('读取附件失败'));
          reader.readAsDataURL(file);
        });
        await beltApi(`/belt/files/${presign.fileId}/upload`, {
          method: 'POST',
          body: JSON.stringify({ data: base64 }),
        });
      }
      const url = await beltFileUrl(presign.fileId);
      setAttachments((previous) =>
        previous.map((item) =>
          item.id === tempId ? { ...item, fileId: presign.fileId, url, pending: false } : item,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '附件上传失败');
      setAttachments((previous) => previous.filter((item) => item.id !== tempId));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if ((!body && attachments.length === 0) || !channel || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const data = await beltApi<{ message: BeltMessage }>(`/belt/channels/${channel.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          clientMsgId: randomUuid(),
          ...(attachments.length > 0 ? { attachmentIds: attachments.map((item) => item.fileId) } : {}),
        }),
      });
      setMessages((previous) =>
        previous.some((item) => item.id === data.message.id) ? previous : [...previous, data.message],
      );
      setDraft('');
      setAttachments([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const recall = async (message: BeltMessage) => {
    if (!channel || sending) return;
    setSending(true);
    setMenuId(null);
    try {
      await beltApi(`/belt/channels/${channel.id}/messages/${message.id}`, { method: 'DELETE' });
      setMessages((previous) => previous.filter((item) => item.id !== message.id));
      setNotice('信号已撤回。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤回失败');
    } finally {
      setSending(false);
    }
  };

  const startPress = (id: string) => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setMenuId(id), 520);
  };
  const endPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const openInvite = async (mode: 'audio' | 'video') => {
    if (!channel) return;
    notifyRtcDisabled();
    return;
  };

  const startCall = async () => {
    if (!channel || invite.selected.length === 0) return;
    const callId = `call-${channel.id.slice(0, 8)}-${Date.now().toString(36)}`;
    const chosen = invite.members.filter((member) => invite.selected.includes(member.userId));
    const roster = [
      { id: user.id, name: user.displayName, initials: user.displayName.slice(0, 2), role: 'CALLER', avatarFileId: user.avatarFileId ?? null, status: 'connected', self: true },
      ...chosen.map((member) => ({
        id: member.userId,
        name: member.displayName,
        initials: member.displayName.slice(0, 2),
        role: 'INVITEE',
        avatarFileId: member.avatarFileId ?? null,
        status: 'calling',
        self: false,
      })),
    ];
    sessionStorage.setItem('belt.rtc.roster', JSON.stringify(roster));
    try {
      await beltApi(`/belt/channels/${channel.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: `AURORA_CALL:${callId}:${invite.mode}:${encodeURIComponent(user.displayName)}:${invite.selected.join(',')}`,
          clientMsgId: randomUuid(),
        }),
      });
    } catch {
      /* 卡片消息失败不阻塞通话 */
    }
    setInvite((current) => ({ ...current, open: false }));
    router.push(`/belt/rtc?callId=${callId}&mode=${invite.mode}`);
  };

  if (loading) {
    return <div className="belt-panel belt-empty">正在锁定公共频段…</div>;
  }
  if (!channel) {
    return <div className="belt-panel belt-empty">没有可用的环带频道。等待中继配置。</div>;
  }

  return (
    <section className="belt-channel mt-4">
      <div className="belt-channel-head">
        <h1># {channel.name}</h1>
        <span className="meta">
          {channel.topic ?? 'PUBLIC BAND'} · {messages.length} SIGNALS ·{' '}
          <span style={{ color: state === 'online' ? 'var(--ef-signal)' : 'var(--ef-ink-2)' }}>
            {state === 'online' ? 'LIVE' : state === 'connecting' ? 'LINKING' : 'OFFLINE'}
          </span>
          <button type="button" className="belt-channel-call" aria-label="发起语音通讯" onClick={() => void openInvite('audio')}>
            <span className="belt-call-icon belt-call-audio" />
            <small>VOICE</small>
          </button>
          <button type="button" className="belt-channel-call" aria-label="发起视频通讯" onClick={() => void openInvite('video')}>
            <span className="belt-call-icon belt-call-video" />
            <small>VIDEO</small>
          </button>
          <button type="button" className="belt-channel-info-btn" aria-label="频道详情" onClick={() => setInfoOpen(true)}>
            ⓘ
          </button>
        </span>
      </div>

      <div className="belt-messages">
        {messages.length === 0 ? (
          <div className="belt-empty">
            NO SIGNAL YET
            <br />
            这里还没有信号。发第一条，把频段点亮。
          </div>
        ) : null}
        {messages.map((message, index) => {
          const mine = message.senderId === user.id;
          const previous = index > 0 ? messages[index - 1] : null;
          const continuation =
            Boolean(previous) &&
            previous!.senderId === message.senderId &&
            new Date(message.createdAt).getTime() - new Date(previous!.createdAt).getTime() < 5 * 60_000;
          return (
            <article
              key={message.id}
              className={`belt-message${mine ? ' is-mine' : ''}${continuation ? ' is-continuation' : ''}`}
              onContextMenu={(event) => {
                if (!mine) return;
                event.preventDefault();
                setMenuId(message.id);
              }}
              onPointerDown={() => {
                if (mine) startPress(message.id);
              }}
              onPointerUp={endPress}
              onPointerLeave={endPress}
            >
              <BeltAvatar fileId={message.sender.avatarFileId} name={message.sender.displayName} />
              <time dateTime={message.createdAt}>{clockOf(message.createdAt)}</time>
              <div className="min-w-0">
                <div className="belt-message-author">
                  <IdentityBadges values={message.sender.prefixes ?? []} />
                  <b>{message.sender.displayName}</b>
                  <span>@{message.sender.handle || message.senderId.slice(0, 8)}</span>
                  {mine ? <span className="belt-stamp">YOU</span> : null}
                  {mine ? (
                    <button
                      type="button"
                      className="belt-message-more"
                      aria-label="消息操作"
                      onClick={() => setMenuId((current) => (current === message.id ? null : message.id))}
                    >
                      ⋯
                    </button>
                  ) : null}
                </div>
                {message.card ? (
                  <a className="belt-share-card" href={message.card.data?.url ?? `/belt/posts/${message.card.data?.postId ?? ''}`}>
                    <span className="belt-share-card-kicker">NEWS SHARE · {message.card.data?.sourceName ?? '环带电文'}</span>
                    <strong>{message.card.title}</strong>
                    {message.card.body ? <span>{message.card.body}</span> : null}
                    <em>阅读全文 →</em>
                  </a>
                ) : null}
                {message.body?.startsWith('AURORA_CALL:') ? (
                  (() => {
                    const [, callId, mode, , invitees] = message.body.split(':');
                    const invited = invitees ? invitees.split(',').filter(Boolean) : [];
                    if (invited.length > 0 && !invited.includes(user.id)) {
                      return <p className="belt-message-body">📡 极光通讯邀请已发送给指定成员</p>;
                    }
                    return (
                      <a className="belt-call-card" href={`/belt/rtc?callId=${callId}&mode=${mode || 'audio'}`} onClick={(event) => { event.preventDefault(); notifyRtcDisabled(); }}>
                        <span>📡 AURORA CALL · 极光通讯</span>
                        <strong>{message.sender.displayName} 邀请你加入通讯</strong>
                        <em>点击加入 →</em>
                      </a>
                    );
                  })()
                ) : message.body ? <p className="belt-message-body">{message.body}</p> : null}
                {message.attachments?.length ? (
                  <div className={`belt-message-media kind-${message.attachments[0]?.kind ?? 'file'}`}>
                    {message.attachments.map((attachment) =>
                      attachment.kind === 'image' ? (
                        <button
                          key={attachment.id}
                          type="button"
                          className="belt-media-thumb"
                          onClick={() => setPreview({ src: attachment.url, kind: 'image', title: attachment.originalName })}
                        >
                          <img src={attachment.url} alt={attachment.originalName} loading="lazy" />
                        </button>
                      ) : attachment.kind === 'video' ? (
                        <button
                          key={attachment.id}
                          type="button"
                          className="belt-media-thumb is-video"
                          onClick={() => setPreview({ src: attachment.url, kind: 'video', title: attachment.originalName })}
                        >
                          <video src={attachment.url} preload="metadata" muted playsInline />
                          <span>▶ PLAY</span>
                        </button>
                      ) : (
                        <a key={attachment.id} className="belt-file-chip" href={attachment.url} target="_blank" rel="noreferrer">
                          📎 {attachment.originalName}
                        </a>
                      ),
                    )}
                  </div>
                ) : null}
                {menuId === message.id && mine ? (
                  <div className="belt-message-menu" role="menu">
                    <button type="button" onClick={() => void recall(message)}>
                      撤回 / DELETE
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="belt-channel-composer">
        {error ? (
          <p className="belt-error" role="alert">
            <code>TX_FAILED</code> {error}
          </p>
        ) : null}
        {notice ? <p className="belt-hint">{notice}</p> : null}
        {attachments.length > 0 ? (
          <div className="belt-attachment-tray">
            {attachments.map((attachment) => (
              <span key={attachment.id} className={`belt-attachment-chip${attachment.pending ? ' is-pending' : ''}`}>
                {attachment.kind === 'image' ? <img src={attachment.url} alt="" /> : <span className="belt-attachment-icon">▶</span>}
                <span>{attachment.originalName}</span>
                {attachment.pending ? <em>UPLOADING</em> : null}
                <button
                  type="button"
                  aria-label={`移除 ${attachment.originalName}`}
                  onClick={() => setAttachments((previous) => previous.filter((item) => item.id !== attachment.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <form className="belt-composer" onSubmit={send}>
          <button
            type="button"
            className="belt-attach-button"
            disabled={uploading || sending}
            onClick={() => fileInput.current?.click()}
            aria-label="添加附件"
          >
            {uploading ? '◌' : '＋'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              for (const file of files) void upload(file);
            }}
          />
          <input
            className="belt-input"
            value={draft}
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="输入信号..."
            aria-label="环带频道消息"
          />
          <button type="submit" className="belt-button is-signal" disabled={sending || uploading || (!draft.trim() && attachments.length === 0)}>
            {sending ? '发射中…' : 'TRANSMIT'}
          </button>
        </form>
        <div className="belt-composer-hint mt-1">
          <button type="button" aria-label="输入提示" onClick={() => setHintOpen((value) => !value)}>
            ?
          </button>
          <span>输入提示</span>
          {hintOpen ? <div className="belt-composer-hint-pop">长按 / 右键自己的消息可撤回 · 支持图片与短视频 · Enter 发送</div> : null}
        </div>
      </div>
      {invite.open ? (
        <BeltRTCInviteModal
          open={invite.open}
          channelName={channel?.name ?? '当前频道'}
          members={invite.members}
          selected={invite.selected}
          loading={invite.loading}
          mode={invite.mode}
          onToggle={(userId) =>
            setInvite((current) => ({
              ...current,
              selected: current.selected.includes(userId)
                ? current.selected.filter((id) => id !== userId)
                : [...current.selected, userId],
            }))
          }
          onClose={() => setInvite((current) => ({ ...current, open: false }))}
          onStart={() => void startCall()}
        />
      ) : null}

      {incoming ? (
        <button
          type="button"
          className="belt-incoming-call"
          onClick={() => notifyRtcDisabled()}
        >
          <b>来电 · {incoming.caller} 邀请你加入极光通讯</b>
          <span>点击接通</span>
        </button>
      ) : null}

      {infoOpen ? (
        <div className="belt-drawer-backdrop" role="presentation" onClick={() => setInfoOpen(false)}>
          <aside className="belt-drawer" role="dialog" aria-modal="true" aria-label="频道详情" onClick={(event) => event.stopPropagation()}>
            <div className="belt-drawer-head">
              <b>#{channel.name}</b>
              <button type="button" className="belt-button" onClick={() => setInfoOpen(false)}>关闭</button>
            </div>
            <p className="belt-page-kicker">CHANNEL DETAILS</p>
            <p className="belt-hint">{channel.topic ?? 'PUBLIC BAND'}</p>
            <ul className="belt-ledger mt-2">
              <li className="belt-row"><span>类型</span><b>{channel.visibility === 'private' ? '私有组织频道' : '公开频道'}</b></li>
              <li className="belt-row"><span>消息数</span><b>{messages.length}</b></li>
              <li className="belt-row"><span>链路</span><b>{state === 'online' ? 'LIVE' : 'OFFLINE'}</b></li>
            </ul>
          </aside>
        </div>
      ) : null}
      {preview ? (
        <BeltLightbox src={preview.src} kind={preview.kind} title={preview.title} onClose={() => setPreview(null)} />
      ) : null}
    </section>
  );
}
