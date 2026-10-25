import { Injectable } from '@nestjs/common';
import type { AiSetting } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthUser } from '../common/types/context';
import { AiCryptoService } from './ai-crypto.service';
import type { AiConfigDto } from './ai.dto';

export interface AiConfigView {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  /** 只暴露末 4 位；从未配置时为 null */
  keyMasked: string | null;
  updatedAt: string | null;
}

export interface AiTestResult {
  ok: boolean;
  latencyMs: number;
  status: number;
  error?: string;
}

/** Chat / Report 内部使用：含解密后的 API Key，**只能在服务端内部流转** */
export interface AiRuntimeSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * AI 配置（owner/admin 专用）。
 *
 * 红线：API Key 只以 AES-256-GCM 密文存 `ai_settings.api_key_encrypted`；
 * GET/PUT/test 的返回值、日志、错误都不得出现明文。
 */
@Injectable()
export class AiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AiCryptoService,
  ) {}

  /** 角色兜底：即使守卫配置遗漏，服务层也拒绝普通成员 */
  private assertAdmin(user: AuthUser): void {
    if (user.globalRole !== 'owner' && user.globalRole !== 'admin') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅协议官或档案员可管理 AI 配置');
    }
  }

  async adminGet(user: AuthUser): Promise<AiConfigView> {
    this.assertAdmin(user);
    return this.toView(await this.findRow());
  }

  async adminPut(user: AuthUser, dto: AiConfigDto): Promise<AiConfigView> {
    this.assertAdmin(user);
    const current = await this.findRow();
    // apiKey 省略 = 保留旧值；显式给出才重新加密
    const encrypted =
      dto.apiKey !== undefined ? this.crypto.encrypt(dto.apiKey) : (current?.apiKeyEncrypted ?? null);

    const row = await this.prisma.aiSetting.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        baseUrl: dto.baseUrl,
        model: dto.model,
        apiKeyEncrypted: encrypted,
        updatedBy: user.id,
      },
      update: {
        baseUrl: dto.baseUrl,
        model: dto.model,
        apiKeyEncrypted: encrypted,
        updatedBy: user.id,
      },
    });
    return this.toView(row);
  }

  /** POST /ai/test：调 `${baseUrl}/models`（Bearer key，8s 超时），不泄露 key */
  async adminTest(user: AuthUser): Promise<AiTestResult> {
    this.assertAdmin(user);
    const row = await this.findRow();
    if (!row?.baseUrl || !row.apiKeyEncrypted) {
      return { ok: false, latencyMs: 0, status: 0, error: 'AI 未配置（缺少 baseUrl 或 apiKey）' };
    }
    let apiKey: string;
    try {
      apiKey = this.crypto.decrypt(row.apiKeyEncrypted);
    } catch (error) {
      return { ok: false, latencyMs: 0, status: 0, error: (error as Error).message };
    }

    const startedAt = Date.now();
    try {
      const response = await fetch(`${trimSlash(row.baseUrl)}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      const latencyMs = Date.now() - startedAt;
      return {
        ok: response.ok,
        latencyMs,
        status: response.status,
        ...(response.ok ? {} : { error: `上游返回 HTTP ${response.status}` }),
      };
    } catch (error) {
      // 只保留错误类型/简短原因，避免把请求头等敏感信息带出去
      const reason = (error as Error).name === 'TimeoutError' ? '连接超时（8s）' : '无法连接 AI 服务';
      return { ok: false, latencyMs: Date.now() - startedAt, status: 0, error: reason };
    }
  }

  /** Chat / Report 使用：解密后的运行时配置；未配置时抛 VALIDATION_FAILED */
  async runtimeSettings(): Promise<AiRuntimeSettings> {
    const row = await this.findRow();
    if (!row?.baseUrl || !row.model || !row.apiKeyEncrypted) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'AI 未配置，请先由协议官在设置中填写');
    }
    return {
      baseUrl: trimSlash(row.baseUrl),
      model: row.model,
      apiKey: this.crypto.decrypt(row.apiKeyEncrypted),
    };
  }

  /**
   * 多 Bot 用：全局默认值（baseUrl 必填；model/key 可为空，由 bot profile 覆盖）。
   * 不抛错，便于“Bot 自带 model/key、仅复用全局 baseUrl”的场景。
   */
  async globalDefaults(): Promise<{
    baseUrl: string | null;
    model: string | null;
    apiKey: string | null;
  }> {
    const row = await this.findRow();
    let apiKey: string | null = null;
    if (row?.apiKeyEncrypted) {
      try {
        apiKey = this.crypto.decrypt(row.apiKeyEncrypted);
      } catch {
        apiKey = null;
      }
    }
    return { baseUrl: row?.baseUrl ? trimSlash(row.baseUrl) : null, model: row?.model ?? null, apiKey };
  }

  private async findRow(): Promise<AiSetting | null> {
    return this.prisma.aiSetting.findUnique({ where: { id: 'default' } });
  }

  private toView(row: AiSetting | null): AiConfigView {
    return {
      configured: Boolean(row?.baseUrl && row.model && row.apiKeyEncrypted),
      baseUrl: row?.baseUrl ?? null,
      model: row?.model ?? null,
      keyMasked: this.maskedKey(row?.apiKeyEncrypted ?? null),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  /** 解密只为取末 4 位；解密失败时仅返回 '****'（仍不泄露任何密文细节） */
  private maskedKey(encrypted: string | null): string | null {
    if (!encrypted) return null;
    try {
      return this.crypto.mask(this.crypto.decrypt(encrypted));
    } catch {
      return '****';
    }
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
