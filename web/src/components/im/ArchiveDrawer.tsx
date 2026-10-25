'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import type { ArchiveItem } from '@/lib/types';
import { useFileUrl } from '@/lib/useFileUrl';
import { ArchiveCover } from './ArchiveCover';
import { CloseIcon } from './icons';

const KIND_LABEL: Record<string, string> = {
  material: '素材',
  artwork: '作品',
  idea: '灵感',
  vote: '投票',
  task: '任务',
  music: '音乐',
  chart: '图表',
};

function dayOf(iso?: string | null): string {
  if (!iso) return '非归档时间';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function ArchiveImage({ fileId, alt, size = 'card' }: { fileId: string; alt: string; size?: 'card' | 'drawer' }) {
  const { url, error } = useFileUrl(fileId, 'preview');
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [fileId]);
  if (error || failed) return <ArchiveCover id={fileId} kind="material" size={size} hasImage />;
  if (!url) return <span className={`archive-image-loading archive-image-loading--${size}`} />;
  return (
    <img
      src={url}
      alt={alt}
      className={`archive-image archive-image--${size}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * 档案详情抽屉：点击档案卡不再跳聊天，而是在这里看全文并编辑/软删除。
 * 使用现有 PATCH/DELETE /cards/:id，不新增表结构。
 */
export function ArchiveDrawer({
  item,
  onClose,
  onUpdated,
  onDeleted,
}: {
  item: ArchiveItem | null;
  onClose: () => void;
  onUpdated: (item: ArchiveItem) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setEditing(false);
    setTitle(item.title);
    setBody(item.body ?? '');
    setError(null);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, item, onClose]);

  if (!item || typeof document === 'undefined') return null;

  const images = (item.attachments ?? []).filter(
    (attachment) => attachment.kind === 'image' || attachment.mime?.startsWith('image/'),
  );

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<unknown>(`/cards/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim(), body: body.trim() || null }),
      });
      const record = updated && typeof updated === 'object' ? (updated as Record<string, unknown>) : {};
      const next: ArchiveItem = {
        ...item,
        title: typeof record.title === 'string' ? record.title : title.trim(),
        body: typeof record.body === 'string' ? record.body : body.trim() || null,
      };
      onUpdated(next);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    if (!window.confirm(`删除档案「${item.title}」？这是软删除，将从档案室移除。`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/cards/${item.id}`, { method: 'DELETE' });
      onDeleted(item.id);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="signal-drawer-layer">
      <button
        type="button"
        className="signal-drawer-backdrop"
        aria-label="关闭档案详情"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <aside className="signal-drawer archive-drawer" role="dialog" aria-modal="true" aria-label="档案详情">
        <div className="signal-drawer-head">
          <div className="min-w-0">
            <p className="signal-drawer-kicker">ARCHIVE RECORD / {item.kind.toUpperCase()}</p>
            <h2 className="truncate">{editing ? '编辑档案' : item.title}</h2>
          </div>
          <button type="button" className="ef-btn small" onClick={onClose} disabled={busy} aria-label="关闭">
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="archive-drawer-body">
          {images.length > 0 ? (
            <div className="archive-drawer-gallery">
              {images.map((attachment) => (
                <ArchiveImage key={attachment.fileId} fileId={attachment.fileId} alt={item.title} size="drawer" />
              ))}
            </div>
          ) : (
            <ArchiveCover id={item.id} kind={item.kind} size="drawer" />
          )}

          <div className="archive-drawer-meta">
            <span className="belt-stamp is-signal">{KIND_LABEL[item.kind] ?? item.kind}</span>
            <span>#{item.id.slice(0, 8)}</span>
            <span>{dayOf(item.createdAt)}</span>
            {item.channelName ? <span>{item.channelName}</span> : null}
          </div>

          {editing ? (
            <div className="archive-edit">
              <label className="belt-field">
                <span>标题 / TITLE</span>
                <input className="belt-input" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="belt-field">
                <span>正文 / BODY</span>
                <textarea
                  className="belt-textarea archive-edit-body"
                  value={body}
                  maxLength={4000}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="档案正文…"
                />
              </label>
            </div>
          ) : (
            <div className="archive-read">
              {item.body ? <p>{item.body}</p> : <p className="text-ink-2">这份档案没有正文。</p>}
            </div>
          )}

          {error ? (
            <p className="belt-error" role="alert">
              <code>ARCHIVE_ERROR</code> {error}
            </p>
          ) : null}
        </div>

        <div className="archive-drawer-actions">
          {editing ? (
            <>
              <button type="button" className="ef-btn small" onClick={() => setEditing(false)} disabled={busy}>
                取消
              </button>
              <button type="button" className="ef-btn small go" onClick={() => void save()} disabled={busy || !title.trim()}>
                {busy ? '保存中…' : '保存修改'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ef-btn small" onClick={() => setEditing(true)}>
                编辑
              </button>
              <button type="button" className="ef-btn small danger" onClick={() => void remove()} disabled={busy}>
 {busy ? '处理中…' : '删除'}
              </button>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
