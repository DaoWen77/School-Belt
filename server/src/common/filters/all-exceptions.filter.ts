import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../errors/app-error';
import { ERROR_DEFAULT_MESSAGE, ERROR_HTTP_STATUS, ErrorCode } from '../errors/error-codes';
import { toJsonSafe } from '../utils/serialize';

interface ErrorBody {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    [key: string]: unknown;
  };
  requestId: string;
  timestamp: string;
}

/**
 * 全局异常过滤器：把一切异常翻译成契约 §8 的统一错误体。
 * 响应：{ ok:false, error:{ code, message, ...details }, requestId, timestamp }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = request.id ?? randomUUID();

    const normalised = this.normalise(exception);
    const body: ErrorBody = {
      ok: false,
      error: {
        code: normalised.code,
        message: normalised.message,
        ...normalised.details,
      },
      requestId,
      timestamp: new Date().toISOString(),
    };

    if (normalised.code === ErrorCode.INTERNAL) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} 未处理异常: ${(exception as Error)?.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `[${requestId}] ${request.method} ${request.url} -> ${normalised.code}: ${normalised.message}`,
      );
    }

    reply
      .header('x-request-id', requestId)
      .status(normalised.httpStatus)
      .send(toJsonSafe(body) as ErrorBody);
  }

  private normalise(exception: unknown): {
    code: ErrorCode;
    message: string;
    httpStatus: number;
    details: Record<string, unknown>;
  } {
    if (isAppError(exception)) {
      return {
        code: exception.code,
        message: exception.message,
        httpStatus: exception.httpStatus,
        details: { ...exception.details },
      };
    }

    if (exception instanceof ZodError) {
      return {
        code: ErrorCode.VALIDATION_FAILED,
        message: '字段校验未通过',
        httpStatus: ERROR_HTTP_STATUS.VALIDATION_FAILED,
        details: {
          issues: exception.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
    }

    // Prisma 错误按 code 归类（不泄露 SQL 细节）
    const prismaCode = (exception as { code?: string })?.code;
    if (typeof prismaCode === 'string' && prismaCode.startsWith('P')) {
      if (prismaCode === 'P2002') {
        return {
          code: ErrorCode.VALIDATION_FAILED,
          message: '唯一约束冲突',
          httpStatus: ERROR_HTTP_STATUS.VALIDATION_FAILED,
          details: {},
        };
      }
      if (prismaCode === 'P2025' || prismaCode === 'P2003') {
        return {
          code: ErrorCode.VALIDATION_FAILED,
          message: '目标资源不存在或关联无效',
          httpStatus: ERROR_HTTP_STATUS.VALIDATION_FAILED,
          details: {},
        };
      }
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    return {
      code: ErrorCode.INTERNAL,
      message: ERROR_DEFAULT_MESSAGE.INTERNAL,
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      details: {},
    };
  }

  private fromHttpException(exception: HttpException): {
    code: ErrorCode;
    message: string;
    httpStatus: number;
    details: Record<string, unknown>;
  } {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const rawMessage =
      typeof response === 'string'
        ? response
        : ((response as { message?: unknown }).message ?? exception.message);
    const message = Array.isArray(rawMessage)
      ? rawMessage.join('; ')
      : String(rawMessage);

    const mapping: Record<number, ErrorCode> = {
      400: ErrorCode.VALIDATION_FAILED,
      401: ErrorCode.AUTH_INVALID,
      403: ErrorCode.FORBIDDEN,
      404: ErrorCode.CHANNEL_NOT_FOUND,
      409: ErrorCode.FILE_NOT_READY,
      413: ErrorCode.FILE_TOO_LARGE,
      415: ErrorCode.FILE_TYPE_NOT_ALLOWED,
      429: ErrorCode.RATE_LIMITED,
      501: ErrorCode.NOT_IMPLEMENTED,
    };
    const code = mapping[status] ?? (status >= 500 ? ErrorCode.INTERNAL : ErrorCode.VALIDATION_FAILED);
    const details: Record<string, unknown> = {};
    if (code === ErrorCode.RATE_LIMITED) details.retryAfterMs = 60_000;
    if (status === HttpStatus.NOT_FOUND) details.status = 404;

    return {
      code,
      message: code === ErrorCode.INTERNAL ? ERROR_DEFAULT_MESSAGE.INTERNAL : message,
      httpStatus: code === ErrorCode.RATE_LIMITED ? 429 : status,
      details,
    };
  }
}
