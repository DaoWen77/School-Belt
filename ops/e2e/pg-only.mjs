#!/usr/bin/env node
/**
 * 只启动 embedded Postgres（不打 API、不做迁移），供迁移/排查时复用。
 * 端口 55432，数据目录 reports/e2e/pgdata（与 run-backend.mjs 一致）。
 * 用法：node pg-only.mjs ；Ctrl+C 或 taskkill 结束（PG 由 pg_ctl 管理，退出后仍会驻留，需 --stop 关）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PGDATA_DIR = path.join(ROOT, 'reports', 'e2e', 'pgdata');
const PORT = Number(process.env.E2E_PG_PORT ?? 55432);

const module = await import('embedded-postgres');
const EmbeddedPostgres = module.default ?? module.EmbeddedPostgres;

const pg = new EmbeddedPostgres({
  databaseDir: PGDATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  initdbFlags: ['--locale=C'],
  postgresFlags: [],
});

try {
  await pg.start();
  console.log(`PG up on 127.0.0.1:${PORT} (${PGDATA_DIR})`);
} catch (error) {
  console.log(`start() 失败：${error.message}（可能已在运行，继续等待）`);
}

/* 保持进程存活，让 PG 不被回收 */
setInterval(() => {}, 60_000);
process.on('SIGINT', async () => {
  await pg.stop().catch(() => {});
  process.exit(0);
});
