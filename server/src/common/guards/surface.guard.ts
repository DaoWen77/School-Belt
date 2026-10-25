import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IS_PUBLIC_KEY,
  OPTIONAL_AUTH_KEY,
  SURFACE_KEY,
  type SurfaceRequirement,
} from '../decorators';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { RequestWithContext } from '../types/context';

/**
 * 面隔离守卫（文明环带 Phase A）。
 *
 * 默认 internal：任何没有显式 `@Surface('belt'|'bridge')` 的受保护路由，
 * 都必须同时满足：
 *   - 当前 session.surface === 'internal'
 *   - 用户拥有 `[极光科技]` 标签（is_internal）
 *
 * `belt` 只校验会话面；`bridge` 预留给跨环带 DM，后续还要叠加好友关系校验。
 * 这里不查库：JwtAuthGuard 已经把 session.surface / isInternal 从库里补齐。
 */
@Injectable()
export class SurfaceGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required =
      this.reflector.getAllAndOverride<SurfaceRequirement>(SURFACE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'internal';

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const user = request.user;
    if (!user) {
      const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (optional) return true;
      throw new AppError(ErrorCode.AUTH_REQUIRED);
    }

    if (required === 'internal') {
      if (user.sessionSurface !== 'internal') {
        throw new AppError(ErrorCode.SURFACE_MISMATCH, '该接口仅接受帝江号内部会话');
      }
      if (!user.isInternal) {
        throw new AppError(ErrorCode.INTERNAL_ONLY, '缺少 [极光科技] 身份标签');
      }
      return true;
    }

    if (required === 'belt') {
      if (user.sessionSurface !== 'belt') {
        throw new AppError(ErrorCode.SURFACE_MISMATCH, '该接口仅接受文明环带会话');
      }
      return true;
    }

    // bridge：内部/环带会话都可进入，但业务层必须继续校验好友关系与频道 surface。
    if (user.sessionSurface !== 'internal' && user.sessionSurface !== 'belt') {
      throw new AppError(ErrorCode.SURFACE_MISMATCH);
    }
    return true;
  }
}
