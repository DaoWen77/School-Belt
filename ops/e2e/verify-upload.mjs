#!/usr/bin/env node
/**
 * 上传全链路**正式证据**（task-13）：真实登录 → presign → 预签名 PUT → complete
 * → 下载并逐字节比对 → 带附件消息 → 限额/伪造类型拒绝。
 *
 * 前置：
 *   先启动真实 S3 兼容服务（本机 rclone serve s3 @127.0.0.1:9000），再 node ops/e2e/run-backend.mjs
 * 输出：reports/e2e/upload-check.json + upload-check.log
 *
 * 用法：node verify-upload.mjs [--base http://127.0.0.1:3000] [--handle qiu]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUploadFlow } from './lib/upload-flow.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REPORTS_DIR = path.join(ROOT, 'reports', 'e2e');
const OUT = path.join(REPORTS_DIR, 'upload-check.json');
const LOG_OUT = path.join(REPORTS_DIR, 'upload-check.log');
const RUN_JSON = path.join(REPORTS_DIR, 'run.json');

const argv = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const BASE = (argValue('--base', process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000')).replace(/\/$/, '');
const API = `${BASE}/api/v1`;

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
const runState = loadJson(RUN_JSON);
/** 真实 S3 信息优先取 run.json（run-backend 的 HeadBucket 预检结果），否则取 env */
const s3State = runState?.s3
  ? {
      ...runState.s3,
      endpoint: runState.s3.endpoint,
      bucket: runState.s3.bucket,
    }
  : {
      implementation: process.env.S3_IMPLEMENTATION ?? 'rclone-s3',
      endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
      bucket: process.env.S3_BUCKET ?? 'dijiang',
      signatureCheck: true,
      note: '真实 S3 兼容服务（rclone serve s3 / MinIO / 云 S3）',
    };

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? runState?.credentials?.seedPassword ?? 'Dijiang#2026';
const OWNER_HANDLE = process.env.OWNER_HANDLE ?? runState?.credentials?.owner?.handle ?? 'founder';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? runState?.credentials?.owner?.password ?? 'Dijiang#2026';
const HANDLE = (argValue('--handle', process.env.E2E_UPLOAD_HANDLE ?? 'qiu')).toLowerCase();
const PASSWORD = process.env.E2E_UPLOAD_PASSWORD ?? (HANDLE === OWNER_HANDLE ? OWNER_PASSWORD : SEED_PASSWORD);

const logLines = [];
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logLines.push(line);
  console.log(line);
}
function flush() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(LOG_OUT, `${logLines.join('\n')}\n`, 'utf8');
}

async function login(handle, password, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ handle, password, deviceName: 'e2e-upload' }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    if (response.ok) {
      const data = payload?.data ?? payload;
      if (!data?.accessToken) throw new Error(`${handle} 登录未返回 accessToken`);
      return { token: data.accessToken, user: data.user };
    }
    if (response.status === 429 && attempt < attempts) {
      const waitMs = Number(payload?.error?.retryAfterMs ?? 60_000) + 2_000;
      log(`  ！登录限流（429），等待 ${Math.round(waitMs / 1000)}s 后重试（${attempt + 1}/${attempts}）`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 75_000)));
      continue;
    }
    throw new Error(`登录失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  throw new Error('登录失败');
}

async function apiGet(pathname, token) {
  const response = await fetch(`${API}${pathname}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GET ${pathname} → HTTP ${response.status} ${text.slice(0, 300)}`);
  return payload?.data ?? payload;
}

async function main() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  log('════════ 帝江号上传全链路验证（契约 §10 / task-13）════════');
  log(`API=${BASE}　登录账号=${HANDLE}`);
  log(`S3 状态：${s3State.implementation}@${s3State.endpoint}（bucket=${s3State.bucket}，SigV4=${s3State.signatureCheck}，真实 S3 兼容服务）`);

  const startedAt = new Date().toISOString();
  let result = null;
  let fatal = null;
  try {
    // 0) 后端与 S3 就绪检查
    const readyz = await (async () => {
      const response = await fetch(`${BASE}/readyz`, { signal: AbortSignal.timeout(20_000) });
      return { status: response.status, body: await response.json().catch(() => null) };
    })();
    const postgresOk = readyz.body?.checks?.find((item) => item.name === 'postgres')?.ok === true;
    const s3Ok = readyz.body?.checks?.find((item) => item.name === 's3')?.ok === true;
    log(`/readyz → ${readyz.status} postgres=${postgresOk} s3=${s3Ok}`);
    if (!s3Ok) throw new Error('S3 未就绪（/readyz s3=false）：请先启动真实 S3（本机 rclone serve s3 @9000）再启动 API');

    // 1) 登录 + 取 general 频道
    const session = await login(HANDLE, PASSWORD);
    log(`登录成功：${session.user.handle}（${session.user.id}）`);
    const channels = await apiGet('/channels', session.token);
    const general = (channels?.channels ?? []).find((channel) => channel.slug === 'general');
    if (!general) throw new Error('找不到 general 频道');
    log(`channel: #${general.name} (${general.id})，myRole=${general.myRole}`);

    // 2) 跑上传全链路
    const flow = await runUploadFlow({
      base: API,
      token: session.token,
      channelId: general.id,
      log,
    });
    result = {
      contract: 'docs/_contract-v1.2.md §10 文件直传（F9）',
      suite: 'upload-full-chain',
      startedAt,
      finishedAt: new Date().toISOString(),
      apiBase: BASE,
      s3: {
        implementation: s3State.implementation,
        endpoint: s3State.endpoint,
        publicEndpoint: s3State.publicEndpoint ?? s3State.endpoint,
        bucket: s3State.bucket,
        signatureCheck: s3State.signatureCheck ?? true,
        note: '真实 S3 兼容服务（本机 rclone serve s3；生产为 MinIO/云 S3，需配置桶 CORS）',
      },
      credentials: { handle: session.user.handle, id: session.user.id },
      channel: { id: general.id, name: general.name },
      verdict: flow.ok ? 'PASS' : 'FAIL',
      ...flow,
    };
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    log(`!! 中断：${fatal}`);
    result = {
      suite: 'upload-full-chain',
      startedAt,
      finishedAt: new Date().toISOString(),
      apiBase: BASE,
      verdict: 'FAIL',
      fatal,
      steps: [],
    };
  } finally {
    flush();
  }

  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  log('');
  log(`════════ 结果：${result.verdict} ════════`);
  for (const step of result.steps ?? []) log(`  ${step.ok ? 'PASS' : 'FAIL'}  ${step.id} ${step.name}${step.ok ? '' : `  ← ${step.error}`}`);
  if (fatal) log(`  fatal: ${fatal}`);
  log(`明细：${OUT}`);
  log(`日志：${LOG_OUT}`);
  process.exitCode = result.verdict === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  log(`脚本异常：${error.stack ?? error.message}`);
  flush();
  process.exitCode = 1;
});
