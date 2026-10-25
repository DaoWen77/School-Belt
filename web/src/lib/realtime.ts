import { io, type Socket } from 'socket.io-client';
import { WS_BASE, WS_PATH, refreshOnce } from './api';
import { session } from './session';
import type { Message, ReadyPayload } from './types';

export type ConnState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'auth-error';

export interface Ack {
  ok?: boolean;
  /** 成功时是服务端消息；失败时是错误文案（服务端两种语义同名） */
  message?: Message | string;
  code?: string;
  dup?: boolean;
  [key: string]: unknown;
}

export interface SendInput {
  channelId: string;
  clientMsgId: string;
  kind: string;
  body: string;
  parentId?: string;
  replyToId?: string;
  attachmentIds?: string[];
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
const ACK_TIMEOUT = 5000;
const RETRY_DELAYS = [1000, 2000, 4000];
const FATAL_CODES = new Set(['MUTED', 'RATE_LIMITED', 'VALIDATION_FAILED', 'NOT_CHANNEL_MEMBER', 'CHANNEL_NOT_FOUND']);
const AUTH_CODES = new Set(['AUTH_REQUIRED', 'AUTH_INVALID', 'FORBIDDEN']);

interface TimeoutSocket {
  emit(event: string, payload: unknown, callback: (error: Error | null, ack: unknown) => void): void;
}

const WS_EVENTS = [
  'message:new',
  'message:updated',
  'message:deleted',
  'card:created',
  'card:updated',
  'card:deleted',
  'vote:updated',
  'conversation:created',
  'conversation:updated',
  'conversation:removed',
  'presence:update',
  'receipt:update',
  'error',
] as const;

export type WsEvent = (typeof WS_EVENTS)[number];

/**
 * 真实 Socket.IO 客户端（命名空间 /ws，传输 path /socket.io，仅 websocket）。
 * - 连接：auth.token = access token；TOKEN_EXPIRED 先 REST refresh 再重连
 * - 断线：指数退避 1/2/4/8/16s
 * - 发送：ack 5s 超时；同一 clientMsgId 重发最多 3 次（1s/2s/4s），服务端幂等
 */
export class Realtime {
  private socket: Socket | null = null;
  private state: ConnState = 'idle';
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = true;
  private currentChannel: string | null = null;
  private readonly listeners = new Map<string, Set<(payload: never) => void>>();

  onState: (state: ConnState) => void = () => {};
  onReady: (payload: ReadyPayload) => void = () => {};

  on(event: WsEvent, listener: (payload: unknown) => void): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    const wrapped = listener as (payload: never) => void;
    bucket.add(wrapped);
    return () => {
      bucket?.delete(wrapped);
    };
  }

  private dispatch(event: string, payload: unknown): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const listener of bucket) (listener as (value: unknown) => void)(payload);
  }

  private setState(next: ConnState): void {
    if (this.state === next) return;
    this.state = next;
    this.onState(next);
  }

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    this.disposeSocket();
    const token = session.getAccess();
    if (!token) {
      this.setState('idle');
      return;
    }
    this.setState(this.attempt > 0 ? 'reconnecting' : 'connecting');
    const socket = io(`${WS_BASE}/ws`, {
      path: WS_PATH,
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 8000,
      forceNew: true,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.attempt = 0;
      this.setState('online');
      if (this.currentChannel) socket.emit('channel:join', { channelId: this.currentChannel });
    });
    socket.on('ready', (payload: ReadyPayload) => {
      this.setState('online');
      this.onReady(payload);
    });
    for (const event of WS_EVENTS) {
      socket.on(event, (payload: unknown) => this.dispatch(event, payload));
    }
    socket.on('disconnect', (reason: string) => {
      if (reason === 'io client disconnect') return;
      this.scheduleReconnect();
    });
    socket.on('connect_error', (error: Error) => {
      const code = (error as Error & { data?: { code?: string } }).data?.code || error.message;
      this.disposeSocket();
      if (code === 'TOKEN_EXPIRED') {
        void this.refreshAndReconnect();
        return;
      }
      if (AUTH_CODES.has(code)) {
        this.setState('auth-error');
        return;
      }
      this.scheduleReconnect();
    });
  }

  private async refreshAndReconnect(): Promise<void> {
    const refreshed = await refreshOnce();
    if (refreshed) this.open();
    else this.setState('auth-error');
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)];
    this.attempt += 1;
    this.setState('reconnecting');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  private disposeSocket(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }

  disconnect(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.disposeSocket();
    this.setState('idle');
  }

  join(channelId: string): void {
    this.currentChannel = channelId;
    if (this.socket?.connected) this.socket.emit('channel:join', { channelId });
  }

  leave(channelId: string): void {
    if (this.currentChannel === channelId) this.currentChannel = null;
    if (this.socket?.connected) this.socket.emit('channel:leave', { channelId });
  }

  /** 发送：5s ack 超时；失败用同一 clientMsgId 重发（服务端幂等），最多 4 次尝试 */
  async send(input: SendInput): Promise<Ack> {
    let last: Ack = { ok: false, code: 'OFFLINE', message: '链路未连接，未发出' };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const ack = await this.emitWithAck('message:send', input);
      if (ack && ack.ok) return ack;
      if (ack) {
        last = ack;
        if (FATAL_CODES.has(String(ack.code ?? ''))) return ack;
      } else {
        last = { ok: false, code: 'ACK_TIMEOUT', message: '服务端 5 秒内未确认' };
      }
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      }
    }
    return last;
  }

  private emitWithAck(event: string, payload: unknown): Promise<Ack | null> {
    const socket = this.socket;
    if (!socket || !socket.connected) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: Ack | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        resolve(value);
      };
      const guard = setTimeout(() => finish(null), ACK_TIMEOUT + 200);
      try {
        (socket.timeout(ACK_TIMEOUT) as unknown as TimeoutSocket).emit(event, payload, (error, ack) => {
          finish(error ? null : ((ack as Ack) ?? { ok: false, code: 'ACK_INVALID' }));
        });
      } catch {
        finish(null);
      }
    });
  }
}
