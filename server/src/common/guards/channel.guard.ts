import { Injectable, mixin, type CanActivate, type ExecutionContext, type Type } from '@nestjs/common';
import {
  ChannelAccessService,
  type ChannelAccess,
} from './channel-access.service';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { RequestWithContext } from '../types/context';

export type ChannelIdSource = 'param:id' | 'body:channelId' | 'query:channelId';

export interface ChannelGuardOptions {
  /** channelId 从哪里取，默认路由参数 :id */
  source?: ChannelIdSource;
  /** 需要的频道权限，默认 read */
  access?: ChannelAccess;
}

interface ChannelRequest extends RequestWithContext {
  params?: Record<string, string | undefined>;
  body?: unknown;
  query?: unknown;
}

function pickChannelId(request: ChannelRequest, source: ChannelIdSource): string | null {
  if (source === 'param:id') return request.params?.id ?? null;
  if (source === 'body:channelId') {
    const body = request.body;
    if (body && typeof body === 'object') {
      const value = (body as Record<string, unknown>).channelId;
      return typeof value === 'string' ? value : null;
    }
    return null;
  }
  const query = request.query;
  if (query && typeof query === 'object') {
    const value = (query as Record<string, unknown>).channelId;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/**
 * 频道级守卫工厂：
 *   @UseGuards(ChannelGuard({ access: 'write' }))
 * 解析频道 + 成员行，并写入 request.channel / request.channelMember 供 handler 复用。
 */
export function ChannelGuard(options: ChannelGuardOptions = {}): Type<CanActivate> {
  const source = options.source ?? 'param:id';
  const access = options.access ?? 'read';

  @Injectable()
  class ChannelGuardMixin implements CanActivate {
    constructor(private readonly channelAccess: ChannelAccessService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      if (context.getType() !== 'http') return true;
      const request = context.switchToHttp().getRequest<ChannelRequest>();
      if (!request.user) throw new AppError(ErrorCode.AUTH_REQUIRED);

      const channelId = pickChannelId(request, source);
      if (!channelId) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, '缺少 channelId', { field: 'channelId' });
      }

      const resolved = await this.channelAccess.assert(channelId, request.user, access);
      request.channel = resolved.channel;
      request.channelMember = resolved.member;
      return true;
    }
  }

  return mixin(ChannelGuardMixin);
}
