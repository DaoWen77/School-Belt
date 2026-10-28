import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';

/**
 * /ws/belt 握手：只接受 sessions.surface='belt' 的会话。
 * 内部 token 不能直接连环塔 WS，必须先在 A 阶段 handoff 成 belt 会话。
 */
@Injectable()
export class BeltWsAuthService {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(token: string | null): Promise<AuthUser> {
    if (!token) throw new AppError(ErrorCode.AUTH_REQUIRED);

    let sub: string;
    let sid: string;
    let tokenSurface: string | undefined;
    try {
      const payload = await this.tokens.verifyAccess(token);
      if (payload.type !== 'access') throw new AppError(ErrorCode.AUTH_INVALID);
      sub = payload.sub;
      sid = payload.sid;
      tokenSurface = payload.surface;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as Error).name === 'TokenExpiredError') throw new AppError(ErrorCode.TOKEN_EXPIRED);
      throw new AppError(ErrorCode.AUTH_INVALID);
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sid },
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
    if (!session || session.userId !== sub) throw new AppError(ErrorCode.AUTH_INVALID);
    if (session.revokedAt) throw new AppError(ErrorCode.AUTH_INVALID);
    if (session.expiresAt.getTime() <= Date.now()) throw new AppError(ErrorCode.TOKEN_EXPIRED);
    if (tokenSurface && tokenSurface !== session.surface) throw new AppError(ErrorCode.AUTH_INVALID);
    if (session.surface !== 'belt') {
      throw new AppError(ErrorCode.SURFACE_MISMATCH, '该 WS 命名空间仅接受环塔会话');
    }
    if (session.user.status === 'suspended') throw new AppError(ErrorCode.FORBIDDEN, '账号已被封禁');

    return {
      id: session.user.id,
      handle: session.user.handle,
      displayName: session.user.displayName,
      globalRole: session.user.globalRole,
      status: session.user.status,
      sessionId: sid,
      sessionSurface: session.surface,
      isInternal: session.user.isInternal,
      accountOrigin: session.user.accountOrigin,
      tags: session.user.tags,
      mutedUntil: session.user.mutedUntil,
      avatarFileId: session.user.avatarFileId,
      statusPrefix: session.user.statusPrefix,
    };
  }
}
