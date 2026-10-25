import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/config.module';
import { randomToken, sha256Hex } from '../common/utils/crypto';
import type { AccessTokenPayload, RefreshTokenPayload, SurfaceName } from '../common/types/context';
import type { GlobalRole } from '../common/types/enums';

export interface IssuedAccessToken {
  accessToken: string;
  expiresIn: number;
}

export interface IssuedRefreshToken {
  refreshToken: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * 令牌签发（契约 §7：access 15 分钟 JWT，refresh 30 天不透明串）。
 * refresh 本身不携带声明，库里只存 sha256(token)，轮换靠 sessions.rotated_from 串链。
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async issueAccess(
    user: { id: string; globalRole: GlobalRole },
    sessionId: string,
    surface: SurfaceName,
  ): Promise<IssuedAccessToken> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      sid: sessionId,
      role: user.globalRole,
      surface,
      type: 'access',
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.jwt.accessSecret,
      expiresIn: this.config.jwt.accessTtlSec,
      issuer: this.config.jwt.issuer,
      audience: this.config.jwt.audience,
    });
    return { accessToken, expiresIn: this.config.jwt.accessTtlSec };
  }

  issueRefresh(): IssuedRefreshToken {
    const refreshToken = randomToken(48);
    return {
      refreshToken,
      tokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + this.config.jwt.refreshTtlSec * 1000),
    };
  }

  hashRefreshToken(token: string): string {
    return sha256Hex(token);
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.jwt.accessSecret,
      issuer: this.config.jwt.issuer,
      audience: this.config.jwt.audience,
    });
  }

  /** refresh token 无签名，仅做形状校验（真正有效性靠 sessions 表比对） */
  isRefreshTokenShape(token: string): boolean {
    return typeof token === 'string' && token.length >= 32 && token.length <= 512;
  }

  /** 供未来扩展：若改为 JWT refresh，可直接校验声明 */
  async verifyRefreshJwt(token: string): Promise<RefreshTokenPayload> {
    return this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.jwt.refreshSecret,
      issuer: this.config.jwt.issuer,
      audience: this.config.jwt.audience,
    });
  }
}
