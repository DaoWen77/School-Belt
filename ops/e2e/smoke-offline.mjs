#!/usr/bin/env node
/**
 * task-18：断网 60 秒 → 重连 → 按 lastSeq 补拉，验证「无重复、无空洞」。
 *
 * 真实链路：两个真实账号各连 /ws；B 断开（模拟断网掉线）并保持 60s；
 * 期间 A 连续发消息；B 重连后 `GET /channels/:id/messages?direction=newer&cursor=lastSeq` 补拉，
 * 断言：严格递增、无重复、≤lastSeq 的不出现、断线期间消息全部命中（无空洞）；
 * 最后再验一条实时消息，确认重连后的实时链路恢复。
 *
 * 结果：reports/infra/offline-gap.json
 * 用法：node ops/e2e/smoke-offline.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'reports', 'infra');
const OUT = path.join(OUT_DIR, 'offline-gap.json');
const RUN_JSON = path.join(ROOT, 'reports', 'e2e', 'run.json');

const API_BASE = (process.env.API_BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const API = `${API_BASE}/api/v1`;
const WS_URL = `${API_BASE}/ws`;
const WS_PATH = process.env.WS_PATH ?? '/socket.io';
const OFFLINE_MS = Number(process.env.OFFLINE_MS ?? 60_000);
const GAP_MESSAGES = Number(process.env.GAP_MESSAGES ?? 5);

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
const runState = loadJson(RUN_JSON);
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? runState?.credentials?.seedPassword ?? 'Dijiang#2026';
const HANDLE_A = process.env.HANDLE_A ?? 'qiu';
const HANDLE_B = process.env.HANDLE_B ?? 'chen';

const logs = [];
const log = (message) => {
  const line = `[${new Date().toISOString()}] ${message}`;
  logs.push(line);
  console.log(line);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, apiPath, { token, body, timeoutMs = 20_000 } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(`${method} ${apiPath} → HTTP ${response.status} ${JSON.stringify(payload)?.slice(0, 300)}`);
    error.status = response.status;
    error.body = payload;
    throw error;
  }
  return payload?.data ?? payload;
}

async function loginWithRetry(handle) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const data = await api('POST', '/auth/login', {
        body: { handle, password: SEED_PASSWORD, deviceName: 'e2e-offline' },
      });
      if (!data?.accessToken) throw new Error(`${handle} 未返回 accessToken`);
      return { token: data.accessToken, user: data.user };
    } catch (error) {
      if (error.status === 429 && attempt < 4) {
        const waitMs = Number(error.body?.error?.retryAfterMs ?? 61_000) + 2_000;
        log(`  ！${handle} 登录被限流，等待 ${Math.round(waitMs / 1000)}s 后重试`);
        await sleep(Math.min(waitMs, 75_000));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`${handle} 登录失败`);
}

class Ws {
  constructor(label, token) {
    this.label = label;
    this.token = token;
    this.buffer = [];
    this.waiters = [];
  }
  async connect({ timeoutMs = 20_000 } = {}) {
    const socket = io(WS_URL, {
      path: WS_PATH,
      transports: ['websocket'],
      auth: { token: this.token },
      reconnection: false,
      forceNew: true,
      timeout: timeoutMs,
    });
    this.socket = socket;
    socket.onAny((event, ...args) => {
      const record = { event, args, at: Date.now() };
      this.buffer.push(record);
      const remaining = [];
      for (const waiter of this.waiters) {
        if (waiter.event !== event) {
          remaining.push(waiter);
          continue;
        }
        let matched = false;
        try {
          matched = Boolean(waiter.predicate(args));
        } catch {
          matched = false;
        }
        if (!matched) {
          remaining.push(waiter);
          continue;
        }
        clearTimeout(waiter.timer);
        waiter.resolve({ payload: args[0], at: record.at });
      }
      this.waiters = remaining;
    });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: ready 超时`)), timeoutMs);
      socket.once('ready', (payload) => {
        clearTimeout(timer);
        this.ready = payload;
        resolve(payload);
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(new Error(`${this.label}: connect_error ${error?.message ?? error}`));
      });
    });
  }
  waitFor(event, predicate = () => true, timeoutMs = 8000) {
    const buffered = [...this.buffer].reverse().find((record) => record.event === event && (() => {
      try {
        return Boolean(predicate(record.args));
      } catch {
        return false;
      }
    })());
    if (buffered) return Promise.resolve({ payload: buffered.args[0], at: buffered.at });
    return new Promise((resolve, reject) => {
      const waiter = {
        event,
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error(`${this.label}: 等待 ${event} 超时`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }
  emit(event, payload, { timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: ${event} ack 超时`)), timeoutMs);
      this.socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
        clearTimeout(timer);
        if (error) reject(new Error(`${this.label}: ${event} ack 失败：${error.message ?? error}`));
        else resolve(response);
      });
    });
  }
  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

const encodeCursor = (id) => Buffer.from(`seq:${id}`, 'utf8').toString('base64url');
const results = [];
const add = (id, name, ok, detail = {}, error = null) => {
  const entry = { id, name, ok, detail, ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) };
  results.push(entry);
  log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${name}${ok ? '' : `  ← ${entry.error ?? ''}`}`);
  return entry;
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  log(`断网补拉验收：A=${HANDLE_A} B=${HANDLE_B} offline=${OFFLINE_MS / 1000}s gapMessages=${GAP_MESSAGES}`);
  const sockets = [];
  let fatal = null;
  let evidence = {};

  try {
    const [a, b] = await Promise.all([loginWithRetry(HANDLE_A), loginWithRetry(HANDLE_B)]);
    add('O1', '两个账号登录', true, { A: a.user.handle, B: b.user.handle });
    const channels = await api('GET', '/channels', { token: a.token });
    const general = (channels?.channels ?? []).find((item) => item.slug === 'general') ?? channels?.channels?.[0];
    if (!general) throw new Error('找不到 general 频道');

    const wsA = new Ws('A', a.token);
    let wsB = new Ws('B', b.token);
    sockets.push(wsA, wsB);
    await Promise.all([wsA.connect(), wsB.connect()]);
    for (const [label, ws] of [['A', wsA], ['B', wsB]]) {
      const joined = await ws.emit('channel:join', { channelId: general.id });
      if (!joined?.ok) throw new Error(`${label} channel:join 失败`);
    }
    add('O2', 'A/B 连接 /ws 并加入 general', true, { channelId: general.id });

    const latest = await api('GET', `/channels/${general.id}/messages?limit=1&direction=older`, { token: b.token });
    const lastSeq = latest?.messages?.[0]?.id;
    if (!lastSeq) throw new Error('拿不到 lastSeq');
    evidence.lastSeq = lastSeq;

    // B 断开，保持 offline 时长
    const offlineAt = Date.now();
    wsB.disconnect();
    log(`B 已断开（lastSeq=${lastSeq}），开始 ${OFFLINE_MS / 1000}s 离线窗口`);

    const gapIds = [];
    const gapClientIds = [];
    for (let index = 1; index <= GAP_MESSAGES; index += 1) {
      const clientMsgId = randomUUID();
      const ack = await wsA.emit('message:send', {
        channelId: general.id,
        clientMsgId,
        kind: 'text',
        body: `[e2e-offline] 断网期间第 ${index}/${GAP_MESSAGES} 条`,
      });
      if (!ack?.ok) throw new Error(`断网期间 A 发送失败：${JSON.stringify(ack)}`);
      gapIds.push(ack.message.id);
      gapClientIds.push(clientMsgId);
      await sleep(2000); // 避开 5 条/秒突发限制
    }
    const sentAt = Date.now();
    const elapsed = sentAt - offlineAt;
    if (elapsed < OFFLINE_MS) {
      log(`继续等待 ${Math.round((OFFLINE_MS - elapsed) / 1000)}s 补足 60s 离线窗口`);
      await sleep(OFFLINE_MS - elapsed);
    }
    const offlineDurationMs = Date.now() - offlineAt;
    add('O3', `B 离线 ${(offlineDurationMs / 1000).toFixed(1)}s，期间 A 发 ${gapIds.length} 条`, true, {
      offlineDurationMs,
      gapIds,
    });

    // B 重连
    wsB = new Ws('B(重连)', b.token);
    sockets.push(wsB);
    const readyAgain = await wsB.connect();
    const joined = await wsB.emit('channel:join', { channelId: general.id });
    if (!joined?.ok) throw new Error('B 重连后 channel:join 失败');
    add('O4', 'B 重连 ready + 重新加入频道', true, { userId: readyAgain?.user?.id ?? null });

    // 按 lastSeq 补拉
    const page = await api(
      'GET',
      `/channels/${general.id}/messages?direction=newer&cursor=${encodeURIComponent(encodeCursor(lastSeq))}&limit=100`,
      { token: b.token },
    );
    const fetched = (page?.messages ?? []).map((item) => item.id);
    evidence.fetchedIds = fetched;
    evidence.gapIds = gapIds;

    const duplicates = fetched.length - new Set(fetched).size;
    const strictlyIncreasing = fetched.every((id, index) => index === 0 || BigInt(id) > BigInt(fetched[index - 1]));
    const notOlder = fetched.every((id) => BigInt(id) > BigInt(lastSeq));
    const missing = gapIds.filter((id) => !fetched.includes(id));
    const extras = fetched.filter((id) => !gapIds.includes(id));
    const holes = missing.length;

    add('O5', '补拉结果：无重复', duplicates === 0, { duplicates, fetchedCount: fetched.length });
    add('O6', '补拉结果：严格递增', strictlyIncreasing, { fetched });
    add('O7', '补拉结果：不包含 ≤lastSeq 的消息', notOlder, { lastSeq });
    add('O8', '补拉结果：断线期间消息全部命中（无空洞）', holes === 0, { missing, extras, fetched });

    // 再验一条实时消息
    const liveClientId = randomUUID();
    const liveAck = await wsA.emit('message:send', {
      channelId: general.id,
      clientMsgId: liveClientId,
      kind: 'text',
      body: '[e2e-offline] 重连后的实时消息',
    });
    const live = await wsB.waitFor('message:new', (args) => args?.[0]?.message?.clientMsgId === liveClientId, 10_000);
    const liveOk = live?.payload?.message?.id === liveAck?.message?.id;
    add('O9', '重连后实时消息恢复（A→B）', liveOk, { messageId: liveAck?.message?.id });

    evidence = {
      ...evidence,
      direction: 'newer',
      cursor: encodeCursor(lastSeq),
      duplicates,
      holes,
      strictlyIncreasing,
      missing,
      extras,
      liveResumed: liveOk,
      offlineDurationMs,
    };
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    log(`!! 断网验收中断：${fatal}`);
  } finally {
    for (const ws of sockets) {
      try {
        ws.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  const failed = results.filter((item) => !item.ok);
  const result = {
    checkedAt: new Date().toISOString(),
    startedAt,
    apiBase: API_BASE,
    handles: { A: HANDLE_A, B: HANDLE_B },
    scenario: { offlineMs: OFFLINE_MS, gapMessages: GAP_MESSAGES },
    steps: results,
    evidence,
    fatal,
    verdict: failed.length === 0 && !fatal ? 'PASS' : 'FAIL',
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'offline-gap.log'), `${logs.join('\n')}\n`, 'utf8');
  log(`\nverdict=${result.verdict}  证据：${OUT}`);
  process.exitCode = result.verdict === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  log(`脚本异常：${error.stack ?? error.message}`);
  process.exitCode = 1;
});
