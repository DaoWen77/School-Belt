'use client';

import { useEffect, useState } from 'react';
import { beltFileUrl } from '@/lib/beltApi';

const urlCache = new Map<string, Promise<string>>();

/** 环带头像：S3 签名 URL，按 fileId 去重请求；失败时退回首字母。 */
export function BeltAvatar({
  fileId,
  name,
  size = 'md',
  neon = false,
}: {
  fileId?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  neon?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const fallback = (name || '?').trim().slice(0, 1).toUpperCase();

  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    const cached = urlCache.get(fileId);
    const promise = cached ?? beltFileUrl(fileId);
    if (!cached) urlCache.set(fileId, promise);
    promise
      .then((value) => {
        if (!cancelled) setUrl(value);
      })
      .catch(() => {
        urlCache.delete(fileId);
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  return (
    <span className={`belt-avatar belt-avatar-${size}${neon ? ' is-neon' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" /> : <span>{fallback}</span>}
    </span>
  );
}
