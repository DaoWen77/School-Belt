'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api, errorOf } from '@/lib/api';
import type { ArchiveItem } from '@/lib/types';
import { useFileUrl } from '@/lib/useFileUrl';
import { ArchiveCover } from './ArchiveCover';
import { ArchiveDrawer } from './ArchiveDrawer';
import { ArchiveIcon, ImageIcon } from './icons';
import { ScrambleText } from './ScrambleText';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalize(raw: unknown): ArchiveItem | null {
  const item = asRecord(raw);
  if (!item) return null;
  const id = String(item.id ?? '');
  if (!id) return null;
  return {
    id,
    kind: typeof item.kind === 'string' ? item.kind : 'material',
    title: typeof item.title === 'string' ? item.title : '未命名档案',
    body: typeof item.body === 'string' ? item.body : null,
    channelId: typeof item.channelId === 'string' ? item.channelId : null,
    channelName: typeof item.channelName === 'string' ? item.channelName : undefined,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
    attachments: Array.isArray(item.fileIds)
      ? (item.fileIds as string[]).map((fileId) => ({ id: fileId, fileId, originalName: 'image', mime: 'image/*', kind: 'image' }))
      : Array.isArray(item.attachments)
        ? (item.attachments as ArchiveItem['attachments'])
        : Array.isArray(item.imageFileIds)
          ? (item.imageFileIds as string[]).map((fileId) => ({ id: fileId, fileId, originalName: 'image', mime: 'image/*', kind: 'image' }))
          : [],
  };
}

function ArchiveThumb({ fileId, alt, fallback }: { fileId: string; alt: string; fallback: ReactNode }) {
  const { url, error } = useFileUrl(fileId, 'preview');
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [fileId]);
  if (error || failed) return <>{fallback}</>;
  if (!url) return <span className="archive-image-loading archive-image-loading--card" />;
  return (
    <img
      src={url}
      alt={alt}
      className="archive-image archive-image--card"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

const KIND_LABEL: Record<string, string> = { material: '素材', artwork: '作品', idea: '灵感', vote: '投票', task: '任务', music: '音乐', chart: '图表' };

function dateOf(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

export function ArchiveView() {
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [selected, setSelected] = useState<ArchiveItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<unknown>('/archive')
      .then((data) => {
        if (cancelled) return;
        const record = asRecord(data);
        const list = Array.isArray(data) ? data : Array.isArray(record?.items) ? record.items : Array.isArray(record?.cards) ? record.cards : [];
        setItems(list.map(normalize).filter((item): item is ArchiveItem => Boolean(item)));
      })
      .catch((caught) => {
        if (!cancelled) setError(errorOf(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="im-scroll min-h-0 flex-1 bg-paper px-3 py-3 md:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-ink pb-2">
          <ArchiveIcon size={16} />
          <h2 className="font-mono text-[15px] font-bold text-ink">
            <ScrambleText text="ARCHIVE / 档案室" />
          </h2>
          <span className="ml-auto font-mono text-[10px] text-ink-2">{loading ? 'SCANNING…' : `${items.length} RECORDS`}</span>
        </div>
        {error ? (
          <p className="mb-3 flex items-center gap-2 border border-line bg-panel px-3 py-2 text-[11px] text-ink">
            <span className="bg-accent px-1 font-sans text-[9px] font-bold uppercase text-on-accent">{error.code}</span>
            {error.message}
          </p>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <p className="border border-line bg-panel px-3 py-6 text-center font-mono text-[11px] text-ink-2">NO RECORDS / 暂无档案</p>
        ) : null}
        <div className="archive-grid">
          {items.map((item) => {
            const thumb = item.attachments?.find((attachment) => attachment.mime?.startsWith('image/') || attachment.kind === 'image');
            const cover = <ArchiveCover id={item.id} kind={item.kind} />;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className="archive-card group"
                aria-label={`打开档案 ${item.title}`}
              >
                <div className="archive-card-cover">
                  {thumb ? <ArchiveThumb fileId={thumb.fileId} alt={item.title} fallback={cover} /> : cover}
                </div>
                <div className="archive-card-body">
                  <span className="archive-card-kicker">
                    {KIND_LABEL[item.kind] ?? item.kind}
                    <span>{dateOf(item.createdAt)}</span>
                  </span>
                  <ScrambleText text={item.title} className="archive-card-title" />
                  {item.body ? <p className="archive-card-deck">{item.body.slice(0, 90)}</p> : <p className="archive-card-deck is-empty">无正文 · 打开档案查看元数据</p>}
                  <span className="archive-card-foot">
                    <span>#{item.id.slice(0, 6)}</span>
                    <span>{item.channelName ?? '档案库'} →</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <ArchiveDrawer
        item={selected}
        onClose={() => setSelected(null)}
        onUpdated={(next) => {
          setItems((previous) => previous.map((item) => (item.id === next.id ? next : item)));
          setSelected(next);
        }}
        onDeleted={(id) => {
          setItems((previous) => previous.filter((item) => item.id !== id));
          setSelected(null);
        }}
      />
    </div>
  );
}
