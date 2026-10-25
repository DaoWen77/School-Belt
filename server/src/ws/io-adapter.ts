import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server } from 'socket.io';

/** 浏览器 Origin → 是否放行（由 config/cors.ts 的 CorsPolicy.allowed 提供） */
export type OriginMatcher = (origin?: string | null) => boolean;

/**
 * Socket.IO 适配器：WS 与 REST 共用同一份 CORS 判定。
 *
 * 两个要点：
 * 1. `cors.origin` 必须是**函数**：socket.io 的 cors 选项走 `cors` 包，
 *    它能识别函数与正则，但**不会**把 `"http://192.168.1.*:3100"` 这种字符串当通配；
 * 直接传数组会让手机端（LAN Origin）握手失败。
 * 2. 只设置 `cors` 只影响响应头，不会拒绝握手；因此额外挂 `allowRequest`，
 *    在 Upgrade/轮询阶段直接拒绝不在白名单里的 Origin（非浏览器客户端无 Origin，放行）。
 */
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly isOriginAllowed: OriginMatcher,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: Record<string, unknown>): Server {
    const previousAllowRequest = options?.allowRequest as
      | ((req: unknown, callback: (error: string | null, success: boolean) => void) => void)
      | undefined;

    const merged = {
      ...(options ?? {}),
      cors: {
        origin: (
          origin: string | undefined,
          callback: (error: Error | null, allow?: boolean) => void,
        ) => callback(null, this.isOriginAllowed(origin)),
        credentials: true,
        methods: ['GET', 'POST'],
        allowedHeaders: ['content-type', 'authorization', 'x-request-id'],
      },
      allowRequest: (
        req: { headers?: Record<string, string | string[] | undefined> },
        callback: (error: string | null, success: boolean) => void,
      ) => {
        const header = req.headers?.origin;
        const origin = Array.isArray(header) ? header[0] : header;
        if (!this.isOriginAllowed(origin)) {
          callback('CORS_ORIGIN_NOT_ALLOWED', false);
          return;
        }
        if (previousAllowRequest) {
          previousAllowRequest(req, callback);
          return;
        }
        callback(null, true);
      },
    };
    return super.createIOServer(port, merged) as Server;
  }
}
