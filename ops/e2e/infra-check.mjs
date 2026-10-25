#!/usr/bin/env node
/**
 * task-18 环境取证：API /healthz /readyz、Redis（Memurai）、S3（rclone）、PG 版本与连接。
 * 结果写 reports/infra/env-check.json（不修改任何服务）。
 *
 * 用法：node ops/e2e/infra-check.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'reports', 'infra');
const OUT = path.join(OUT_DIR, 'env-check.json');

const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000';
const REDIS_HOST = process.env.REDIS_HOST ?? '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT ?? '6379';
const REDIS_CLI = process.env.REDIS_CLI ?? 'C:\\Program Files\\Memurai\\memurai-cli.exe';
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY_ID ?? 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin';
const S3_REGION = process.env.S3_REGION ?? 'us-east-1';
const BUCKETS = (process.env.S3_BUCKETS ?? 'dijiang').split(',');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/dijiang';

const result = { checkedAt: new Date().toISOString(), api: {}, redis: {}, s3: {}, postgres: {} };

async function getJson(url, timeoutMs = 25_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/* ── API ─────────────────────────────────────────────────────────────── */
try {
  result.api.healthz = await getJson(`${API_BASE}/healthz`, 10_000);
  result.api.readyz = await getJson(`${API_BASE}/readyz`, 30_000);
  result.api.degraded = result.api.readyz.body?.degraded ?? null;
  result.api.checks = result.api.readyz.body?.checks ?? null;
} catch (error) {
  result.api.error = error.message;
}

/* ── Redis（Memurai）──────────────────────────────────────────────────── */
function redis(...args) {
  return execFileSync(REDIS_CLI, ['-h', REDIS_HOST, '-p', REDIS_PORT, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  }).trim();
}
try {
  result.redis.ping = redis('PING');
  const info = redis('INFO', 'server');
  const infoMap = {};
  for (const line of info.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index > 0) infoMap[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  result.redis.version = { memurai_version: infoMap.memurai_version ?? null, redis_version: infoMap.redis_version ?? null, os: infoMap.os ?? null };
  result.redis.dbsize = Number(redis('DBSIZE'));
  const keys = redis('KEYS', 'dijiang:*').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  result.redis.keys = keys.map((key) => {
    const type = redis('TYPE', key);
    const ttl = Number(redis('TTL', key));
    let value = null;
    if (type === 'string') value = redis('GET', key);
    else if (type === 'zset') value = `${redis('ZCARD', key)} members`;
    else if (type === 'hash') value = `${redis('HLEN', key)} fields`;
    return { key, type, ttl, value };
  });
} catch (error) {
  result.redis.error = error.message;
}

/* ── S3（rclone）─────────────────────────────────────────────────────── */
const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});
result.s3.endpoint = S3_ENDPOINT;
result.s3.buckets = [];
for (const bucket of BUCKETS) {
  const entry = { bucket };
  try {
    const head = await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    entry.headBucket = { ok: true, status: head.$metadata?.httpStatusCode ?? null };
  } catch (error) {
    entry.headBucket = { ok: false, status: error?.$metadata?.httpStatusCode ?? null, error: error?.name ?? String(error) };
  }
  if (entry.headBucket.ok) {
    try {
      const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 5 }));
      entry.listObjects = { ok: true, keyCount: list.KeyCount ?? 0, sample: (list.Contents ?? []).map((item) => item.Key).slice(0, 5) };
    } catch (error) {
      entry.listObjects = { ok: false, error: error?.name ?? String(error) };
    }
  }
  result.s3.buckets.push(entry);
}

/* ── PostgreSQL ──────────────────────────────────────────────────────── */
const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 8000 });
try {
  await client.connect();
  const version = await client.query('SELECT version() AS version, current_setting($1) AS max_connections', ['max_connections']);
  const activity = await client.query(
    `SELECT state, count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY state`,
  );
  result.postgres = {
    ok: true,
    version: version.rows[0]?.version ?? null,
    maxConnections: version.rows[0]?.max_connections ?? null,
    activity: activity.rows,
  };
} catch (error) {
  result.postgres = { ok: false, error: error.message };
} finally {
  await client.end().catch(() => undefined);
}

/* ── 汇总 ─────────────────────────────────────────────────────────────── */
result.verdict =
  result.api.readyz?.status === 200 &&
  (result.api.checks ?? []).every((item) => item.ok === true) &&
  result.api.degraded !== true &&
  result.redis.ping === 'PONG' &&
  (result.s3.buckets ?? []).some((item) => item.headBucket.ok) &&
  result.postgres.ok === true
    ? 'PASS'
    : 'FAIL';

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));
console.log(`\nverdict=${result.verdict}  证据：${OUT}`);
process.exitCode = result.verdict === 'PASS' ? 0 : 1;
