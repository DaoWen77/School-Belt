import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY, OPTIONAL_AUTH_KEY } from '../decorators';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { extractBearerToken } from '../utils/http';
import type { AccessTokenPayload, RequestWithContext } from '../types/context';

/**
 * 全站访问守卫（契约 §7）：解析 `Authorization: Bearer <access>`，
 * 校验签名/过期时间，再把用户状态（含封禁、禁言）从库里补齐挂到 request 上。
 * 错误码：未带凭证 AUTH_REQUIRED / 过期 TOKEN_EXPIRED / 其他 AUTH_INVALID。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      if (optional) return true;
      throw new AppError(ErrorCode.AUTH_REQUIRED);
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwt.accessSecret,
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
      });
    } catch (error) {
      // jsonwebtoken 过期错误的 name 固定为 TokenExpiredError
      if ((error as Error).name === 'TokenExpiredError') {
        throw new AppError(ErrorCode.TOKEN_EXPIRED);
      }
      throw new AppError(ErrorCode.AUTH_INVALID);
    }
    if (payload.type !== 'access' || !payload.sub || !payload.sid) {
      throw new AppError(ErrorCode.AUTH_INVALID);
    }

    // session 是“面”的唯一权威来源：JWT 只证明 sid 属于该用户，
    // 具体是 internal 还是 belt 必须回库查，撤销/过期也在这里兜住。
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: {
        userId: true,
        surface: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            globalRole: true,
            status: true,
            mutedUntil: true,
            avatarFileId: true,
            statusPrefix: true,
            tags: true,
            isInternal: true,
            accountOrigin: true,
          },
        },
      },
    });
    if (!session || session.userId !== payload.sub) {
      throw new AppError(ErrorCode.AUTH_INVALID, '登录状态已失效，请重新登录');
    }
    if (session.revokedAt) {
      throw new AppError(ErrorCode.AUTH_INVALID, '登录状态已失效，请重新登录');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.TOKEN_EXPIRED);
    }
    if (payload.surface && payload.surface !== session.surface) {
      throw new AppError(ErrorCode.AUTH_INVALID, '凭证所属链路不一致');
    }

    const user = session.user;
    if (user.status === 'suspended') {
      throw new AppError(ErrorCode.FORBIDDEN, '账号已被封禁，请联系协议官');
    }

    request.user = {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      globalRole: user.globalRole,
      status: user.status,
      sessionId: payload.sid,
      sessionSurface: session.surface,
      isInternal: user.isInternal,
      accountOrigin: user.accountOrigin,
      tags: user.tags,
      mutedUntil: user.mutedUntil,
      avatarFileId: user.avatarFileId,
      statusPrefix: user.statusPrefix,
    };
    return true;
  }
}
