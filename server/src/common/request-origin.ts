import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 请求级公网源：让文件 URL 跟随「访问者使用的主机名」生成。
 *
 * 背景：`PUBLIC_API_ORIGIN` 是全局常量，内网用户也会被迫从公网域名拉图，
 * 白白绕一圈香港 BGP。改成 per-request：谁用什么 host 访问，媒体 URL 就用什么 host。
 * 非 HTTP 上下文（脚本/定时任务）没有 ALS 值，回落到配置里的 PUBLIC_API_ORIGIN。
 */
export interface RequestOriginStore {
  origin: string;
}

export const requestOriginStore = new AsyncLocalStorage<RequestOriginStore>();

export function currentOrigin(): string | undefined {
  return requestOriginStore.getStore()?.origin;
}

/** 从请求头推导 origin：X-Forwarded-* 优先（穿透/反代），否则 Host */
export function originOf(headers: Record<string, string | string[] | undefined>): string | undefined {
  const first = (value: string | string[] | undefined): string | undefined =>
    (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
  const proto = first(headers['x-forwarded-proto']) ?? 'http';
  const host = first(headers['x-forwarded-host']) ?? first(headers.host);
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return undefined;
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}
