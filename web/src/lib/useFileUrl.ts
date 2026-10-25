'use client';

import { useEffect, useState } from 'react';
import { errorOf } from './api';
import { getFileUrl } from './fileUrl';

export type FileVariant = 'original' | 'preview';

export interface FileUrlState {
  url: string | null;
  error: { code: string; message: string } | null;
}

/** 签名 URL 的 React 读取：过期后自动重新签名（进入会话 / 重渲染时触发）。 */
export function useFileUrl(fileId: string | null | undefined, variant: FileVariant = 'original', version = 0): FileUrlState {
  const [state, setState] = useState<FileUrlState>({ url: null, error: null });

  useEffect(() => {
    if (!fileId) {
      setState({ url: null, error: null });
      return;
    }
    let cancelled = false;
    setState({ url: null, error: null });
    getFileUrl(fileId, variant)
      .then((url) => {
        if (!cancelled) setState({ url, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ url: null, error: errorOf(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, variant, version]);

  return state;
}
