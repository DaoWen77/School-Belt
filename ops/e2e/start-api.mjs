#!/usr/bin/env node
/**
 * 启动 API（不经 run-backend 的全流程编排）。
 * 目的：DSH 沙箱会把 API_PREFIX 注入成沙箱自身路径，这里在 import main 之前强制纠正。
 * 用法：node start-api.mjs   （需 PG 55432 / Redis 6379 / S3 9000 已就绪）
 */
process.env.API_PREFIX = '/api/v1';
process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/dijiang?schema=public&connection_limit=10';
process.env.REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://:dijiang_dev_redis@localhost:6379/0';
process.env.PORT = process.env.E2E_API_PORT ?? '3000';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';

const path = await import('node:path');
/* 加载 server/.env（Node 20+ loadEnvFile）；随后覆盖关键连接串 */
const fs = await import('node:fs');
const envPath = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '..', 'server', '.env');
try {
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
} catch {
  /* 忽略 */
}
const { pathToFileURL, fileURLToPath } = await import('node:url');

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(here, '..', '..', 'server', 'dist', 'main.js');
await import(pathToFileURL(mainPath).href);
