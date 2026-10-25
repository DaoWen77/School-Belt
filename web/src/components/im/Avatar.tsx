'use client';

import { useEffect, useState } from 'react';
import { useFileUrl } from '@/lib/useFileUrl';
import { initialOf } from '@/lib/format';

/**
 * 头像：优先加载签名 URL 的预览图。
 * - 加载中/加载失败都显示首字母占位，避免黑块/破图；
 * - fileId 变化时重置失败状态，允许重试。
 */
export function Avatar({
  name,
  fileId,
  size = 32,
  className = '',
}: {
  name: string;
  fileId?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ fileId?: string }>).detail;
      if (fileId && detail?.fileId === fileId) setVersion((value) => value + 1);
    };
    window.addEventListener('dj:file-url-invalidated', handler);
    return () => window.removeEventListener('dj:file-url-invalidated', handler);
  }, [fileId]);

  const { url } = useFileUrl(fileId ?? null, 'preview', version);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [fileId, url]);

  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.34)) };
  const showImage = Boolean(url) && !failed;

  return (
    <span style={style} className={`relative grid shrink-0 place-items-center overflow-hidden border border-line bg-ink font-bold text-white ${className}`}>
      {showImage ? (
        <img
          src={url as string}
          alt={name}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : null}
      {!showImage || !loaded ? <span aria-hidden={showImage}>{initialOf(name)}</span> : null}
    </span>
  );
}
