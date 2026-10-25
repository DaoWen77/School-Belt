import type { Namespace, Server, Socket } from 'socket.io';
import { WsAuthService } from './ws-auth.service';
import { extractSocketToken } from '../common/utils/http';
import type { AuthUser } from '../common/types/context';

interface MiddlewareHost {
  use(fn: (socket: Socket, next: (err?: Error) => void) => void): unknown;
}

const ROOM = (callId: string) => `rtc:${callId}`;

interface SignalPayload {
  callId?: unknown;
  sdp?: unknown;
  candidate?: unknown;
  to?: unknown;
}

/**
 * `/rtc` 命名空间：轻量 WebRTC 信令中继（offer / answer / ice / leave）。
 * 只做房间内事件转发，不落库、不配对业务关系；鉴权复用 WsAuthService。
 */
export function installRtcNamespace(
  server: Server,
  rtcEnabled: boolean,
  logger: { log(message: string): void; warn(message: string): void } | undefined,
  wsAuth: WsAuthService,
): Namespace {
  const root = ((server as unknown as { server?: Server }).server ?? server) as Server;
  const rtc = root.of('/rtc') as Namespace;

  (rtc as unknown as MiddlewareHost).use(async (socket, next) => {
    try {
      const token = extractSocketToken(socket.handshake.auth);
      const user = await wsAuth.authenticate(token, { allowBelt: true });
      socket.data.user = user;
      socket.data.rtcEnabled = rtcEnabled;
      next();
    } catch {
      const failure = new Error('AUTH_INVALID') as Error & { data?: Record<string, unknown> };
      failure.data = { code: 'AUTH_INVALID', rtcSignalingEnabled: rtcEnabled };
      next(failure);
    }
  });

  rtc.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthUser;

    socket.on('rtc:join', async (payload: SignalPayload, ack?: (value: unknown) => void) => {
      const callId = typeof payload?.callId === 'string' ? payload.callId.slice(0, 120) : '';
      if (!callId) {
        ack?.({ ok: false, error: 'callId required' });
        return;
      }
      void socket.join(ROOM(callId));
      const roomSockets = await rtc.in(ROOM(callId)).fetchSockets();
      const peers = roomSockets
        .filter((item) => item.id !== socket.id && item.data.user)
        .map((item) => {
          const peerUser = item.data.user as AuthUser;
          return { id: peerUser.id, handle: peerUser.handle, displayName: peerUser.displayName };
        });
      socket.emit('rtc:peers', { callId, peers });
      socket.to(ROOM(callId)).emit('rtc:peer-joined', {
        callId,
        from: user.id,
        handle: user.handle,
        displayName: user.displayName,
      });
      ack?.({ ok: true, callId });
    });

    const relay = (event: string) => {
      socket.on(event, (payload: SignalPayload, ack?: (value: unknown) => void) => {
        const callId = typeof payload?.callId === 'string' ? payload.callId.slice(0, 120) : '';
        if (!callId) {
          ack?.({ ok: false, error: 'callId required' });
          return;
        }
        const envelope = {
          callId,
          from: user.id,
          handle: user.handle,
          sdp: payload.sdp,
          candidate: payload.candidate,
          to: payload.to,
        };
        socket.to(ROOM(callId)).emit(event, envelope);
        ack?.({ ok: true });
      });
    };

    relay('rtc:offer');
    relay('rtc:answer');
    relay('rtc:ice');

    socket.on('rtc:leave', (payload: SignalPayload) => {
      const callId = typeof payload?.callId === 'string' ? payload.callId.slice(0, 120) : '';
      if (!callId) return;
      socket.to(ROOM(callId)).emit('rtc:peer-left', { callId, from: user.id });
      void socket.leave(ROOM(callId));
    });

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (!room.startsWith('rtc:')) continue;
        socket.to(room).emit('rtc:peer-left', { callId: room.slice(4), from: user.id });
      }
    });
  });

  logger?.log('已注册 /rtc 命名空间：offer/answer/ice 信令中继');
  return rtc;
}
