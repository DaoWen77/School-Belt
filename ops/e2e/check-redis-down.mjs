#!/usr/bin/env node
/**
 * task-18：验证「Redis 不可用时 API 启动失败（fail fast）」。
 *
 * 做法：在 3101 端口启动一个**临时** API 实例，REDIS_URL 指向无服务端口（6399），
 * 观察它是否在超时内以非 0 退出；记录退出码/耗时/日志尾部。
 * 不触碰正在运行的 3000 实例。
 *
 * 结果：reports/infra/redis-down.json + reports/infra/redis-down.log
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'reports', 'infra');
const OUT = path.join(OUT_DIR, 'redis-down.json');
const LOG = path.join(OUT_DIR, 'redis-down.log');
const RUN_JSON = path.join(ROOT, 'reports', 'e2e', 'run.json');
const SERVER_DIR = path.join(ROOT, 'server');
const DIST_MAIN = path.join(SERVER_DIR, 'dist', 'main.js');

const TEMP_PORT = Number(process.env.REDIS_DOWN_TEST_PORT ?? 3101);
const BAD_REDIS = process.env.BAD_REDIS_URL ?? 'redis://127.0.0.1:6399';
const TIMEOUT_MS = Number(process.env.REDIS_DOWN_WAIT_MS ?? 60_000);

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
const runState = loadJson(RUN_JSON);
const DATABASE_URL = process.env.DATABASE_URL ?? runState?.env?.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/dijiang';
const S3_ENDPOINT = runState?.env?.S3_ENDPOINT ?? 'http://127.0.0.1:9000';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(800);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}
function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(pid, 'SIGKILL');
  } catch {
    /* ignore */
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(DIST_MAIN)) throw new Error(`找不到 ${DIST_MAIN}（先构建 server）`);
  if (await isPortOpen(TEMP_PORT)) throw new Error(`临时端口 ${TEMP_PORT} 已被占用，换一个 REDIS_DOWN_TEST_PORT`);

  const env = {
    ...process.env,
    PORT: String(TEMP_PORT),
    HOST: '127.0.0.1',
    DATABASE_URL,
    REDIS_URL: BAD_REDIS,
    S3_ENDPOINT,
    S3_PUBLIC_ENDPOINT: S3_ENDPOINT,
    S3_BUCKET: runState?.env?.S3_BUCKET ?? 'dijiang',
    S3_ACCESS_KEY_ID: runState?.env?.S3_ACCESS_KEY_ID ?? 'minioadmin',
    S3_SECRET_ACCESS_KEY: runState?.env?.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
    JWT_ACCESS_SECRET: 'dev-access-secret-please-change-0001',
    JWT_REFRESH_SECRET: 'dev-refresh-secret-please-change-01',
    CORS_ORIGINS: 'http://localhost:3100,http://localhost:3000',
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
  };

  const stream = fs.createWriteStream(LOG, { flags: 'w' });
  const startedAt = Date.now();
  const child = spawn(process.execPath, [DIST_MAIN], {
    cwd: SERVER_DIR,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stream.write(chunk));
  child.stderr.on('data', (chunk) => stream.write(chunk));

  let exit = null;
  child.on('exit', (code, signal) => {
    exit = { code, signal, at: Date.now() };
  });
  child.on('error', (error) => {
    exit = { code: -1, signal: null, at: Date.now(), error: error.message };
  });

  const deadline = Date.now() + TIMEOUT_MS;
  let healthyWhileBroken = false;
  while (Date.now() < deadline && exit === null) {
    await sleep(500);
    if (await isPortOpen(TEMP_PORT)) {
      try {
        const response = await fetch(`http://127.0.0.1:${TEMP_PORT}/healthy-check`, { signal: AbortSignal.timeout(1500) });
        if (response.status > 0) healthyWhileBroken = true;
      } catch {
        /* 正常情况：根本没监听 */
      }
      const health = await fetch(`http://127.0.0.1:${TEMP_PORT}/healthz`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
      if (health && health.status === 200) healthyWhileBroken = true;
    }
  }

  const durationMs = (exit?.at ?? Date.now()) - startedAt;
  const exited = exit !== null;
  // 结论：Redis 指向不可用地址时，API 必须在超时内以非 0 退出（fail fast）
  const verdict = exited && exit.code !== 0 ? 'PASS' : 'FAIL';
  if (!exited) killTree(child.pid);

  await sleep(300);
  try {
    stream.end();
  } catch {
    /* ignore */
  }
  const logText = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
  const logTail = logText.trim().split(/\r?\n/).slice(-25);
  const redisLines = logText
    .split(/\r?\n/)
    .filter((line) => /redis|Redis|ECONNREFUSED|6399|启动失败/i.test(line))
    .slice(-10);

  const result = {
    checkedAt: new Date().toISOString(),
    scenario: 'API 启动时 Redis 不可用，应 fail fast（非 0 退出）',
    tempPort: TEMP_PORT,
    badRedisUrl: BAD_REDIS,
    databaseUrl: DATABASE_URL,
    exited,
    exitCode: exit?.code ?? null,
    signal: exit?.signal ?? null,
    durationMs,
    healthyWhileBroken,
    logFile: path.relative(ROOT, LOG).replace(/\\/g, '/'),
    redisRelatedLog: redisLines,
    logTail,
    verdict,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ verdict, exited, exitCode: result.exitCode, durationMs, healthyWhileBroken }, null, 2));
  console.log(`证据：${OUT}`);
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  console.error(`脚本异常：${error.stack ?? error.message}`);
  process.exitCode = 1;
});
