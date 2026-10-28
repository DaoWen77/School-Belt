'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { beltApi, beltFileUrl } from '@/lib/beltApi';
import { resolvePublicUrl } from '@/lib/fileUrl';
import { BeltLightbox } from './BeltLightbox';
import type { BeltUser } from '@/lib/beltApi';

type Board = 'bulletin' | 'bounty' | 'daily' | 'moments' | 'campus';

/** 可自由切换板块的社交型投稿。 */
const SOCIAL_BOARDS: Board[] = ['daily', 'moments', 'campus'];

const BOARD_OPTIONS = [
  { key: 'moments', label: '动态' },
  { key: 'campus', label: '校园' },
  { key: 'daily', label: '日常' },
] as const;

const COPY: Record<Board, { eyebrow: string; title: string; body: string }> = {
  moments: {
    eyebrow: 'MOMENTS / 环塔动态',
    title: '发布一条动态',
    body: '此刻在做什么、看到什么，随手记下来…',
  },
  campus: {
    eyebrow: 'CAMPUS / 校园墙',
    title: '投稿校园墙',
    body: '校园里的新鲜事、失物招领、组队搭子…',
  },
  bulletin: {
    eyebrow: 'OFFICIAL DISPATCH / 协议官签发',
    title: '签发环塔快报',
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
  const [coverFileId, setCoverFileId] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Board>(board);

  useEffect(() => {
    if (!open) return;
    setPicked(board);
  }, [board, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, open]);

  if (!open) return null;

  const uploadCover = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const presign = await beltApi<{ fileId: string; uploadUrl: string; headers?: Record<string, string> }>(
        '/belt/files/post-media/presign',
        { method: 'POST', body: JSON.stringify({ filename: file.name, mime: file.type, size: file.size }) },
      );
      try {
        const response = await fetch(resolvePublicUrl(presign.uploadUrl), {
          method: 'PUT',
          headers: presign.headers ?? {},
          body: file,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await beltApi(`/belt/files/${presign.fileId}/complete`, { method: 'POST', body: '{}' });
      } catch {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(new Error('读取封面失败'));
          reader.readAsDataURL(file);
        });
        await beltApi(`/belt/files/${presign.fileId}/upload`, { method: 'POST', body: JSON.stringify({ data: base64 }) });
      }
      setCoverFileId(presign.fileId);
      setCoverPreview(await beltFileUrl(presign.fileId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '封面上传失败');
    } finally {
      setUploading(false);
    }
  };

  const copy = COPY[picked];
  const isSocial = SOCIAL_BOARDS.includes(picked);
  const canPost = picked !== 'bulletin' || user.globalRole === 'owner' || user.globalRole === 'admin';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // 日志板 = 朋友圈：可只发纯文字，标题留空后端取正文首行。
    if (!canPost || (!isSocial && !title.trim()) || !body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await beltApi('/belt/posts', {
        method: 'POST',
        body: JSON.stringify({
          board: picked,
          title: title.trim(),
          body: body.trim(),
          ...(picked === 'bounty' && reward.trim() ? { bountyReward: reward.trim() } : {}),
          ...(picked === 'bounty' && deadline
            ? { bountyDeadline: new Date(deadline).toISOString() }
            : {}),
          ...(coverFileId ? { coverFileId } : {}),
        }),
      });
      setTitle('');
      setBody('');
      setReward('');
      setDeadline('');
      setCoverFileId(null);
      setCoverPreview(null);
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
          {SOCIAL_BOARDS.includes(board) ? (
            <div className="belt-board-switch" role="group" aria-label="选择投稿板块">
              {BOARD_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`belt-board-option${picked === option.key ? ' is-active' : ''}`}
                  aria-pressed={picked === option.key}
                  onClick={() => setPicked(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <label className="belt-field">
            <span>标题 / TITLE</span>
            <input
              className="belt-input"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={picked === 'bounty' ? '例如：回收外环测绘浮标' : '一句话标题（可留空）'}
              autoFocus
              required={!isSocial}
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

          {picked === 'bounty' ? (
            <div className="belt-form-row">
              <label className="belt-field">
                <span>赏金 / REWARD</span>
                <input
                  className="belt-input"
                  value={reward}
                  maxLength={80}
                  onChange={(event) => setReward(event.target.value)}
                  placeholder="面议 / 1200 环塔券"
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
              <code>PERMISSION</code> 环塔快报仅协议官可签发。
            </p>
          ) : null}
          {error ? (
            <p className="belt-error" role="alert">
              <code>POST_FAILED</code> {error}
            </p>
          ) : null}

          <div className="belt-composer-extras">
            <label className="belt-button belt-upload-label">
              {uploading ? '封面上传中…' : coverPreview ? '更换封面' : '＋ 封面图片'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadCover(file);
                }}
              />
            </label>
            {coverPreview ? (
              <button type="button" className="belt-cover-thumb" onClick={() => setLightbox(coverPreview)}>
                <img src={coverPreview} alt="封面预览" />
              </button>
            ) : null}
            <button type="button" className="belt-button" onClick={() => setEmojiOpen((value) => !value)}>
              ☺ 表情
            </button>
            {emojiOpen ? (
              <div className="belt-emoji-grid">
                {['⚡', '🌐', '🛰️', '🎧', '👾', '💾', '🔮', '🧬', '🕹️', '📡', '🌒', '⚙️', '🔥', '💿', '🚀', '🩸'].map((emoji) => (
                  <button key={emoji} type="button" onClick={() => setBody((value) => `${value}${emoji}`)}>
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="signal-drawer-actions">
            <span className="belt-hint">纯文本 · 不支持附件 · 进入公开环塔</span>
            <button
              type="submit"
              className="belt-button is-signal signal-publish"
              disabled={busy || !canPost || (!isSocial && !title.trim()) || !body.trim()}
            >
              {busy ? '发射中…' : '发布新信号'}
            </button>
          </div>
        </form>
        </aside>
      </div>
      {lightbox ? <BeltLightbox src={lightbox} kind="image" onClose={() => setLightbox(null)} /> : null}
    </div>,
    document.body,
  );
}
