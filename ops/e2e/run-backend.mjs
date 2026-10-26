#!/usr/bin/env node
/**
 * O.M.V 帝江号 · E2E 后端编排（真实 Postgres，禁止 mock / pg-mem）
 *
 * 职责（契约 v1.2 §F 的“真实链路”底座）：
 *   1. 用 embedded-postgres 在本机起一个**真实** Postgres 实例（端口 55432，数据目录 reports/e2e/pgdata）；
 *   2. 建库 dijiang；
 *   3. 用 server/node_modules 里的 prisma CLI 执行 `migrate deploy`（必要时先 generate）；
 *   4. `pnpm build`（server）后跑 dist/scripts/init-owner.js 与 dist/scripts/seed.js；
 *   5. 对**真实 S3 兼容服务**做带签名 HeadBucket 预检（默认 http://127.0.0.1:9000，失败即终止）；
 *   6. 以子进程启动 `node dist/main.js`（PORT=3000、REDIS_URL 必填指向真实 Redis、S3 指向真实服务）；
 *   7. 等 /healthz 200，写 reports/e2e/run.json，保持运行直到 Ctrl+C；`--stop` 清理。
 *
 * 环境事实（本机）：
 *   - Redis：Memurai 4.1.8 Windows 服务，127.0.0.1:6379，无密码，PONG；
 *   - S3：rclone 1.75.2 `serve s3`，127.0.0.1:9000，minioadmin/minioadmin，bucket 目录 reports/e2e/rclone-s3/dijiang；
 *   - PG：embedded PostgreSQL 17.5，127.0.0.1:55432/dijiang。
 *   **没有内置 S3 替身，也没有 Redis 内存降级**：两者都是必需依赖，连不上直接失败。
 *
 * 用法：
 *   node run-backend.mjs                 # 起 PG + migrate + build + init/seed + S3 预检 + API
 *   node run-backend.mjs --reset         # 先清空 reports/e2e/pgdata 再全量重建
 *   node run-backend.mjs --skip-build    # 复用已有 dist（前端/后端联调时更快）
 *   node run-backend.mjs --api-port 3001 # 3000 被占用时临时换端口
 *   node run-backend.mjs --stop          # 停止 API + Postgres 并收回端口
 *
 * env 覆盖：
 *   REDIS_URL（默认 redis://127.0.0.1:6379）、DATABASE_POOL_MAX（默认 20，注入 connection_limit）、
 *   S3_ENDPOINT / S3_PUBLIC_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_REGION。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER_DIR = path.join(ROOT, 'server');

// 极简 .env 加载：server/.env 里的 KEY=VALUE 仅在 process.env 未设置时兜底。
// 不覆盖外部注入的环境变量（显式 TUNNEL_ORIGINS=... node run-backend.mjs 优先）。
function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env 缺失/损坏不影响编排器本身
  }
}
loadEnvFile(path.join(SERVER_DIR, '.env'));
const REPORTS_DIR = path.join(ROOT, 'reports', 'e2e');
const PGDATA_DIR = path.join(REPORTS_DIR, 'pgdata');
const RUN_JSON = path.join(REPORTS_DIR, 'run.json');
const SERVER_LOG = path.join(REPORTS_DIR, 'server.log');
const ORCH_LOG = path.join(REPORTS_DIR, 'run-backend.log');
const PG_LOG = path.join(REPORTS_DIR, 'postgres.log');

const PG_PORT = Number(process.env.E2E_PG_PORT ?? 55432);
const DB_NAME = process.env.E2E_DB_NAME ?? 'dijiang';
const DB_USER = process.env.E2E_DB_USER ?? 'postgres';
const DB_PASSWORD = process.env.E2E_DB_PASSWORD ?? 'postgres';
const OWNER_HANDLE = (process.env.OWNER_HANDLE ?? 'founder').toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? 'Dijiang#2026';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Dijiang#2026';

const argv = process.argv.slice(2);
const FLAGS = new Set(argv.filter((item) => item.startsWith('--')));
const argValue = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const API_PORT = Number(argValue('--api-port', process.env.E2E_API_PORT ?? 3000));

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const DATABASE_POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 20);
/** connection_limit 由 DATABASE_POOL_MAX 注入；pool_timeout/connect_timeout 固定为 10s/5s */
const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}?connection_limit=${DATABASE_POOL_MAX}&pool_timeout=10&connect_timeout=5`;
const ADMIN_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`;
const API_BASE = `http://127.0.0.1:${API_PORT}`;

/* ── 局域网可访问（task-14）────────────────────────────────────────────
 * API_HOST：监听地址，默认 0.0.0.0（手机/其他电脑可访问）；API_HOST=127.0.0.1 可退回仅本机。
 * CORS_ORIGINS：未显式设置时 = localhost/127.0.0.1 的开发端口 + 自动探测到的 LAN IP。
 * S3_PUBLIC_ENDPOINT：浏览器直传地址（默认同 S3_ENDPOINT）；LAN 手机直传需 S3 服务监听 0.0.0.0。
 * ──────────────────────────────────────────────────────────────────── */
