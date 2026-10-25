import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AppModule } from './app.module';
import { AppConfig } from './config/config.module';
import { detectLanIps } from './config/cors';
import { createPinoLogger, PinoNestLogger } from './common/logger/pino-logger';
import { ConfiguredIoAdapter } from './ws/io-adapter';

/**
 * 启动入口：
 * - Fastify 适配器 + pino 请求日志（requestId 来自 x-request-id 或自动生成）
 * - 统一前缀 /api/v1，运维探针 /healthz /readyz /metrics 不挂前缀
 * - WS 使用 Socket.IO（namespace /ws）
 */
async function bootstrap(): Promise<void> {
  const config = AppConfig.fromProcess();
  const logger = createPinoLogger({
    level: config.http.logLevel,
    isProduction: config.isProduction,
  });

  if (config.ai.usingDevConfigSecret) {
    logger.warn(
      'AI_CONFIG_SECRET 使用开发默认值：API Key 加密强度依赖该密钥，生产环境必须通过环境变量覆盖（≥32 字符）',
    );
  }

  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    trustProxy: config.http.trustProxy,
    bodyLimit: config.http.bodyLimitBytes,
    genReqId: (request: IncomingMessage) => {
      const header = request.headers['x-request-id'];
      if (typeof header === 'string' && header.trim().length > 0) return header.trim();
      if (Array.isArray(header) && header[0]) return header[0];
      return randomUUID();
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(new PinoNestLogger(logger));

  app.setGlobalPrefix(config.http.apiPrefix, {
    exclude: [
      { path: 'healthz', method: RequestMethod.GET },
      { path: 'readyz', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  const cors = config.http.cors;
  app.enableCors({
    // 函数形式：精确列表 + 私网通配正则 + 自动探测的 LAN origin（见 config/cors.ts）
    // 参数类型由 FastifyCorsOptions 上下文推导（OriginCallback 的第二参为必填）
    origin: (requestOrigin, callback) => callback(null, cors.allowed(requestOrigin)),
    credentials: true,
    // Fastify 默认只放行 GET/HEAD/POST；PATCH/DELETE 会被浏览器预检拦下，
    // 导致消息编辑/删除、任务状态、群管理这些写操作全部 NETWORK 失败。
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  });
  // WS 与 REST 共用同一份 CORS 判定（含通配与 LAN 自动项）
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, cors.allowed));
  app.enableShutdownHooks();

  await app.listen({ port: config.http.port, host: config.http.host });
  const lanIps = detectLanIps();
  logger.info(
    {
      host: config.http.host,
      port: config.http.port,
      apiPrefix: config.http.apiPrefix,
      // 局域网排障：启动即打印实际监听与放行的 origin
      listenUrls: [
        `http://127.0.0.1:${config.http.port}`,
        ...lanIps.map((ip) => `http://${ip}:${config.http.port}`),
      ],
      corsExact: cors.exact,
      corsPatterns: cors.patterns.map((pattern) => pattern.source),
      lanOrigins: cors.lanOrigins,
      lanIps,
      redis: 'required (PING at startup)',
      rtcSignaling: config.rtc.enabled,
    },
    '帝江号 API 已启动',
  );
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  // tslint:disable-next-line:no-console
  console.error(`[bootstrap] 启动失败: ${message}`);
  if (stack) console.error(stack);
  process.exitCode = 1;
});
