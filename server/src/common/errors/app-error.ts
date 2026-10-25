import { ERROR_DEFAULT_MESSAGE, ERROR_HTTP_STATUS, ErrorCode } from './error-codes';

/**
 * 统一业务异常。REST 由 AllExceptionsFilter 翻译成契约 §8 的错误体，
 * WS 由 WsExceptionFilter / ack 翻译成 { ok:false, code, message }。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    message?: string,
    details: Record<string, unknown> = {},
  ) {
    super(message ?? ERROR_DEFAULT_MESSAGE[code]);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.details = Object.freeze({ ...details });
  }

  static validation(message: string, details: Record<string, unknown> = {}): AppError {
    return new AppError(ErrorCode.VALIDATION_FAILED, message, details);
  }

  static forbidden(message?: string): AppError {
    return new AppError(ErrorCode.FORBIDDEN, message);
  }

  static notFound(message?: string): AppError {
    return new AppError(ErrorCode.CHANNEL_NOT_FOUND, message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
