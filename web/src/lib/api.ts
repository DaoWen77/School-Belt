import { session } from './session';

const API_STORAGE_KEY = 'dj-server-api';
const WS_STORAGE_KEY = 'dj-server-ws';

function stripBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isWsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/** 构建期注入的 localhost 不能覆盖局域网/公网访问。 */
function isStaleLoopback(value: string): boolean {
  if (typeof window === 'undefined') return false;
  if (isLoopbackHost(window.location.hostname)) return false;
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function savedBase(key: string, allowWs = false): string {
  if (typeof window === 'undefined') return '';
  try {
    const value = window.localStorage.getItem(key) ?? '';
    return (allowWs && isWsUrl(value)) || isHttpUrl(value) ? stripBase(value) : '';
  } catch {
    return '';
  }
}

function envApiBase(): string {
  const value = stripBase(process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE ?? '');
  return value && !isStaleLoopback(value) ? value : '';
}

function envWsBase(): string {
  const value = stripBase(process.env.NEXT_PUBLIC_WS_URL ?? '');
  if (!value || isStaleLoopback(value)) return '';
  return isWsUrl(value) ? value : toWsProtocol(value);
}

/** http(s) → ws(s)；Socket.IO 与展示都使用同一份动态地址。 */
function toWsProtocol(value: string): string {
  if (!value) return '';
  if (isWsUrl(value)) return stripBase(value);
  try {
    const url = new URL(value);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return stripBase(url.toString());
  } catch {
    return '';
  }
}

/**
 * 无自定义服务器时的默认 API 地址：
 * - 页面在 3100 → 同一 hostname 的 3000；
 * - 页面在 3000 / 80 / 443 → 同源；
 * - HTTPS 页面自动使用 https，WS 由调用方切到 wss。
 * 绝不再回退到 localhost。
 */
function locationApiBase(): string {
  if (typeof window === 'undefined' || !window.location) return '';
  const { protocol, hostname, port } = window.location;
  const httpProtocol = protocol === 'https:' ? 'https:' : 'http:';
  const apiPort = port && port !== '3000' ? '3000' : port;
  return `${httpProtocol}//${hostname}${apiPort ? `:${apiPort}` : ''}`;
}

/**
 * API 基地址解析：
 * 1. 登录页保存的 localStorage（dj-server-api）；
 * 2. NEXT_PUBLIC_API_BASE_URL（兼容旧 NEXT_PUBLIC_API_BASE）；
 * 3. 浏览器当前 hostname 的 :3000（HTTPS 自动 https）；
 * 4. 纯 SSR 无法获知 hostname 时返回空串，由客户端水合后重新解析。
 */
const TUNNEL_HOST_RE = /\.ofalias\.net$/i;

/** 穿透域名专用 API 源（端口映射与内网不同；构建期注入，运行时按访问 host 选择） */
function tunnelApiOrigin(): string {
  return (process.env.NEXT_PUBLIC_TUNNEL_API_ORIGIN ?? '').trim().replace(/\/+$/, '');
}

export function resolveApiBase(): string {
  const saved = savedBase(API_STORAGE_KEY);
  if (saved) return saved;
  /* 公网穿透域名 → 固定公网 API 源；内网/本机 → 同 hostname:3000（不绕公网） */
  const tunnel = tunnelApiOrigin();
  if (tunnel && typeof window !== 'undefined' && TUNNEL_HOST_RE.test(window.location.hostname)) return tunnel;
  const configured = envApiBase();
  if (configured) return configured;
  return locationApiBase();
}

/**
 * WS 基地址：保存值 → 环境变量 → 由 API 地址切换协议。
 * 返回 ws:// / wss://，Socket.IO 直接接受；不再退到 localhost。
 */
export function resolveWsBase(): string {
  const saved = savedBase(WS_STORAGE_KEY, true);
  if (saved) return isWsUrl(saved) ? saved : toWsProtocol(saved);
  const configured = envWsBase();
  if (configured) return configured;
  return toWsProtocol(resolveApiBase());
}

export function readServerSetting(key: 'api' | 'ws'): string {
  return key === 'api' ? savedBase(API_STORAGE_KEY) : savedBase(WS_STORAGE_KEY, true);
}

/** API 基地址：localStorage 覆盖 → env → 当前 hostname:3000；SSR 为空。 */
export const API_BASE = resolveApiBase();
export const API_PREFIX = `${API_BASE}/api/v1`;
/** WebSocket 基地址（API/WS 可分源）；命名空间固定 /ws。 */
export const WS_BASE = resolveWsBase();
/** Socket.IO 传输路径；命名空间固定 /ws（docs/13 §13.1） */
export const WS_PATH = process.env.NEXT_PUBLIC_WS_PATH || '/socket.io';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** 网络层失败统一成 NETWORK，界面按“链路未连接”处理（绝不回退假数据） */
function networkError(cause: unknown): ApiError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new ApiError(0, 'NETWORK', `无法连接 API（${API_BASE}）：${message}`);
}

