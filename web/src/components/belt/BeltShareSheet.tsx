'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { beltApi } from '@/lib/beltApi';
import type { BeltChannel, BeltFriendView } from '@/lib/beltTypes';
import { BeltAvatar } from './BeltAvatar';

type Step = 'root' | 'channel' | 'friend';

export function BeltShareSheet({
  postId,
  postTitle,
  open,
  onClose,
}: {
  postId: string;
  postTitle: string;
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('root');
  const [channels, setChannels] = useState<BeltChannel[]>([]);
  const [friends, setFriends] = useState<BeltFriendView[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('root');
      setNotice(null);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const copy = async () => {
    const url = `${window.location.origin}/belt/posts/${postId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = url;
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    setNotice('链路已复制');
  };

  const loadChannels = async () => {
    setStep('channel');
    setError(null);
    try {
      const data = await beltApi<{ channels: BeltChannel[] }>('/belt/channels');
      setChannels(data.channels.filter((channel) => channel.visibility === 'public'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '频道列表读取失败');
    }
  };

  const loadFriends = async () => {
    setStep('friend');
    setError(null);
    try {
      const data = await beltApi<{ friends: BeltFriendView[] }>('/belt/friendships');
      setFriends(data.friends.filter((friend) => Boolean(friend.dmChannelId)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '好友列表读取失败');
    }
  };

  const sendChannel = async (channel: BeltChannel) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await beltApi(`/belt/posts/${postId}/share`, {
        method: 'POST',
        body: JSON.stringify({ channelId: channel.id }),
      });
      setNotice(`已发送到 #${channel.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  const sendFriend = async (friend: BeltFriendView) => {
    if (busy || !friend.dmChannelId) return;
    setBusy(true);
    setError(null);
    try {
      await beltApi(`/belt/conversations/${friend.dmChannelId}/share`, {
        method: 'POST',
        body: JSON.stringify({ postId }),
      });
      setNotice(`已发送给 @${friend.peer.handle}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="belt-sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        className="belt-share-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="转发"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="belt-sheet-handle" />
        <header className="belt-sheet-head">
          {step !== 'root' ? (
            <button type="button" className="belt-sheet-back" onClick={() => { setStep('root'); setNotice(null); setError(null); }}>
              ←
            </button>
          ) : null}
          <div>
            <p className="belt-page-kicker">TRANSMIT / 转发</p>
            <h2>{step === 'root' ? '分享这条信号' : step === 'channel' ? '发送到频道' : '发送给好友'}</h2>
            <p className="belt-sheet-sub">{postTitle}</p>
          </div>
          <button type="button" className="belt-sheet-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        {notice ? <p className="belt-sheet-notice">{notice}</p> : null}
        {error ? <p className="belt-error">{error}</p> : null}

        {step === 'root' ? (
          <div className="belt-sheet-options">
            <button type="button" className="belt-sheet-option" onClick={() => void copy()}>
              <span className="belt-sheet-icon">⌁</span>
              <span>
                <b>复制链接</b>
                <small>把完整新闻 URL 复制到剪贴板</small>
              </span>
              <em>COPY</em>
            </button>
            <button type="button" className="belt-sheet-option" onClick={() => void loadChannels()}>
              <span className="belt-sheet-icon">#</span>
              <span>
                <b>发送到频道</b>
                <small>选择一个公开环带频道</small>
              </span>
              <em>CHANNEL</em>
            </button>
            <button type="button" className="belt-sheet-option" onClick={() => void loadFriends()}>
              <span className="belt-sheet-icon">@</span>
              <span>
                <b>发送给好友</b>
                <small>以卡片消息发到私聊 DM</small>
              </span>
              <em>DIRECT</em>
            </button>
          </div>
        ) : null}

        {step === 'channel' ? (
          <div className="belt-sheet-list">
            {channels.length === 0 ? <p className="belt-empty">没有可用的公开频道。</p> : null}
            {channels.map((channel) => (
              <button key={channel.id} type="button" className="belt-sheet-row" disabled={busy} onClick={() => void sendChannel(channel)}>
                <span className="belt-sheet-icon">#</span>
                <span>
                  <b>{channel.name}</b>
                  <small>{channel.topic ?? 'PUBLIC BAND'}</small>
                </span>
                <em>发送 →</em>
              </button>
            ))}
          </div>
        ) : null}

        {step === 'friend' ? (
          <div className="belt-sheet-list">
            {friends.length === 0 ? <p className="belt-empty">还没有可发送的好友私聊。</p> : null}
            {friends.map((friend) => (
              <button key={friend.id} type="button" className="belt-sheet-row" disabled={busy} onClick={() => void sendFriend(friend)}>
                <BeltAvatar fileId={friend.peer.avatarFileId} name={friend.peer.displayName} size="sm" />
                <span>
                  <b>{friend.peer.displayName}</b>
                  <small>@{friend.peer.handle}</small>
                </span>
                <em>发送 →</em>
              </button>
            ))}
          </div>
        ) : null}

        <button type="button" className="belt-sheet-cancel" onClick={onClose}>
          取消
        </button>
      </section>
    </div>,
    document.body,
  );
}
