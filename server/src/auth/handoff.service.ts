import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { RedisService } from '../common/redis/redis.service';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import { randomToken, sha256Hex } from '../common/utils/crypto';
import type { AuthUser, SurfaceName } from '../common/types/context';
import { AuthService, type AuthResult, type RequestMeta } from './auth.service';

type HandoffTarget = SurfaceName;

interface HandoffPayload {
  v: 1;
  userId: string;
  target: HandoffTarget;
  next: string;
  uaHash: string | null;
  issuedAt: number;
}

const HANDOFF_TTL_MS = 60_000;
const HANDOFF_TTL_SEC = HANDOFF_TTL_MS / 1000;

/**
 * 跨面交接码（环塔 Phase A）。
 *
 * - 只存在 Redis，60 秒、单次消费；不落业务表。
 * - 内部→环塔只允许有 `[站长]` 的内部会话发起；
 *   环塔→内部只允许有标签的环塔会话发起。
 * - 消费时用 Lua `GET + DEL` 原子取走，避免并发双花。
 * - 绑定 User-Agent 哈希，降低交接 URL 被复制到另一浏览器直接使用的风险。
 */
@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async issue(
    user: AuthUser,
    target: HandoffTarget,
    rawNext: string | undefined,
    meta: RequestMeta,
  ): Promise<{ code: string; next: string; expiresIn: number }> {
    if (target === 'belt') {
      if (user.sessionSurface !== 'internal' || !user.isInternal) {
        throw new AppError(ErrorCode.PROTOCOL_DENIED, '仅工作台内部账号可接入环塔');
      }
    } else {
      if (user.sessionSurface !== 'belt') {
        throw new AppError(ErrorCode.SURFACE_MISMATCH, '必须从环塔会话发起登入');
      }
      if (!user.isInternal) {
        await this.audit.record({
          actorId: user.id,
          action: AuditAction.BELT_ACCESS_DENIED,
          targetKind: 'surface',
          targetId: 'internal',
          meta: { from: 'belt', to: 'internal', handle: user.handle },
          ip: meta.ip,
        });
        throw new AppError(
          ErrorCode.PROTOCOL_DENIED,
          '协议拒绝：未授权链路（缺少 [站长] 身份标签）',
        );
      }
    }

    const next = safeNext(target, rawNext);
    const code = randomToken(32);
    const payload: HandoffPayload = {
      v: 1,
      userId: user.id,
      target,
      next,
      uaHash: meta.userAgent ? sha256Hex(meta.userAgent) : null,
      issuedAt: Date.now(),
    };
    await this.redis.setWithTtl(`handoff:${code}`, JSON.stringify(payload), HANDOFF_TTL_MS);

    await this.audit.record({
      actorId: user.id,
      action: AuditAction.HANDOFF_ISSUE,
      targetKind: 'surface',
      targetId: target,
      meta: { from: user.sessionSurface, to: target, next },
      ip: meta.ip,
    });

    this.logger.log(`交接码已签发：${user.handle} ${user.sessionSurface} -> ${target}`);
    return { code, next, expiresIn: HANDOFF_TTL_SEC };
  }

  async consume(
    code: string,
    target: HandoffTarget,
    meta: RequestMeta,
  ): Promise<AuthResult> {
    const raw = await this.takeOnce(`handoff:${code}`);
    if (!raw) throw new AppError(ErrorCode.HANDOFF_INVALID);

    let payload: HandoffPayload;
    try {
      payload = JSON.parse(raw) as HandoffPayload;
    } catch {
      throw new AppError(ErrorCode.HANDOFF_INVALID);
    }
    if (
      payload.v !== 1 ||
      typeof payload.userId !== 'string' ||
      payload.target !== target ||
      typeof payload.issuedAt !== 'number' ||
      Date.now() - payload.issuedAt > HANDOFF_TTL_MS
    ) {
      throw new AppError(ErrorCode.HANDOFF_INVALID);
    }

    // 绑定浏览器：签发时有 UA 就必须用同一 UA 兑换；无 UA 的客户端（脚本/探针）两边都无。
    if (payload.uaHash) {
      if (!meta.userAgent || sha256Hex(meta.userAgent) !== payload.uaHash) {
        throw new AppError(ErrorCode.HANDOFF_INVALID, '交接码与当前浏览器不匹配');
      }
    }

    const result = await this.auth.issueSessionForUser(payload.userId, target, meta);
    await this.audit.record({
      actorId: payload.userId,
      action: AuditAction.HANDOFF_EXCHANGE,
      targetKind: 'surface',
      targetId: target,
      meta: { to: target, next: payload.next },
      ip: meta.ip,
    });
    return result;
  }

  /** 原子 GETDEL：拿到的同时删除，避免两个并发请求都消费同一交接码 */
  private async takeOnce(key: string): Promise<string | null> {
    const fullKey = this.redis.keyOf(key);
    const value = await this.redis.getClient().eval(
      "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
      1,
      fullKey,
    );
    if (typeof value === 'string') return value;
    if (Buffer.isBuffer(value)) return value.toString('utf8');
    return null;
  }
}

/**
 * 只允许站内路径，且必须落在目标面的目录里。
 * 拒绝 `//evil.com`、反斜杠、绝对 URL，避免交接参数变成开放重定向。
 */
function safeNext(target: HandoffTarget, raw: string | undefined): string {
  const fallback = target === 'belt' ? '/belt' : '/';
  if (!raw) return fallback;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('://')) {
    return fallback;
  }
  if (target === 'belt') {
    return value === '/belt' || value.startsWith('/belt/') ? value : fallback;
  }
  // 外部路径不允许回跳环塔；其余站内路径放行。
  return value === '/belt' || value.startsWith('/belt/') ? fallback : value;
}
