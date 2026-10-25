import { api } from './api';

interface UrlResponse {
  id: string;
  url: string;
  variant: string;
  expiresIn: number;
}

type Variant = 'original' | 'preview';

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<string>>();

const keyOf = (fileId: string, variant: Variant) => `${fileId}:${variant}`;

/**
 * S3 回写地址归一化：仅把 loopback host（127.0.0.1 / localhost）替换为当前浏览器 hostname，
 * 保留原端口、path、query；其他域名原样返回（LAN 访问时签名 URL 才能从 192.168.x.x 打开）。
 */
export function resolvePublicUrl(url: string): string {
  if (!url || typeof window === 'undefined') return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return url;
    parsed.hostname = window.location.hostname;
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * 取文件签名 URL：
 * - 服务端返回 expiresIn（秒），这里提前 60s 过期，避免边界失效；
 * - 同一 fileId+variant 并发只发一次请求；
 * - 过期后调用方再次取用时自动重新签名（组件重渲染 / 进入会话时会触发）。
 */
export function getFileUrl(fileId: string, variant: Variant = 'original'): Promise<string> {
  const key = keyOf(fileId, variant);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const task = api<UrlResponse>(`/files/${fileId}/url?variant=${variant}`)
    .then((response) => {
      const ttl = Number.isFinite(response.expiresIn) && response.expiresIn > 0 ? response.expiresIn : 900;
      const url = resolvePublicUrl(response.url);
      cache.set(key, { url, expiresAt: Date.now() + Math.max(60, ttl - 60) * 1000 });
      return url;
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, task);
  return task;
}

export function invalidateFileUrl(fileId: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${fileId}:`)) cache.delete(key);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dj:file-url-invalidated', { detail: { fileId } }));
  }
}

/** 进入会话 / 卡片刷新时批量预热签名 URL（失败的忽略，交给单个附件显示错误）。 */
export function warmFileUrls(attachments: readonly { fileId: string; mime?: string }[]): void {
  for (const attachment of attachments) {
    void getFileUrl(attachment.fileId, attachment.mime?.startsWith('image/') ? 'preview' : 'original').catch(() => {
      /* 单个文件失败不影响其它附件 */
    });
  }
}
