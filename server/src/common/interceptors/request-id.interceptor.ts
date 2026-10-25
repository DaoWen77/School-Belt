import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Observable } from 'rxjs';
import type { RequestWithContext } from '../types/context';

/**
 * 把 Fastify 的 request.id 回写到响应头 x-request-id，
 * 便于前端在错误提示里展示 requestId（契约 §8 INTERNAL 带 requestId）。
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest<RequestWithContext>();
      const reply = context.switchToHttp().getResponse<FastifyReply>();
      if (request.id) reply.header('x-request-id', request.id);
    }
    return next.handle();
  }
}
