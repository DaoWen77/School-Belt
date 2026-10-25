import { Body, Query, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

/**
 * zod 校验管道：DTO 全部用 zod schema 定义，校验失败统一抛 VALIDATION_FAILED（契约 §8）。
 * 好处：同一份 schema 既可用于 REST 入参，也可用于 WS payload 与单测。
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw new AppError(ErrorCode.VALIDATION_FAILED, '字段校验未通过', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
}

/** `@ZBody(schema)` —— 请求体校验 */
export function ZBody<T>(schema: ZodType<T, ZodTypeDef, unknown>): ParameterDecorator {
  return Body(new ZodValidationPipe(schema));
}

/** `@ZQuery(schema)` —— query 校验（值均为字符串，schema 内需 coerce） */
export function ZQuery<T>(schema: ZodType<T, ZodTypeDef, unknown>): ParameterDecorator {
  return Query(new ZodValidationPipe(schema));
}
