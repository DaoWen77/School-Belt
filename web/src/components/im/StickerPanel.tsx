'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorOf } from '@/lib/api';
import { askConfirm } from '@/lib/confirm';
import { uploadFile, precheckFile } from '@/lib/upload';
import { useFileUrl } from '@/lib/useFileUrl';
import type { Sticker } from '@/lib/types';
import { CloseIcon, StickerIcon } from './icons';

function StickerImage({ sticker }: { sticker: Sticker }) {
  const { url, error } = useFileUrl(sticker.fileId, 'preview');
  if (error) return <span className="grid h-20 w-20 place-items-center border border-line text-[9px] text-ink-2">不可用</span>;
  if (!url) return <span className="grid h-20 w-20 animate-pulse place-items-center border border-line bg-chip text-[9px] text-ink-2">加载中</span>;
  return <img src={url} alt={sticker.name ?? '贴纸'} className="h-20 w-20 object-contain" loading="lazy" />;
}

function normalizeStickers(data: unknown): Sticker[] {
  if (Array.isArray(data)) return data as Sticker[];
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const list = record.stickers ?? record.items ?? record.data;
    if (Array.isArray(list)) return list as Sticker[];
  }
  return [];
}

export function StickerPanel({
  open,
  onClose,
  channelId,
  meId,
  onSend,
  onStickersChange,
}: {
  open: boolean;
  onClose: () => void;
  channelId: string | null;
  meId: string | null;
  onSend: (sticker: Sticker) => void;
  onStickersChange: (stickers: Sticker[]) => void;
}) {
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onStickersChangeRef = useRef(onStickersChange);
  onStickersChangeRef.current = onStickersChange;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>('/stickers');
      const next = normalizeStickers(data).map((sticker) => ({ ...sticker, createdBy: sticker.createdBy ?? meId }));
      setStickers(next);
      onStickersChangeRef.current(next);
    } catch (caught) {
      const info = errorOf(caught);
      setError(info);
      setStickers([]);
      onStickersChangeRef.current([]);
    } finally {
      setLoading(false);
    }
  }, [meId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const upload = async (file: File) => {
    if (!channelId) {
      setError({ code: 'NO_CHANNEL', message: '尚未选择会话' });
      return;
    }
    const precheck = precheckFile(file);
    if (!precheck.ok || precheck.kind !== 'image') {
      setError({ code: 'FILE_TYPE_NOT_ALLOWED', message: '贴纸必须是图片' });
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const view = await uploadFile(channelId, file);
      await api('/stickers', {
        method: 'POST',
        body: JSON.stringify({ fileId: view.id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) }),
      });
      await load();
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (sticker: Sticker) => {
    if (
      !(await askConfirm(`删除贴纸「${sticker.name ?? '未命名'}」？`, {
        title: '删除贴纸',
        confirmText: '删除贴纸',
        danger: true,
      }))
    )
      return;
    setError(null);
    try {
      await api(`/stickers/${sticker.id}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      setError(errorOf(caught));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[#161616]/50 p-4" role="dialog" aria-modal="true" aria-label="贴纸面板">
      <div className="cut-corner max-h-[86dvh] w-full max-w-md overflow-y-auto border border-ink bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <StickerIcon size={15} />
          <p className="flex-1 text-[13px] font-extrabold text-ink">贴纸</p>
          <button type="button" onClick={onClose} className="p-1 text-ink-2 hover:text-ink" aria-label="关闭贴纸面板">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              disabled={uploading || !channelId}
              onClick={() => inputRef.current?.click()}
              className="cut-corner-sm border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-ink hover:text-ink disabled:opacity-40"
            >
              {uploading ? '上传中…' : '上传贴纸'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
            <span className="text-[10px] text-ink-2">{loading ? '读取中…' : `${stickers.length} 个`}</span>
          </div>

          {error ? (
            <p className="mb-2 flex items-center gap-2 border border-line px-2 py-1.5 text-[11px] text-ink">
              <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{error.code}</span>
              {error.message}
            </p>
          ) : null}

          {stickers.length === 0 && !loading ? <p className="py-4 text-center text-[11px] text-ink-2">还没有贴纸</p> : null}

          <ul className="grid grid-cols-4 gap-2">
            {stickers.map((sticker) => (
              <li key={sticker.id} className="group relative flex flex-col items-center gap-1">
                <button
                  type="button"
                  className="border border-line p-1 hover:border-ink"
                  onClick={() => {
                    onSend(sticker);
                    onClose();
                  }}
                  aria-label={`发送贴纸 ${sticker.name ?? ''}`}
                >
                  <StickerImage sticker={sticker} />
                </button>
                <span className="max-w-full truncate text-[9px] text-ink-2">{sticker.name ?? '贴纸'}</span>
                {sticker.createdBy === meId ? (
                  <button
                    type="button"
                    onClick={() => void remove(sticker)}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 place-items-center bg-ink text-[9px] text-white group-hover:grid"
                    aria-label={`删除贴纸 ${sticker.name ?? ''}`}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
