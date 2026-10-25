import {
  Controller,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  type LoginDto,
  type LogoutDto,
  type RefreshDto,
  type RegisterDto,
} from './auth.dto';
import { CurrentUser, Public, RequestId } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/**
 * 认证端点（契约 §7 auth/me）。
 * 限流（契约 §9）：登录 5 次/分钟/IP，注册（邀请核验）5 次/10 分钟/IP。
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @HttpCode(201)
  async register(@ZBody(registerSchema) dto: RegisterDto, @Req() request: FastifyRequest) {
    return this.auth.register(dto, this.meta(request));
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async login(@ZBody(loginSchema) dto: LoginDto, @Req() request: FastifyRequest) {
    return this.auth.login(dto, this.meta(request));
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  async refresh(@ZBody(refreshSchema) dto: RefreshDto, @Req() request: FastifyRequest) {
    return this.auth.refresh(dto.refreshToken, this.meta(request), 'internal');
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AuthUser,
    @ZBody(logoutSchema) dto: LogoutDto,
    @RequestId() requestId: string,
  ) {
    const result = await this.auth.logout(user.id, user.sessionId, dto);
    return { ...result, requestId };
  }

  /**
   * 改密只保留契约 §7 的 `POST /me/password`（见 users/me 控制器）。
   * 这里不再提供 `POST /auth/password`，避免同一能力两个入口造成路由数与文档不一致。
   */

  /** 邀请码预览（契约 §7：GET /invites/:code/preview 为公开端点，实现在 invites 控制器） */
  private meta(request: FastifyRequest): { ip?: string; userAgent?: string } {
    const agent = request.headers['user-agent'];
    return {
      ip: request.ip,
      userAgent: typeof agent === 'string' ? agent : undefined,
    };
  }
}
