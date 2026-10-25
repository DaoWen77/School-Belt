import type { LoggerService } from '@nestjs/common';
import { pino, type Logger as PinoLogger } from 'pino';

/**
 * pino 结构化日志：
 * - HTTP 请求日志由 Fastify 的 logger 实例输出（含 reqId、method、url、statusCode、耗时）；
 * - Nest 自身的日志（启动、模块、异常）通过 PinoNestLogger 转进同一条输出流。
 */
export interface PinoOptions {
  level: string;
  isProduction: boolean;
  serviceName?: string;
}

export function createPinoLogger(options: PinoOptions): PinoLogger {
  return pino({
    level: options.level,
    base: { service: options.serviceName ?? 'dijiang-api', env: options.isProduction ? 'prod' : 'dev' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        '*.password',
        'passwordHash',
        'refreshToken',
        'token',
      ],
      censor: '[redacted]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

/** 把 Nest LoggerService 调用转发给 pino，保留 context 字段 */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  log(message: unknown, ...optional: unknown[]): void {
    this.logger.info(this.withContext(message, optional));
  }

  error(message: unknown, ...optional: unknown[]): void {
    const [maybeTrace] = optional;
    if (maybeTrace instanceof Error) {
      this.logger.error({ err: maybeTrace, context: this.contextOf(optional, 1) }, String(message));
      return;
    }
    if (typeof maybeTrace === 'string' && maybeTrace.includes('\n    at ')) {
      this.logger.error({ stack: maybeTrace, context: this.contextOf(optional, 1) }, String(message));
      return;
    }
    this.logger.error(this.withContext(message, optional));
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.logger.warn(this.withContext(message, optional));
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.logger.debug(this.withContext(message, optional));
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.logger.trace(this.withContext(message, optional));
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    this.logger.fatal(this.withContext(message, optional));
  }

  private contextOf(optional: unknown[], index: number): string | undefined {
    const value = optional[index];
    return typeof value === 'string' ? value : undefined;
  }

  private withContext(message: unknown, optional: unknown[]): Record<string, unknown> {
    const context = this.contextOf(optional, 0);
    const payload: Record<string, unknown> = { msg: String(message) };
    if (context) payload.context = context;
    return payload;
  }
}