function detectLanIps() {
  const found = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address)) {
        found.push(address.address);
      }
    }
  }
  return [...new Set(found)];
}
const LAN_IPS = detectLanIps();
const API_HOST = process.env.API_HOST ?? '0.0.0.0';
const CORS_LOCAL_ORIGINS = [
  'http://localhost:3100',
  'http://localhost:3000',
  'http://127.0.0.1:3100',
  'http://127.0.0.1:3000',
];
const CORS_ORIGINS_EFFECTIVE =
  process.env.CORS_ORIGINS ??
  [...CORS_LOCAL_ORIGINS, ...LAN_IPS.flatMap((ip) => [`http://${ip}:3100`, `http://${ip}:3000`])].join(
    ',',
  );

/* ── 真实 S3（rclone serve s3 / MinIO / 其他 S3 兼容服务；无内置替身）────────
 * 默认 http://127.0.0.1:9000（本机 rclone serve s3），凭据 minioadmin/minioadmin，path-style。
 * 启动前会做带签名的 HeadBucket 预检，失败即终止（不降级）。
 * 浏览器直传地址（Phase1）：
 *   - 显式 S3_PUBLIC_ENDPOINT 优先；
 *   - 否则 API_HOST=0.0.0.0 且有 LAN IP 时，自动推导 http://<LAN_IP>:<S3 端口>；
 *   - 否则回退 S3_ENDPOINT。
 * 注意：S3 服务必须监听 0.0.0.0（或 LAN 网卡），否则推导出的地址不可达。
 */
import { resolveS3PublicEndpoint } from './lib/s3-endpoint.mjs';

const S3_DEFAULT_ENDPOINT = 'http://127.0.0.1:9000';
const S3_ENDPOINT_EFFECTIVE = process.env.S3_ENDPOINT ?? S3_DEFAULT_ENDPOINT;
const s3Config = {
  endpoint: S3_ENDPOINT_EFFECTIVE,
  publicEndpoint: resolveS3PublicEndpoint({
    explicit: process.env.S3_PUBLIC_ENDPOINT,
    endpoint: S3_ENDPOINT_EFFECTIVE,
    apiHost: API_HOST,
    lanIps: LAN_IPS,
  }),
  bucket: process.env.S3_BUCKET ?? 'dijiang',
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  region: process.env.S3_REGION ?? 'us-east-1',
};

