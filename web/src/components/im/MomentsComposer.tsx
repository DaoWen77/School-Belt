'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorOf } from '@/lib/api';
import { precheckFile, uploadFile } from '@/lib/upload';
import { useFileUrl } from '@/lib/useFileUrl';
import { CloseIcon, ImageIcon } from './icons';

function ComposerImage({ fileId, alt }: { fileId: string; alt: string }) {
  const { url, error } = useFileUrl(fileId, 'preview');
  if (error) return <span className="grid h-20 w-20 place-items-center border border-line text-[8px] text-ink-2">不可用</span>;
  if (!url) return <span className="h-20 w-20 animate-pulse border border-line bg-chip" />;
  return <img src={url} alt={alt} className="h-20 w-20 border border-line object-cover" loading="lazy" />;
}

/**
 * 朋友圈发布抽屉：把常驻发帖框从信息流里移出。
 * 提交成功后关闭并触发列表刷新。
 */
export function MomentsComposer({
  open,
  channelId,
  onClose,
  onPosted,
}: {
  open: boolean;
  channelId: string | null;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [body, setBody] = useState('');
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !posting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open, posting]);

  if (!open) return null;

  const uploadImages = async (files: File[]) => {
    if (!channelId) {
      setError({ code: 'NO_CHANNEL', message: '需要先选择一个频道作为上传 scope' });
      return;
    }
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const precheck = precheckFile(file);
        if (!precheck.ok || precheck.kind !== 'image') {
          setError({ code: 'FILE_TYPE_NOT_ALLOWED', message: '朋友圈图片必须是图片文件' });
          continue;
        }
        const view = await uploadFile(channelId, file);
        setFileIds((previous) => [...previous, view.id]);
      }
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setUploading(false);
    }
  };

  const publish = async () => {
    if (!body.trim() && fileIds.length === 0) return;
    setPosting(true);
    setError(null);
    try {
      await api('/posts', {
        method: 'POST',
        body: JSON.stringify({ body: body.trim(), fileIds }),
      });
      setBody('');
      setFileIds([]);
      onPosted();
      onClose();
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setPosting(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="signal-drawer-layer">
      <button
        type="button"
        className="signal-drawer-backdrop"
        aria-label="关闭发布抽屉"
        onClick={() => {
          if (!posting) onClose();
        }}
      />
      <aside className="signal-drawer" role="dialog" aria-modal="true" aria-label="发布朋友圈动态">
        <div className="signal-drawer-head">
          <div>
            <p className="signal-drawer-kicker">MOMENTS / PERSONAL LOG</p>
            <h2>发布动态</h2>
          </div>
          <button type="button" className="ef-btn small" onClick={onClose} disabled={posting}>
            关闭
          </button>
        </div>

        <div className="signal-drawer-form">
          <label className="belt-field">
            <span>正文 / BODY</span>
            <textarea
              className="belt-textarea signal-drawer-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="记录一条信号…"
              maxLength={2000}
              aria-label="朋友圈正文"
              autoFocus
            />
          </label>

          <div className="signal-drawer-files">
            {fileIds.map((fileId) => (
              <span key={fileId} className="relative inline-block">
                <ComposerImage fileId={fileId} alt="待发布图片" />
                <button
                  type="button"
                  onClick={() => setFileIds((previous) => previous.filter((id) => id !== fileId))}
                  className="absolute right-0 top-0 grid h-5 w-5 place-items-center bg-ink text-white"
                  aria-label="移除图片"
                >
                  <CloseIcon size={10} />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || !channelId}
              className="ef-btn small"
            >
              <ImageIcon size={12} /> {uploading ? '上传中…' : '图片'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                if (files.length) void uploadImages(files);
              }}
            />
          </div>

          {error ? (
            <p className="belt-error" role="alert">
              <code>{error.code}</code> {error.message}
            </p>
          ) : null}

          <div className="signal-drawer-actions">
            <span className="belt-hint">图片可选 · 发布后回到朋友圈信息流</span>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={posting || (!body.trim() && fileIds.length === 0)}
              className="cut-corner-sm bg-accent px-3 py-1.5 text-[11px] font-bold text-on-accent disabled:opacity-40 signal-publish"
            >
              {posting ? '发布中…' : '发布'}
            </button>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
