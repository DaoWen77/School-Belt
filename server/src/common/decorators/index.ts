import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser } from '../types/context';

/** 标记公开端点：跳过 JwtAuthGuard（/auth/*、/healthz、/readyz、邀请预览） */
export const IS_PUBLIC_KEY = 'dijiang:public';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** 公开可读、登录可选：没有 Bearer 也放行，有 Bearer 则按该用户解析 */
export const OPTIONAL_AUTH_KEY = 'dijiang:optional-auth';
export const OptionalAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(OPTIONAL_AUTH_KEY, true);

/**
 * 面向哪一侧 API。
 * 未标注 = internal（默认拒绝/默认内部），新路由不会因为漏写而暴露给环塔。
 */
export type SurfaceRequirement = 'internal' | 'belt' | 'bridge';
export const SURFACE_KEY = 'dijiang:surface';
export const Surface = (surface: SurfaceRequirement): MethodDecorator & ClassDecorator =>
  SetMetadata(SURFACE_KEY, surface);

/** 全站角色要求（owner / admin），配合 RolesGuard */
export const ROLES_KEY = 'dijiang:roles';
export const Roles = (...roles: readonly string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** 标记原始响应：跳过统一响应包装（/healthz、/metrics 等） */
export const RAW_RESPONSE_KEY = 'dijiang:raw';
export const RawResponse = (): MethodDecorator & ClassDecorator => SetMetadata(RAW_RESPONSE_KEY, true);

/** 当前登录用户（由 JwtAuthGuard 注入） */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!request.user) {
      // 守卫已保证登录；走到这里说明路由配置漏了守卫
      throw new Error('CurrentUser 只能在受保护路由上使用');
    }
    return request.user;
  },
);

/** 可选登录用户（配合 @OptionalAuth；匿名请求返回 null） */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | null => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    return request.user ?? null;
  },
);

/** 请求 ID（来自 x-request-id 或 Fastify 生成的 uuid） */
export const RequestId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ id?: string }>();
    return request.id ?? 'unknown';
  },
);
