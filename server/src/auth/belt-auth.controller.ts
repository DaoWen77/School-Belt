import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { HandoffService } from './handoff.service';
import {
  beltRegisterSchema,
  handoffExchangeSchema,
  loginSchema,
  refreshSchema,
  type BeltRegisterDto,
  type HandoffExchangeDto,
  type LoginDto,
  type RefreshDto,
} from './auth.dto';
import { Public } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';

/**
 * 环塔认证入口（Phase A 只做身份；页面在 Phase C 接入）。
 *
 * - 注册不消耗内部邀请码，出生面固定 belt，tags 为空；
 * - 登录允许内部账号使用环塔身份，但只发 belt 会话；
 * - 交接码兑换必须带目标面，且由 HandoffService 单次消费。
 */
@Controller('belt/auth')
export class BeltAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly handoff: HandoffService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @HttpCode(201)
  async register(@ZBody(beltRegisterSchema) dto: BeltRegisterDto, @Req() request: FastifyRequest) {
    return this.auth.registerBelt(dto, metaOf(request));
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async login(@ZBody(loginSchema) dto: LoginDto, @Req() request: FastifyRequest) {
    return this.auth.login(dto, metaOf(request), 'belt');
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  async refresh(@ZBody(refreshSchema) dto: RefreshDto, @Req() request: FastifyRequest) {
    return this.auth.refresh(dto.refreshToken, metaOf(request), 'belt');
  }

  @Public()
  @Post('handoff/exchange')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  async exchange(
    @ZBody(handoffExchangeSchema) dto: HandoffExchangeDto,
    @Req() request: FastifyRequest,
  ) {
    return this.handoff.consume(dto.code, 'belt', metaOf(request));
  }
}

function metaOf(request: FastifyRequest): { ip?: string; userAgent?: string } {
  const agent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof agent === 'string' ? agent : undefined,
  };
}
