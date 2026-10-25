import { describe, expect, it } from 'vitest';
import type { Server } from 'socket.io';
import { installRtcNamespace } from '../src/ws/rtc-namespace';
import { ErrorCode } from '../src/common/errors/error-codes';

interface FakeNamespace {
  name: string;
  middlewares: ((socket: unknown, next: (err?: Error) => void) => void)[];
  use(fn: (socket: unknown, next: (err?: Error) => void) => void): void;
}

function fakeServer(): { server: Server; namespace: FakeNamespace } {
  const namespace: FakeNamespace = {
    name: '',
    middlewares: [],
    use(fn) {
      this.middlewares.push(fn);
    },
  };
  const server = {
    of(name: string) {
      namespace.name = name;
      return namespace;
    },
  } as unknown as Server;
  return { server, namespace };
}

function runMiddleware(namespace: FakeNamespace): Error | undefined {
  let captured: Error | undefined;
  const middleware = namespace.middlewares[0];
  if (!middleware) throw new Error('未注册中间件');
  middleware({}, (error) => {
    captured = error;
  });
  return captured;
}

describe('/rtc 预留命名空间（契约 §11）', () => {
  it('创建 /rtc 命名空间并注册握手中间件', () => {
    const { server, namespace } = fakeServer();
    installRtcNamespace(server, false);
    expect(namespace.name).toBe('/rtc');
    expect(namespace.middlewares).toHaveLength(1);
  });

  it('RTC_SIGNALING_ENABLED=false：建连被拒，code=NOT_IMPLEMENTED', () => {
    const { server, namespace } = fakeServer();
    installRtcNamespace(server, false);
    const error = runMiddleware(namespace) as (Error & { data?: Record<string, unknown> }) | undefined;
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe(ErrorCode.NOT_IMPLEMENTED);
    expect(error?.data?.code).toBe(ErrorCode.NOT_IMPLEMENTED);
    expect(error?.data?.rtcSignalingEnabled).toBe(false);
  });

  it('开关打开也返回 NOT_IMPLEMENTED（“已预留、未实现”）', () => {
    const { server, namespace } = fakeServer();
    installRtcNamespace(server, true);
    const error = runMiddleware(namespace) as (Error & { data?: Record<string, unknown> }) | undefined;
    expect(error?.message).toBe(ErrorCode.NOT_IMPLEMENTED);
    expect(error?.data?.rtcSignalingEnabled).toBe(true);
  });
});
