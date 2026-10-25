import { Controller, Get, Header, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { S3Service } from '../files/s3.service';
import { Public, RawResponse } from '../common/decorators';
import { ThrottlerGuard } from '@nestjs/throttler';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * 运维探针（契约 §7 ops）：
 * - /healthz：进程存活（不查依赖）
 * - /readyz：PG + Redis + S3 就绪；任一失败返回 503
 * - /metrics：Prometheus 文本格式的基础指标（内网暴露）
 * 三者均不在 /api/v1 前缀下（见 main.ts 的 setGlobalPrefix exclude）。
 */
@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
    private readonly s3: S3Service,
  ) {}

  @Public()
  @RawResponse()
  @Get('healthz')
  healthz() {
    return {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @RawResponse()
  @Get('readyz')
  async readyz(@Res({ passthrough: true }) reply: FastifyReply) {
    const checks = await this.runChecks();
    const failed = checks.filter((check) => !check.ok);
    const status = failed.length === 0 ? 'ok' : 'degraded';
    reply.status(failed.length === 0 ? 200 : 503);
    return {
      status,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @RawResponse()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @Get('metrics')
  metrics(): string {
    const memory = process.memoryUsage();
    const lines = [
      '# HELP dijiang_up API 进程存活',
      '# TYPE dijiang_up gauge',
      'dijiang_up 1',
      '# HELP dijiang_ws_connections 当前 WS 连接数',
      '# TYPE dijiang_ws_connections gauge',
      `dijiang_ws_connections ${this.realtime.connectionCount}`,
      '# HELP dijiang_read_receipt_pending 待落库的已读回执数',
      '# TYPE dijiang_read_receipt_pending gauge',
      'dijiang_read_receipt_pending 0',
      '# HELP process_uptime_seconds 进程运行时长',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${process.uptime().toFixed(0)}`,
      '# HELP process_resident_memory_bytes 常驻内存',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${memory.rss}`,
      '',
    ];
    return lines.join('\n');
  }

  private async runChecks(): Promise<CheckResult[]> {
    const [database, objectStorage, cache] = await Promise.all([
      this.prisma.ping(),
      this.s3.ping(),
      this.redis.ping(),
    ]);
    // Redis 是必需依赖：真实 PING 失败即 503，不存在“内存降级”
    return [
      { name: 'postgres', ok: database },
      { name: 's3', ok: objectStorage },
      { name: 'redis', ok: cache },
    ];
  }
}
