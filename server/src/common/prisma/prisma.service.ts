import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppConfig } from '../../config/config.module';
import { withPoolParams } from '../../config/db';

/**
 * Prisma 客户端封装。
 * - 生命周期跟随 Nest 模块；
 * - 连接串按 DATABASE_POOL_MAX 注入 connection_limit / pool_timeout / connect_timeout；
 * - 提供事务助手与健康检查；
 * - 不在此层做权限判定（权限在 common/utils/permissions.ts）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /** 实际使用的连接串（已脱敏，供启动日志排查池参数） */
  readonly datasourceUrl: string;

  constructor(config: AppConfig) {
    const datasourceUrl = withPoolParams(config.db.url, { poolMax: config.db.poolMax });
    super({
      datasourceUrl,
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
    this.datasourceUrl = datasourceUrl;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`Prisma 已连接 PostgreSQL（${this.maskedUrl()})`);
  }

  private maskedUrl(): string {
    try {
      const url = new URL(this.datasourceUrl);
      if (url.password) url.password = '***';
      return url.toString();
    } catch {
      return '<invalid-url>';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** 统一事务入口：所有多表写入（发消息、注册、投票）都从这里进 */
  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    timeoutMs = 10_000,
  ): Promise<T> {
    return this.$transaction(fn, { timeout: timeoutMs, maxWait: 5_000 });
  }

  /** /readyz 探活 */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn(`PostgreSQL 探活失败: ${(error as Error).message}`);
      return false;
    }
  }

  /** Prisma 唯一键冲突识别（幂等键、邀请码等共用） */
  static isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  static isNotFound(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
  }
}
