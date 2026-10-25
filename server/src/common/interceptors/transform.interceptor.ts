import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { RAW_RESPONSE_KEY } from '../decorators';
import { toJsonSafe } from '../utils/serialize';
import type { RequestWithContext } from '../types/context';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

/**
 * 统一成功响应：{ ok:true, data, requestId }
 * `@RawResponse()` 的路由（/healthz、/metrics、WS 握手等）原样返回。
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const requestId = request.id ?? 'unknown';

    return next.handle().pipe(
      map((data) => {
        if (isRaw) return data;
        return { ok: true as const, data: toJsonSafe(data) as T, requestId };
      }),
    );
  }
}
