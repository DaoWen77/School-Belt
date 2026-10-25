import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { HandoffService } from './handoff.service';
import {
  handoffExchangeSchema,
  handoffIssueSchema,
  type HandoffExchangeDto,
  type HandoffIssueDto,
} from './auth.dto';
import { CurrentUser, Public, Surface } from '../common/decorators';
import { ZBody } from '../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../common/types/context';

/**
 * 内部 → 环带的交接码签发。
 * 守卫默认 internal，并额外要求 is_internal；HandoffService 再校验一次。
 */
@Controller('access')
export class InternalAccessController {
  constructor(private readonly handoff: HandoffService) {}

  @Post('belt/handoff')
  @Surface('internal')
  @HttpCode(201)
  async beltHandoff(
    @CurrentUser() user: AuthUser,
    @ZBody(handoffIssueSchema) dto: HandoffIssueDto,
    @Req() request: FastifyRequest,
  ) {
    return this.handoff.issue(user, 'belt', dto.next, metaOf(request));
  }
}

/**
 * 环带 → 帝江号的门禁。
 * 这里不直接发内部 token：标签通过后只发 60 秒交接码，由内部侧兑换。
 */
@Controller('belt/access')
export class BeltAccessController {
  constructor(private readonly handoff: HandoffService) {}

  @Post('internal/check')
  @Surface('belt')
  @HttpCode(200)
  async internalCheck(
    @CurrentUser() user: AuthUser,
    @ZBody(handoffIssueSchema) dto: HandoffIssueDto,
    @Req() request: FastifyRequest,
  ) {
    // 标签校验、审计与拒绝文案统一在 HandoffService 内完成。
    return this.handoff.issue(user, 'internal', dto.next, metaOf(request));
  }
}

/** 内部侧兑换：公开端点，但必须持有 60 秒单次交接码。 */
@Controller('auth/handoff')
export class InternalHandoffController {
  constructor(private readonly handoff: HandoffService) {}

  @Public()
  @Post('exchange')
  @HttpCode(200)
  async exchange(
    @ZBody(handoffExchangeSchema) dto: HandoffExchangeDto,
    @Req() request: FastifyRequest,
  ) {
    return this.handoff.consume(dto.code, 'internal', metaOf(request));
  }
}

function metaOf(request: FastifyRequest): { ip?: string; userAgent?: string } {
  const agent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof agent === 'string' ? agent : undefined,
  };
}
