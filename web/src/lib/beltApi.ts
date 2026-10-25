import { io } from 'socket.io-client';
import { resolveApiBase, resolveWsBase, WS_PATH } from './api';
import { beltSession } from './beltSession';
import { resolvePublicUrl } from './fileUrl';

export interface BeltUser {
  id: string;
  handle: string;
  displayName: string;
  globalRole?: string;
  isInternal?: boolean;
  accountOrigin?: 'internal' | 'belt';
  avatarFileId?: string | null;
  statusPrefix?: string | null;
  prefixes?: string[];
}

export interface BeltAuthResult {
  user: BeltUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class BeltApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function apiBase(): string {
  return `${resolveApiBase()}/api/v1`;
}

function unwrap<T>(payload: unknown): T {
  if (typeof payload === 'object' && payload !== null) {
    const bag = payload as Record<string, unknown>;
    if (bag.ok === true && 'data' in bag) return bag.data as T;
  }
  return payload as T;
}

let refreshing: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = beltSession.getRefresh();
    if (!refreshToken) return false;
    try {
      const response = await fetch(`${apiBase()}/belt/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const json = (await response.json()) as { data?: { accessToken?: string; refreshToken?: string } };
      const data = json.data;
      if (!data?.accessToken || !data.refreshToken) return false;
      beltSession.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function beltApi<T = unknown>(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = beltSession.getAccess();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new BeltApiError(0, 'NETWORK', '链路不可达，请检查网络');
  }

  if (response.status === 401 && !retried && beltSession.getRefresh()) {
    const ok = await refreshOnce();
    if (ok) return beltApi<T>(path, init, true);
    beltSession.clear();
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  const body = (payload ?? {}) as Record<string, unknown>;
  if (!response.ok) {
    const nested = typeof body.error === 'object' && body.error !== null ? (body.error as Record<string, unknown>) : null;
    const code = typeof nested?.code === 'string' ? nested.code : `HTTP_${response.status}`;
    const message = typeof nested?.message === 'string' ? nested.message : '请求被链路拒绝';
    throw new BeltApiError(response.status, code, message);
  }
  return (unwrap<T>(payload) ?? ({} as T)) as T;
}

export async function beltFileUrl(fileId: string): Promise<string> {
  const data = await beltApi<{ url: string }>(`/belt/files/${fileId}/url?variant=preview`);
  return resolvePublicUrl(data.url);
}

interface AvatarPresign {
  fileId: string;
  uploadUrl: string;
  headers?: Record<string, string>;
}

/** 环带头像 S3 直传；不依赖内部频道成员关系。 */
export async function uploadBeltAvatar(file: File): Promise<string> {
  const presign = await beltApi<AvatarPresign>('/belt/files/avatar/presign', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    }),
  });
  const response = await fetch(resolvePublicUrl(presign.uploadUrl), {
    method: 'PUT',
    headers: presign.headers ?? {},
    body: file,
  });
  if (!response.ok) throw new BeltApiError(response.status, `HTTP_${response.status}`, '头像上传到对象存储失败');
  const view = await beltApi<{ id: string }>(`/belt/files/${presign.fileId}/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return view.id;
}

/** 环带实时 socket；回调只处理 belt:message，断线由 Socket.IO 自动重连。 */
export function connectBeltSocket(
  onMessage: (payload: unknown) => void,
  onState?: (state: 'connecting' | 'online' | 'offline') => void,
  onDirectMessage?: (payload: unknown) => void,
  onConversation?: (payload: unknown) => void,
) {
  const token = beltSession.getAccess();
  if (!token) return null;
  const socket = io(`${resolveWsBase()}/ws/belt`, {
    path: WS_PATH,
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    timeout: 8000,
  });
  onState?.('connecting');
  socket.on('connect', () => onState?.('online'));
  socket.on('disconnect', () => onState?.('offline'));
  socket.on('connect_error', () => onState?.('offline'));
  socket.on('belt:message', onMessage);
  if (onDirectMessage) socket.on('belt:dm:message', onDirectMessage);
  if (onConversation) socket.on('belt:conversation', onConversation);
  return socket;
}
