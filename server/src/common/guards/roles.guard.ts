import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { GlobalRole } from '../types/enums';
import type { RequestWithContext } from '../types/context';

/** 全站角色守卫：配合 `@Roles('owner','admin')` 使用（契约 §4） */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const roles = this.reflector.getAllAndOverride<GlobalRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.user) throw new AppError(ErrorCode.AUTH_REQUIRED);
    if (!roles.includes(request.user.globalRole)) {
      throw new AppError(ErrorCode.FORBIDDEN, '全站角色不足');
    }
    return true;
  }
}
