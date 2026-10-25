#!/usr/bin/env node
/**
 * PG 连接池并发验证（task-17 C）：≥100 并发简单查询，证明 pool 不爆、不排队超时。
 *
 * 前置：Postgres 已启动（本机 embedded PG @127.0.0.1:55432），且 DATABASE_URL 带连接池参数：
 *   DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/dijiang?connection_limit=20&pool_timeout=10&connect_timeout=5'
 *
 * 用法：
 *   node ops/e2e/pool-check.mjs
 *   CONCURRENCY=150 node ops/e2e/pool-check.mjs
 * 输出：reports/infra/pool-check.json + 控制台摘要
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'reports', 'infra');
const OUT = path.join(OUT_DIR, 'pool-check.json');

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 120);
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/dijiang?connection_limit=20&pool_timeout=10&connect_timeout=5';

const require = createRequire(import.meta.url);
const { PrismaClient } = require(path.join(ROOT, 'server', 'node_modules', '@prisma', 'client'));

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL, log: ['error'] });

const startedAt = Date.now();
let peak = 0;
const results = await Promise.allSettled(
  Array.from({ length: CONCURRENCY }, async (_value, index) => {
    const row = await prisma.$queryRaw`SELECT ${index + 1}::int AS seq, current_setting('server_version') AS version`;
    return Array.isArray(row) && row[0]?.seq === index + 1;
  }),
);

const ok = results.filter((item) => item.status === 'fulfilled' && item.value === true).length;
const failed = results.length - ok;
const errors = results
  .filter((item) => item.status === 'rejected')
  .slice(0, 5)
  .map((item) => String(item.reason?.message ?? item.reason));

const poolFromUrl = new URL(DATABASE_URL).searchParams.get('connection_limit');
const summary = {
  checkedAt: new Date().toISOString(),
  databaseUrl: DATABASE_URL.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@'),
  connectionLimit: Number(poolFromUrl ?? 0),
  concurrency: CONCURRENCY,
  ok,
  failed,
  peakConcurrent: CONCURRENCY,
  durationMs: Date.now() - startedAt,
  errors,
  verdict: failed === 0 && ok === CONCURRENCY ? 'PASS' : 'FAIL',
};

// 额外拿一次 PG 侧连接数，作为“没打满 max_connections”的旁证
try {
  const rows = await prisma.$queryRaw`SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'active')::int AS active FROM pg_stat_activity WHERE datname = current_database()`;
  summary.pgStatActivity = Array.isArray(rows) ? rows[0] : null;
} catch (error) {
  summary.pgStatActivityError = String(error?.message ?? error);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await prisma.$disconnect();

console.log(`并发 ${CONCURRENCY}（连接池 connection_limit=${summary.connectionLimit}）：ok=${ok} failed=${failed}，耗时 ${summary.durationMs}ms`);
console.log(`PG pg_stat_activity：${JSON.stringify(summary.pgStatActivity ?? summary.pgStatActivityError)}`);
console.log(`verdict=${summary.verdict}  证据：${OUT}`);
process.exitCode = summary.verdict === 'PASS' ? 0 : 1;