/* ── 日志 ─────────────────────────────────────────────────────────────── */
function stamp() {
  return new Date().toISOString();
}
function log(message) {
  const line = `[${stamp()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(ORCH_LOG, `${line}\n`);
  } catch {
    /* 日志失败不影响主流程 */
  }
}
function logSection(title) {
  log(`── ${title} ──`);
}

/* ── 进程工具 ─────────────────────────────────────────────────────────── */
function run(cmd, args, options = {}) {
  const { cwd = ROOT, env = process.env, shell = false, timeoutMs = 900_000, label } = options;
  const display = label ?? [cmd, ...args].join(' ');
  log(`$ ${display}   (cwd=${cwd})`);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env,
        shell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      // Node 24 在 Windows 上直接 spawn .cmd 会同步抛 EINVAL，这里降级为一条结果而不是炸掉整条流水线
      resolve({ code: -1, stdout: '', stderr: `spawn ${cmd} 失败：${error.message}`, ms: Date.now() - startedAt });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      log(`!! 超时 ${timeoutMs}ms，终止：${display}`);
      killTree(child.pid);
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, ms: Date.now() - startedAt });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - startedAt });
    });
  });
}

function killTree(pid, force = true) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    }
  } catch {
    /* 进程可能已退出 */
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(file) {
  try {
    return Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]) || 0;
  } catch {
    return 0;
  }
}

/**
 * Windows：postgres.exe 拒绝以“管理员”令牌运行
 *   "Execution of PostgreSQL by a user with administrative permissions is not permitted."
 * pg_ctl.exe 会先用 CreateRestrictedToken() 掉管理员组再拉起 postgres，所以能正常启动。
 * 因此 Windows 上 start/stop 都走 pg_ctl（这也是本机唯一能让真实 PG 起来的路径，已实测）。
 */
let pgCtlBinary = null;
function pgCtlPath() {
  if (process.platform !== 'win32') return null;
  const candidate = path.join(
    HERE,
    'node_modules',
    '@embedded-postgres',
    'windows-x64',
    'native',
    'bin',
    'pg_ctl.exe',
  );
  return fs.existsSync(candidate) ? candidate : null;
}

/** 直接 spawn（参数数组，绕开 cmd 引号/中文路径问题），stdout/stderr 落到文件，避免管道被 postgres 继承导致挂起 */
function runToLog(cmd, args, { logFile, timeoutMs = 180_000, label } = {}) {
  log(`$ ${label ?? `${cmd} ${args.join(' ')}`}`);
  return new Promise((resolve) => {
    const fd = fs.openSync(logFile, 'a');
    const child = spawn(cmd, args, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    });
    const timer = setTimeout(() => {
      killTree(child.pid);
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
      resolve({ code: -1, timedOut: true });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
      resolve({ code: -1, error: error.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
      resolve({ code: code ?? -1 });
    });
  });
}

const PGCTL_LOG = path.join(REPORTS_DIR, 'pgctl.log');

async function startPostgresViaPgCtl(pgCtl) {
  const result = await runToLog(
    pgCtl,
    [
      '-D',
      PGDATA_DIR,
      '-l',
      PG_LOG,
      '-o',
      `-p ${PG_PORT} -c listen_addresses=127.0.0.1`,
      'start',
      '-w',
      '-t',
      '90',
    ],
    { logFile: PGCTL_LOG, timeoutMs: 180_000, label: 'pg_ctl start -w -t 90' },
  );
  if (result.code !== 0) {
    throw new Error(
      `pg_ctl start 失败（exit ${result.code}）；详见 reports/e2e/pgctl.log 与 reports/e2e/postgres.log`,
    );
  }
  await waitFor(() => portOpen(PG_PORT), { timeoutMs: 30_000, label: `Postgres 端口 ${PG_PORT}` });
}

async function stopPostgresViaPgCtl(pgCtl) {
  const result = await runToLog(pgCtl, ['-D', PGDATA_DIR, '-m', 'fast', '-w', '-t', '60', 'stop'], {
    logFile: PGCTL_LOG,
    timeoutMs: 90_000,
    label: 'pg_ctl stop -m fast -w',
  });
  if (result.code !== 0) log(`!! pg_ctl stop exit=${result.code}（可能已停止）`);
}


function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen({ port, host: '127.0.0.1', exclusive: true });
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function waitFor(check, { timeoutMs = 90_000, intervalMs = 500, label = '条件' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} 等待超时（${timeoutMs}ms）${lastError ? `：${lastError.message}` : ''}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpJson(url, { timeoutMs = 3000 } = {}) {
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

/* ── 运行态记录 ───────────────────────────────────────────────────────── */
function readRunJson() {
  try {
    return JSON.parse(fs.readFileSync(RUN_JSON, 'utf8'));
  } catch {
    return null;
  }
}
function writeRunJson(payload) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(RUN_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/* ── --stop ───────────────────────────────────────────────────────────── */
async function stopAll() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const state = readRunJson() ?? {};
  logSection('停止 E2E 后端');

  const apiPid = state.api?.pid;
  if (isAlive(apiPid)) {
    log(`停止 API 进程树 pid=${apiPid}`);
    killTree(apiPid);
    await waitFor(async () => !isAlive(apiPid), { timeoutMs: 15_000, label: 'API 退出' }).catch(
      (error) => log(`!! ${error.message}`),
    );
  } else {
    log('API 进程未在运行（或 run.json 无 pid）');
  }

  // Postgres：Windows 优先 pg_ctl stop（优雅 fast shutdown），否则按 pid 杀进程树
  const pgCtl = state.postgres?.pgCtl ?? pgCtlPath();
  const dataDirExists = fs.existsSync(path.join(PGDATA_DIR, 'postmaster.pid'));
  if (pgCtl && dataDirExists) {
    log('pg_ctl stop -m fast …');
    await stopPostgresViaPgCtl(pgCtl);
  }
  let pgPid = state.postgres?.pid ?? 0;
  if (!isAlive(pgPid)) pgPid = readPidFile(path.join(PGDATA_DIR, 'postmaster.pid'));
  if (isAlive(pgPid)) {
    log(`停止 Postgres 进程树 pid=${pgPid}`);
    killTree(pgPid);
    await waitFor(async () => !isAlive(pgPid), { timeoutMs: 20_000, label: 'Postgres 退出' }).catch(
      (error) => log(`!! ${error.message}`),
    );
  } else {
    log('Postgres 进程未在运行');
  }

  await sleep(500);
  const apiPortFree = await canListen(API_PORT);
  const pgPortFree = await canListen(PG_PORT);
  log(
    `端口占用回收：api:${API_PORT}=${apiPortFree ? '已释放' : '仍被占用'} pg:${PG_PORT}=${pgPortFree ? '已释放' : '仍被占用'}`,
  );

  writeRunJson({
    ...state,
    status: 'stopped',
    stoppedAt: new Date().toISOString(),
    portsReleased: { api: apiPortFree, postgres: pgPortFree },
  });
  log('已停止，run.json 标记 status=stopped');
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */
const steps = [];
async function step(name, fn) {
  const startedAt = Date.now();
  logSection(name);
  try {
    const detail = await fn();
    const record = { name, ok: true, ms: Date.now() - startedAt, detail: detail ?? null };
    steps.push(record);
    log(`✓ ${name}（${record.ms}ms）${detail ? ` → ${JSON.stringify(detail)}` : ''}`);
    return detail;
  } catch (error) {
    const record = {
      name,
      ok: false,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
    steps.push(record);
    log(`✗ ${name}（${record.ms}ms）：${error.message}`);
    throw error;
  }
}

async function main() {
  if (FLAGS.has('--stop')) {
    await stopAll();
    return;
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(ORCH_LOG, '');
  log(`帝江号 E2E 后端启动脚本 · node ${process.version} · ${process.platform}/${process.arch}`);
  log(`仓库根目录：${ROOT}`);
  log(`模式：${FLAGS.has('--reset') ? '--reset（清库重建）' : '增量'}${FLAGS.has('--skip-build') ? ' + --skip-build' : ''}`);
  if (FLAGS.has('--with-s3')) {
    log('!! --with-s3 已废弃：内置 S3 替身已移除，请先启动真实 S3（rclone serve s3 / MinIO），本脚本会做 HeadBucket 预检');
  }
  log(`依赖：Redis=${REDIS_URL} · PG 池=${DATABASE_POOL_MAX} · S3=${s3Config.endpoint}/${s3Config.bucket}`);

  // 已有实例仍在跑：先停，避免 3000/55432 冲突
  const previous = readRunJson();
  if (previous?.status === 'running' && (isAlive(previous.api?.pid) || isAlive(previous.postgres?.pid))) {
    log('检测到上一轮实例仍在运行，先清理');
    await stopAll();
  }

  await step('预检：端口与目录', async () => {
    if (!fs.existsSync(path.join(SERVER_DIR, 'package.json'))) {
      throw new Error(`找不到 ${path.join(SERVER_DIR, 'package.json')}`);
    }
    if (FLAGS.has('--reset') && fs.existsSync(PGDATA_DIR)) {
      log(`删除旧数据目录 ${PGDATA_DIR}`);
      fs.rmSync(PGDATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
    if (!(await canListen(PG_PORT))) {
      const state = readRunJson();
      throw new Error(
        `端口 ${PG_PORT} 已被占用${state?.postgres?.pid ? `（run.json 记录 pg pid=${state.postgres.pid}）` : ''}，请先 node run-backend.mjs --stop`,
      );
    }
    if (!(await canListen(API_PORT))) {
      throw new Error(`端口 ${API_PORT} 已被占用（前端/其他 dev server？），可加 --api-port <端口> 或先释放`);
    }
    return { pgPort: PG_PORT, apiPort: API_PORT };
  });

  // ── 1) 真实 Postgres ────────────────────────────────────────────────
  let pgInstance = null;
  let pgVersion = null;
  const postgres = await step('启动真实 Postgres（embedded-postgres）', async () => {
    const module = await import('embedded-postgres');
    const EmbeddedPostgres = module.default ?? module.EmbeddedPostgres;
    if (typeof EmbeddedPostgres !== 'function') {
      throw new Error('embedded-postgres 模块导出异常，找不到默认构造函数');
    }
    const packageVersion = JSON.parse(
      fs.readFileSync(path.join(HERE, 'node_modules', 'embedded-postgres', 'package.json'), 'utf8'),
    ).version;

    fs.mkdirSync(PGDATA_DIR, { recursive: true });
    const fresh = !fs.existsSync(path.join(PGDATA_DIR, 'PG_VERSION'));
    log(`数据目录 ${PGDATA_DIR}（${fresh ? '空，需 initdb' : '已初始化，复用'}）`);

    /**
     * Windows + 中文仓库路径的坑（已实测，证据见 reports/e2e/REPORT.md）：
     * 若给 initdb 传 `--encoding=UTF8`，post-bootstrap 阶段会报
     *   FATAL: invalid byte sequence for encoding "UTF8": 0xcf 0xee
     * 因为 initdb 会把数据目录路径按系统 ANSI 代码页（CP936/GBK）写进初始化 SQL，
     * 而 UTF8 编码的 single-user 后端拒绝这段 GBK 字节。
     * 结论：initdb 只传 `--locale=C`（不指定 encoding），集群默认编码为 SQL_ASCII；
     * 随后用 `CREATE DATABASE ... TEMPLATE template0 ENCODING 'UTF8'` 建业务库，
     * 业务库仍是真正的 UTF8，中文与 emoji 都能存。
     */
    const options = {
      databaseDir: PGDATA_DIR,
      user: DB_USER,
      password: DB_PASSWORD,
      port: PG_PORT,
      persistent: true,
      initdbFlags: ['--locale=C'],
      postgresFlags: [],
    };
    pgInstance = new EmbeddedPostgres(options);
    if (fresh) {
      log('initdb …');
      await pgInstance.initialise();
    }

    let startMethod;
    pgCtlBinary = pgCtlPath();
    if (pgCtlBinary) {
      log('pg_ctl start（Windows 必须走 pg_ctl：它用受限令牌启动 postgres，绕过管理员权限限制）…');
      await startPostgresViaPgCtl(pgCtlBinary);
      startMethod = 'pg_ctl.exe start -w（受限令牌）';
    } else {
      log('embedded-postgres start() …');
      await pgInstance.start();
      startMethod = 'embedded-postgres start()';
    }

    // initdb 会 patch pg_hba（trust/local），保证 127.0.0.1 可连
    const pgPid = readPidFile(path.join(PGDATA_DIR, 'postmaster.pid'));
    log(`Postgres 已启动 pid=${pgPid} port=${PG_PORT}`);

    await waitFor(() => portOpen(PG_PORT), { timeoutMs: 30_000, label: `Postgres 端口 ${PG_PORT}` });

    // 取真实版本号 + 建 UTF8 业务库
    let clusterEncoding = null;
    let databaseEncoding = null;
    try {
      const admin = await pgInstance.getPgClient();
      await admin.connect();
      const versionResult = await admin.query('SELECT version() AS version, current_setting($1) AS encoding', [
        'server_encoding',
      ]);
      pgVersion = versionResult.rows?.[0]?.version ?? null;
      clusterEncoding = versionResult.rows?.[0]?.encoding ?? null;
      log(`PG version: ${pgVersion}`);
      log(`集群默认编码（template1）: ${clusterEncoding}`);

      // 建库：显式 UTF8 + template0（集群是 SQL_ASCII，见上方注释）
      try {
        await admin.query(
          `CREATE DATABASE "${DB_NAME}" WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`,
        );
        log(`数据库 ${DB_NAME} 已创建（ENCODING=UTF8）`);
      } catch (error) {
        if (/already exists|42P04/i.test(String(error?.message ?? error))) {
          log(`数据库 ${DB_NAME} 已存在，跳过创建`);
        } else {
          throw new Error(`创建数据库 ${DB_NAME} 失败：${error?.message ?? error}`);
        }
      }
      await admin.end();

      // 校验业务库编码确实是 UTF8（Prisma/中文/emoji 都依赖它）
      const client = await pgInstance.getPgClient(DB_NAME);
      await client.connect();
      const dbInfo = await client.query(
        'SELECT current_database() AS db, current_setting($1) AS encoding, version() AS version',
        ['server_encoding'],
      );
      databaseEncoding = dbInfo.rows?.[0]?.encoding ?? null;
      log(`业务库 ${DB_NAME} 编码: ${databaseEncoding}`);
      if (databaseEncoding !== 'UTF8') {
        throw new Error(`业务库 ${DB_NAME} 编码为 ${databaseEncoding}，期望 UTF8`);
      }
      await client.end();
    } catch (error) {
      if (error instanceof Error && /创建数据库|期望 UTF8/.test(error.message)) throw error;
      log(`（版本/编码查询失败，忽略：${error?.message ?? error}）`);
    }

    return {
      real: true,
      engine: 'embedded-postgres',
      packageVersion,
      version: pgVersion,
      clusterEncoding,
      databaseEncoding,
      startMethod,
      pgCtl: pgCtlBinary,
      pid: pgPid,
      port: PG_PORT,
      dataDir: PGDATA_DIR,
      database: DB_NAME,
      databaseUrl: DATABASE_URL,
      adminUrl: ADMIN_URL,
      pgLog: PG_LOG,
      initdbFlags: options.initdbFlags,
    };
  });

  // ── 2) prisma generate + migrate deploy ────────────────────────────
  const prismaCli = path.join(SERVER_DIR, 'node_modules', 'prisma', 'build', 'index.js');
  const childEnv = { ...process.env, DATABASE_URL, REDIS_URL, NODE_ENV: 'development' };

  await step('prisma CLI 可用性', async () => {
    if (!fs.existsSync(prismaCli)) {
      throw new Error(`找不到 ${prismaCli}，请先在 server/ 执行 pnpm install`);
    }
    return { prismaCli };
  });

  await step('prisma generate', async () => {
    const result = await run(process.execPath, [prismaCli, 'generate', '--schema', 'prisma/schema.prisma'], {
      cwd: SERVER_DIR,
      env: childEnv,
      timeoutMs: 300_000,
      label: 'prisma generate',
    });
    if (result.code !== 0) {
      throw new Error(`prisma generate 失败（exit ${result.code}）：\n${tail(result.stderr || result.stdout, 2500)}`);
    }
    return { ms: result.ms };
  });

  // 迁移在 build 之后执行（见下方 §3 之后），与 lead 约定的顺序一致

  // ── 3) build + migrate + init-owner + seed ─────────────────────────
  let buildInfo = null;
  if (!FLAGS.has('--skip-build')) {
    buildInfo = await step('server 构建（pnpm build）', async () => {
      const candidates = [
        // Node 24 + Windows：.cmd 必须走 shell
        { cmd: 'pnpm.cmd build', args: [], shell: true, label: 'pnpm.cmd build (shell)' },
        { cmd: 'pnpm build', args: [], shell: true, label: 'pnpm build (shell)' },
        // 兜底：直接调用 server 本地 tsc，语义与 `pnpm build` 相同（tsc -p tsconfig.build.json）
        {
          cmd: process.execPath,
          args: [path.join(SERVER_DIR, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'],
          shell: false,
          label: 'node node_modules/typescript/bin/tsc -p tsconfig.build.json',
        },
      ];
      let lastError = null;
      for (const candidate of candidates) {
        const result = await run(candidate.cmd, candidate.args, {
          cwd: SERVER_DIR,
          env: childEnv,
          shell: candidate.shell,
          timeoutMs: 600_000,
          label: candidate.label,
        });
        if (result.code === 0) {
          return { tool: candidate.label, ms: result.ms };
        }
        lastError = `${candidate.label} 失败（exit ${result.code}）：\n${tail(result.stderr || result.stdout, 2500)}`;
        log(`!! ${candidate.label} 不可用，尝试下一种`);
      }
      throw new Error(lastError ?? 'pnpm build 失败');
    });
  } else {
    log('--skip-build：复用已有 dist');
  }

  await step('prisma migrate deploy', async () => {
    const result = await run(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      { cwd: SERVER_DIR, env: childEnv, timeoutMs: 300_000, label: 'prisma migrate deploy' },
    );
    if (result.code !== 0) {
      throw new Error(`migrate deploy 失败（exit ${result.code}）：\n${tail(result.stderr || result.stdout, 3000)}`);
    }
    const summary = (result.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-6);
    log(summary.join('\n'));
    return { summary, ms: result.ms };
  });

  await step('prisma migrate status', async () => {
    const result = await run(process.execPath, [prismaCli, 'migrate', 'status', '--schema', 'prisma/schema.prisma'], {
      cwd: SERVER_DIR,
      env: childEnv,
      timeoutMs: 120_000,
      label: 'prisma migrate status',
    });
    const status = (result.stdout || result.stderr || '').trim();
    log(status.split(/\r?\n/).slice(-8).join('\n'));
    return { code: result.code, status: status.slice(-1500) };
  });
  const distMain = path.join(SERVER_DIR, 'dist', 'main.js');
  const distInit = path.join(SERVER_DIR, 'dist', 'scripts', 'init-owner.js');
  const distSeed = path.join(SERVER_DIR, 'dist', 'scripts', 'seed.js');

  await step('校验 dist 产物', async () => {
    const missing = [distMain, distInit, distSeed].filter((file) => !fs.existsSync(file));
    if (missing.length > 0) {
      throw new Error(`dist 产物缺失：${missing.join(', ')}（去掉 --skip-build 重新构建）`);
    }
    return {
      main: { path: distMain, mtime: fs.statSync(distMain).mtime.toISOString() },
      initOwner: fs.statSync(distInit).mtime.toISOString(),
      seed: fs.statSync(distSeed).mtime.toISOString(),
    };
  });

  await step('init-owner（OWNER_HANDLE/OWNER_PASSWORD）', async () => {
    const result = await run(process.execPath, [distInit], {
      cwd: SERVER_DIR,
      env: { ...childEnv, OWNER_HANDLE, OWNER_PASSWORD, OWNER_DISPLAY_NAME: '建立者' },
      timeoutMs: 180_000,
      label: 'node dist/scripts/init-owner.js',
    });
    if (result.code !== 0) {
      throw new Error(`init-owner 失败（exit ${result.code}）：\n${tail(result.stderr || result.stdout, 2500)}`);
    }
    const text = (result.stdout || '').trim();
    log(text);
    return { handle: OWNER_HANDLE, output: text.split(/\r?\n/).slice(-4) };
  });

  await step('seed（SEED_PASSWORD）', async () => {
    if (FLAGS.has('--skip-seed')) {
      log('--skip-seed：跳过种子数据');
      return { skipped: true };
    }
    const result = await run(process.execPath, [distSeed], {
      cwd: SERVER_DIR,
      env: { ...childEnv, SEED_PASSWORD, S3_BUCKET: 'dijiang' },
      timeoutMs: 600_000,
      label: 'node dist/scripts/seed.js',
    });
    if (result.code !== 0) {
      throw new Error(`seed 失败（exit ${result.code}）：\n${tail(result.stderr || result.stdout, 3000)}`);
    }
    const text = (result.stdout || '').trim();
    log(text);
    return { output: text.split(/\r?\n/).slice(-8) };
  });

  // ── 4) 真实 S3 预检（带签名 HeadBucket；失败即终止，不降级）───────────
  const s3Info = await step(`S3 预检（HeadBucket ${s3Config.endpoint}/${s3Config.bucket}）`, async () => {
    const client = new S3Client({
      region: s3Config.region,
      endpoint: s3Config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
    });
    const startedAt = Date.now();
    try {
      const head = await client.send(new HeadBucketCommand({ Bucket: s3Config.bucket }));
      const status = head.$metadata.httpStatusCode;
      if (status !== 200) throw new Error(`HeadBucket 返回 ${status}`);
      log(
        `S3 就绪：${s3Config.endpoint} bucket=${s3Config.bucket}（HeadBucket 200，${Date.now() - startedAt}ms）`,
      );
    } catch (error) {
      throw new Error(
        `S3 不可用：HeadBucket ${s3Config.endpoint}/${s3Config.bucket} 失败（${error?.message ?? error}）。` +
          '请先启动真实 S3 服务（本机：rclone serve s3 … --addr 127.0.0.1:9000）并检查 S3_* env',
      );
    } finally {
      client.destroy?.();
    }
    return {
      enabled: true,
      endpoint: s3Config.endpoint,
      publicEndpoint: s3Config.publicEndpoint,
      bucket: s3Config.bucket,
      accessKeyId: s3Config.accessKeyId,
      region: s3Config.region,
      implementation: process.env.S3_IMPLEMENTATION ?? 'rclone-s3',
      implementationSource: process.env.S3_IMPLEMENTATION ? 'env' : 'default',
      signatureCheck: true,
      headBucketMs: Date.now() - startedAt,
      note: '真实 S3 兼容服务（本机 rclone serve s3；生产可为 MinIO/云 S3），非内置替身',
    };
  });

  // ── 5) 启动 API ─────────────────────────────────────────────────────
  let apiChild = null;
  const api = await step('启动 API（node dist/main.js）', async () => {
    fs.writeFileSync(SERVER_LOG, '');
    const env = {
      ...childEnv,
      PORT: String(API_PORT),
      HOST: API_HOST,
      DATABASE_URL,
      DATABASE_POOL_MAX: String(DATABASE_POOL_MAX),
      REDIS_URL,
      S3_ENDPOINT: s3Config.endpoint,
      S3_PUBLIC_ENDPOINT: s3Config.publicEndpoint,
      S3_BUCKET: s3Config.bucket,
      S3_ACCESS_KEY_ID: s3Config.accessKeyId,
      S3_SECRET_ACCESS_KEY: s3Config.secretAccessKey,
      S3_REGION: s3Config.region,
      JWT_ACCESS_SECRET: 'dev-access-secret-please-change-0001',
      JWT_REFRESH_SECRET: 'dev-refresh-secret-please-change-01',
      CORS_ORIGINS: CORS_ORIGINS_EFFECTIVE,
      LAN_ORIGINS_AUTO: process.env.LAN_ORIGINS_AUTO ?? 'true',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      PUSH_ENABLED: 'false',
      RTC_SIGNALING_ENABLED: 'false',
    };

    const stream = fs.createWriteStream(SERVER_LOG, { flags: 'a' });
    apiChild = spawn(process.execPath, [distMain], {
      cwd: SERVER_DIR,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const write = (chunk) => {
      stream.write(chunk);
      const text = chunk.toString();
      process.stdout.write(text.replace(/^/gm, '  [api] '));
    };
    apiChild.stdout.on('data', write);
    apiChild.stderr.on('data', write);
    apiChild.on('exit', (code, signal) => {
      log(`API 进程退出 code=${code} signal=${signal}`);
      stream.write(`\n[run-backend] API 进程退出 code=${code} signal=${signal}\n`);
    });

    let exited = false;
    apiChild.once('exit', () => {
      exited = true;
    });

    const health = await waitFor(
      async () => {
        if (exited) {
          throw new Error(`API 进程提前退出，日志尾部：\n${tail(fs.readFileSync(SERVER_LOG, 'utf8'), 3000)}`);
        }
        try {
          const response = await httpJson(`${API_BASE}/healthz`, { timeoutMs: 2000 });
          if (response.status === 200) return response.body;
        } catch {
          /* 尚未监听 */
        }
        return null;
      },
      { timeoutMs: 120_000, intervalMs: 500, label: '/healthz 200' },
    );

    // /readyz：S3 未起会 degraded（预期），但 postgres 必须是 ok
    let readyz = null;
    try {
      readyz = await httpJson(`${API_BASE}/readyz`, { timeoutMs: 20_000 });
    } catch (error) {
      readyz = { status: 0, body: { error: error.message } };
    }
    log(`/readyz → ${readyz.status} ${JSON.stringify(readyz.body)}`);
    // 三项依赖都必须 ok：PG / S3 / Redis（Redis 无内存降级）
    for (const name of ['postgres', 's3', 'redis']) {
      const check = readyz.body?.checks?.find((item) => item.name === name);
      if (check?.ok !== true) log(`!! /readyz 的 ${name} 检查未通过`);
    }
    const redisCheck = readyz.body?.checks?.find((item) => item.name === 'redis');
    if (redisCheck?.ok === true) log(`Redis 就绪：${REDIS_URL}`);

    return {
      pid: apiChild.pid,
      port: API_PORT,
      host: API_HOST,
      baseUrl: API_BASE,
      lanUrls: LAN_IPS.map((ip) => `http://${ip}:${API_PORT}`),
      apiPrefix: '/api/v1',
      healthz: health,
      readyz,
      log: SERVER_LOG,
    };
  });

  // ── 6) run.json ────────────────────────────────────────────────────
  const runState = {
    status: 'running',
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    repoRoot: ROOT,
    lan: {
      ips: LAN_IPS,
      apiHost: API_HOST,
      corsOrigins: CORS_ORIGINS_EFFECTIVE,
      webUrls: LAN_IPS.map((ip) => `http://${ip}:3100`),
      apiUrls: LAN_IPS.map((ip) => `http://${ip}:${API_PORT}`),
      s3PublicEndpoint: s3Config.publicEndpoint,
      note: 'LAN 访问：手机与电脑同一网段；HTTP 非 Secure 上下文，Web Push/getUserMedia 不可用',
    },
    postgres,
    api,
    s3: {
      enabled: true,
      endpoint: s3Config.endpoint,
      publicEndpoint: s3Config.publicEndpoint,
      bucket: s3Config.bucket,
      accessKeyId: s3Config.accessKeyId,
      implementation: s3Info.implementation,
      implementationSource: s3Info.implementationSource,
      signatureCheck: true,
      headBucketMs: s3Info.headBucketMs,
      note: s3Info.note,
    },
    build: buildInfo,
    env: {
      PORT: String(API_PORT),
      HOST: API_HOST,
      DATABASE_URL,
      DATABASE_POOL_MAX: String(DATABASE_POOL_MAX),
      REDIS_URL,
      S3_ENDPOINT: s3Config.endpoint,
      S3_PUBLIC_ENDPOINT: s3Config.publicEndpoint,
      S3_BUCKET: s3Config.bucket,
      S3_ACCESS_KEY_ID: s3Config.accessKeyId,
      CORS_ORIGINS: CORS_ORIGINS_EFFECTIVE,
      LAN_ORIGINS_AUTO: process.env.LAN_ORIGINS_AUTO ?? 'true',
      NODE_ENV: 'development',
    },
    credentials: {
      owner: { handle: OWNER_HANDLE, password: OWNER_PASSWORD },
      seedPassword: SEED_PASSWORD,
      members: [
        { handle: 'chen', displayName: '陈工' },
        { handle: 'lin', displayName: '林测绘' },
        { handle: 'yue', displayName: '岳调度' },
        { handle: 'qiu', displayName: '邱档案' },
      ],
      channels: [
        { slug: 'general', name: '全域播报' },
        { slug: 'archive', name: '素材工坊' },
        { slug: 'protocol', name: '第三协议（私密）' },
      ],
    },
    steps,
    logs: { server: SERVER_LOG, postgres: PG_LOG, orchestrator: ORCH_LOG },
    stopCommand: 'node ops/e2e/run-backend.mjs --stop',
  };
  writeRunJson(runState);
  log(`run.json 已写入 ${RUN_JSON}`);
  log('');
  log('════════════════════════════════════════════════════════════');
  log('  后端已就绪：');
  log(`  API      ${API_BASE}  (pid ${api.pid}，监听 ${API_HOST}:${API_PORT})`);
  if (LAN_IPS.length > 0) {
    for (const ip of LAN_IPS) {
      log(`  LAN API  http://${ip}:${API_PORT}  ← 手机/其他设备用这个`);
      log(`  LAN 前端 http://${ip}:3100（需同时启动 web，见 docs/19）`);
    }
  } else {
    log('  LAN      未探测到私网 IPv4；如需局域网访问请检查网卡或手动设置 CORS_ORIGINS');
  }
  log(`  CORS     ${CORS_ORIGINS_EFFECTIVE}`);
  log(`  Postgres ${DATABASE_URL}  (pid ${postgres.pid})`);
  if (s3Info) log(`  S3       ${s3Config.endpoint} → 直传 ${s3Config.publicEndpoint}  bucket=${s3Config.bucket}（真实 S3 兼容服务：${s3Info.implementation}，HeadBucket 200）`);
  log(`  Redis    ${REDIS_URL}（真实 Redis，PING 通过）`);
  log(`  PG 池    DATABASE_POOL_MAX=${DATABASE_POOL_MAX}（connection_limit 已注入 URL）`);
  log(`  owner    ${OWNER_HANDLE} / ${OWNER_PASSWORD}`);
  log(`  成员口令 ${SEED_PASSWORD}`);
  log('  停止：node ops/e2e/run-backend.mjs --stop  或 Ctrl+C');
  log('════════════════════════════════════════════════════════════');

  // ── 6) 保持前台，等信号 ─────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`收到 ${reason}，开始优雅停止`);
    try {
      if (apiChild && isAlive(apiChild.pid)) {
        killTree(apiChild.pid, false);
        await waitFor(async () => !isAlive(apiChild.pid), { timeoutMs: 10_000, label: 'API 退出' }).catch(
          () => killTree(apiChild.pid),
        );
      }
      if (pgCtlBinary) {
        log('pg_ctl stop -m fast …');
        await stopPostgresViaPgCtl(pgCtlBinary);
      } else if (pgInstance) {
        log('embedded-postgres stop() …');
        await pgInstance.stop().catch((error) => log(`!! pg stop 失败：${error.message}`));
      }
    } finally {
      writeRunJson({ ...runState, status: 'stopped', stoppedAt: new Date().toISOString(), steps });
      log('已停止');
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await new Promise(() => {
    /* 常驻，直到收到信号 */
  });
}

function tail(text, max) {
  const value = (text ?? '').trim();
  return value.length <= max ? value : value.slice(value.length - max);
}

main().catch(async (error) => {
  log(`启动失败：${error.stack ?? error.message}`);
  // 先清理半启动状态（避免占端口），再落最终 failed 记录
  await stopAll().catch(() => undefined);
  const previous = readRunJson();
  writeRunJson({
    ...(previous ?? {}),
    status: 'failed',
    failedAt: new Date().toISOString(),
    error: error.message,
    steps,
  });
  process.exitCode = 1;
});
