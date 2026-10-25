'use client';

import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '@/lib/types';
import { useFileUrl } from '@/lib/useFileUrl';
import { formatBytes } from '@/lib/upload';

function ImageThumb({ attachment, onOpen, sticker = false }: { attachment: Attachment; onOpen: () => void; sticker?: boolean }) {
  const { url, error } = useFileUrl(attachment.fileId, 'preview');
  if (error) {
    return (
      <span className="dj-attach-error" title={error.message}>
        图片不可用（{error.code}）
      </span>
    );
  }
  if (!url) return <span className="dj-attach-loading">图片加载中…</span>;
  return (
    <button
      type="button"
      className={sticker ? 'dj-attach-img is-sticker' : 'dj-attach-img'}
      onClick={onOpen}
      aria-label={`查看大图 ${attachment.originalName}`}
    >
      <img src={url} alt={attachment.originalName} loading="lazy" />
    </button>
  );
}

function FileRow({ attachment }: { attachment: Attachment }) {
  const { url, error } = useFileUrl(attachment.fileId, 'original');
  return (
    <span className="dj-attach-file">
      <span className="dj-attach-name">{attachment.originalName}</span>
      <span className="ef-field">
        {attachment.mime || attachment.kind} · {formatBytes(attachment.sizeBytes)}
      </span>
      {error ? (
        <span className="dj-attach-error">链接失败（{error.code}）</span>
      ) : url ? (
        <a className="dj-textlink" href={url} download={attachment.originalName} target="_blank" rel="noreferrer">
          下载
        </a>
      ) : (
        <span className="ef-field">获取链接…</span>
      )}
    </span>
  );
}

function Lightbox({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { url, error } = useFileUrl(attachment.fileId, 'original');

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="ef-dialog dj-lightbox"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="ef-panel cut-br dj-lightbox-inner">
        <p className="ef-eyebrow slash">Preview / 大图</p>
        <h2>{attachment.originalName}</h2>
        {error ? (
          <p className="ef-notice" data-flag={error.code}>
            {error.message}
          </p>
        ) : url ? (
          <img className="dj-lightbox-img" src={url} alt={attachment.originalName} />
        ) : (
          <p className="ef-field">正在取原图…</p>
        )}
        <p className="ef-actions">
          {url ? (
            <a className="ef-btn small" href={url} download={attachment.originalName} target="_blank" rel="noreferrer">
              下载原图
            </a>
          ) : null}
          <button className="ef-btn small" type="button" onClick={onClose}>
            关闭
          </button>
        </p>
      </div>
    </dialog>
  );
}

export function AttachmentList({
  attachments,
  compact = false,
  stickerIds = [],
}: {
  attachments: Attachment[] | undefined;
  compact?: boolean;
  stickerIds?: string[];
}) {
  const [selected, setSelected] = useState<Attachment | null>(null);
  if (!attachments || attachments.length === 0) return null;
  const images = attachments.filter((attachment) => attachment.mime?.startsWith('image/'));
  const files = attachments.filter((attachment) => !attachment.mime?.startsWith('image/'));

  return (
    <>
      <div className={compact ? 'dj-attachments is-compact' : 'dj-attachments'}>
        {images.length > 0 ? (
          <div className="dj-attach-imgs">
            {images.map((attachment) => (
              <ImageThumb
                key={attachment.id}
                attachment={attachment}
                sticker={stickerIds.includes(attachment.fileId)}
                onOpen={() => setSelected(attachment)}
              />
            ))}
          </div>
        ) : null}
        {files.length > 0 ? (
          <div className="dj-attach-files">
            {files.map((attachment) => (
              <FileRow key={attachment.id} attachment={attachment} />
            ))}
          </div>
        ) : null}
      </div>
      {selected ? <Lightbox attachment={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
