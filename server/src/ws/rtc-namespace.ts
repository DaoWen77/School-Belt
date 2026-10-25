import type { Namespace, Server } from 'socket.io';
import { ErrorCode } from '../common/errors/error-codes';

interface MiddlewareHost {
  use(fn: (socket: unknown, next: (err?: Error) => void) => void): unknown;
}

/**
 * 契约 §11：`/rtc` 命名空间是预留能力。
 *
 * 建连一律拒绝（connect_error，message 与 data.code 均为 NOT_IMPLEMENTED，
 * 并附带 rtcSignalingEnabled 便于客户端判断），避免客户端收到 Socket.IO 的
 * "Invalid namespace"。开关关闭/开启都返回 NOT_IMPLEMENTED：开启只代表“已预留”。
 */
export function installRtcNamespace(
  server: Server,
  rtcEnabled: boolean,
  logger?: { log(message: string): void },
): Namespace {
  // @WebSocketServer 注入的是 /ws 命名空间；这里取其底层 Server 再创建 /rtc
  const root = ((server as unknown as { server?: Server }).server ?? server) as Server;
  const rtc = root.of('/rtc') as Namespace;

  (rtc as unknown as MiddlewareHost).use((_socket, next) => {
    const failure = new Error(ErrorCode.NOT_IMPLEMENTED) as Error & {
      data?: Record<string, unknown>;
    };
    failure.data = {
      code: ErrorCode.NOT_IMPLEMENTED,
      message: '音视频信令为预留能力（契约 §11），v1.0 不实现',
      rtcSignalingEnabled: rtcEnabled,
    };
    next(failure);
  });

  logger?.log('已注册 /rtc 命名空间：恒返回 NOT_IMPLEMENTED（契约 §11 预留）');
  return rtc;
}
