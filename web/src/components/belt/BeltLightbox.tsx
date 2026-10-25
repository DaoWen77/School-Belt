'use client';

import { createPortal } from 'react-dom';

/** 全屏暗黑媒体预览：点击遮罩 / 关闭按钮退出，Esc 同样关闭。 */
export function BeltLightbox({
  src,
  kind,
  title,
  onClose,
}: {
  src: string;
  kind: 'image' | 'video';
  title?: string;
  onClose: () => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="belt-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `预览 ${title}` : '媒体预览'}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <button type="button" className="belt-lightbox-close" aria-label="关闭预览" onClick={onClose}>
        ×
      </button>
      <div className="belt-lightbox-stage" onClick={(event) => event.stopPropagation()}>
        {kind === 'video' ? (
          <video src={src} controls autoPlay playsInline />
        ) : (
          <img src={src} alt={title ?? '媒体预览'} />
        )}
      </div>
      <p className="belt-lightbox-hint">点击遮罩关闭 / ESC</p>
    </div>,
    document.body,
  );
}