let refreshing: Promise<boolean> | null = null;

/** 并发 401 只触发一次 refresh（single-flight） */
export function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = session.getRefresh();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) {
      session.clear();
      return false;
    }
    const json: unknown = await res.json();
    // server 的成功响应统一被 TransformInterceptor 包成 { ok:true, data, requestId }
    const data = (unwrap<{ accessToken?: string; refreshToken?: string }>(json) ?? {}) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!data.accessToken || !data.refreshToken) {
      session.clear();
      return false;
    }
    session.setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/** 兼容服务端统一成功信封 { ok:true, data, requestId }（server/src/common/interceptors/transform.interceptor.ts） */
function unwrap<T>(payload: unknown): T {
  if (typeof payload === 'object' && payload !== null) {
    const bag = payload as Record<string, unknown>;
    if (bag.ok === true && 'data' in bag) return bag.data as T;
  }
  return payload as T;
}

export interface ApiOptions {
  /** 内部用：401 重试过一次后不再 refresh */
  retried?: boolean;
  /** 401 且 refresh 失败时静默（页面自行跳登录） */
  quietAuth?: boolean;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}, options: ApiOptions = {}): Promise<T> {
  const token = session.getAccess();
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, { ...init, headers, cache: 'no-store' });
  } catch (error) {
    throw networkError(error);
  }

  if (res.status === 401 && !options.retried && session.getRefresh()) {
    const refreshed = await refreshOnce();
    if (refreshed) return api<T>(path, init, { ...options, retried: true });
    if (!options.quietAuth) throw new ApiError(401, 'AUTH_INVALID', '登录状态已失效，请重新登录');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  const body = (payload ?? {}) as Record<string, unknown>;

  if (!res.ok) {
    // 错误信封：{ ok:false, error:{ code, message, ...details }, requestId, timestamp }
    const nested = typeof body.error === 'object' && body.error !== null ? (body.error as Record<string, unknown>) : null;
    const codeValue = nested?.code ?? body.code;
    const messageValue = nested?.message ?? body.message;
    let code = typeof codeValue === 'string' ? codeValue : '';
    // Throttler 抛出的 429 不经过业务错误信封，这里补上契约错误码
    if (!code && res.status === 429) code = 'RATE_LIMITED';
    if (!code) code = `HTTP_${res.status}`;
    const message = typeof messageValue === 'string' && messageValue ? messageValue : res.statusText || '请求失败';
    const requestIdValue = body.requestId ?? nested?.requestId;
    throw new ApiError(res.status, code, message, typeof requestIdValue === 'string' ? requestIdValue : undefined);
  }

  // 成功响应：解掉 { ok:true, data, requestId } 信封；raw 响应（健康检查等）原样返回
  return (unwrap<T>(payload) ?? ({} as T)) as T;
}

/** 去掉尾斜杠并拼查询串 */
export function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

/** 游标：base64url(`seq:<id>`)，客户端不得解析（docs/08 §0） */
export function encodeSeqCursor(seq: string | number): string {
  const raw = `seq:${seq}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function errorOf(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof ApiError) return { code: error.code, message: error.message, status: error.status };
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'INTERNAL', message, status: 0 };
}
