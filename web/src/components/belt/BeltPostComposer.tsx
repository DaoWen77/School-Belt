'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { beltApi } from '@/lib/beltApi';
import type { BeltUser } from '@/lib/beltApi';

type Board = 'bulletin' | 'bounty' | 'daily';

const COPY: Record<Board, { eyebrow: string; title: string; body: string }> = {
  bulletin: {
    eyebrow: 'OFFICIAL DISPATCH / 协议官签发',
    title: '签发环带快报',
    body: '写下要发往外环的官方公告正文…',
  },
  bounty: {
    eyebrow: 'COMMISSION DOSSIER / 委托登记',
    title: '登记悬赏委托',
    body: '委托内容、交付要求、联络条件…',
  },
  daily: {
    eyebrow: 'LOGBOOK ENTRY / 日常信号',
    title: '发布日常信号',
    body: '记录一条外环日志…',
  },
};

export function BeltPostComposer({
  board,
  open,
  user,
  onClose,
  onPosted,
}: {
  board: Board;
  open: boolean;
  user: BeltUser;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reward, setReward] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, open]);

  if (!open) return null;

  const copy = COPY[board];
  const canPost =
    board !== 'bulletin' || user.globalRole === 'owner' || user.globalRole === 'admin';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canPost || !title.trim() || !body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await beltApi('/belt/posts', {
        method: 'POST',
        body: JSON.stringify({
          board,
          title: title.trim(),
          body: body.trim(),
          ...(board === 'bounty' && reward.trim() ? { bountyReward: reward.trim() } : {}),
          ...(board === 'bounty' && deadline
            ? { bountyDeadline: new Date(deadline).toISOString() }
            : {}),
        }),
      });
      setTitle('');
      setBody('');
      setReward('');
      setDeadline('');
      onPosted();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发布失败');
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="belt-root belt-drawer-root">
      <div className="signal-drawer-layer">
      <button
        type="button"
        className="signal-drawer-backdrop"
        aria-label="关闭发布抽屉"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <aside className="signal-drawer" role="dialog" aria-modal="true" aria-label={copy.title}>
        <div className="signal-drawer-head">
          <div>
            <p className="signal-drawer-kicker">{copy.eyebrow}</p>
            <h2>{copy.title}</h2>
          </div>
          <button type="button" className="belt-button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </div>

        <form className="signal-drawer-form" onSubmit={submit}>
          <label className="belt-field">
            <span>标题 / TITLE</span>
            <input
              className="belt-input"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={board === 'bounty' ? '例如：回收外环测绘浮标' : '一句话标题'}
              autoFocus
              required
            />
          </label>

          <label className="belt-field">
            <span>正文 / BODY</span>
            <textarea
              className="belt-textarea signal-drawer-body"
              value={body}
              maxLength={8000}
              onChange={(event) => setBody(event.target.value)}
              placeholder={copy.body}
              required
            />
          </label>

          {board === 'bounty' ? (
            <div className="belt-form-row">
              <label className="belt-field">
                <span>赏金 / REWARD</span>
                <input
                  className="belt-input"
                  value={reward}
                  maxLength={80}
                  onChange={(event) => setReward(event.target.value)}
                  placeholder="面议 / 1200 环带券"
                />
              </label>
              <label className="belt-field">
                <span>截止 / DEADLINE</span>
                <input
                  className="belt-input"
                  type="datetime-local"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </label>
            </div>
          ) : null}

          {!canPost ? (
            <p className="belt-error">
              <code>PERMISSION</code> 环带快报仅协议官可签发。
            </p>
          ) : null}
          {error ? (
            <p className="belt-error" role="alert">
              <code>POST_FAILED</code> {error}
            </p>
          ) : null}

          <div className="signal-drawer-actions">
            <span className="belt-hint">纯文本 · 不支持附件 · 进入公开环带</span>
            <button
              type="submit"
              className="belt-button is-signal signal-publish"
              disabled={busy || !canPost || !title.trim() || !body.trim()}
            >
              {busy ? '发射中…' : '发布新信号'}
            </button>
          </div>
        </form>
        </aside>
      </div>
    </div>,
    document.body,
  );
}
