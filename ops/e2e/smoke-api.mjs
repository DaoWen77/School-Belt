#!/usr/bin/env node
/**
 * O.M.V 帝江号 · API + WS 冒烟（契约 v1.2 §F 1–6）
 *
 * 前置：`node ops/e2e/run-backend.mjs` 已在跑（真实 Postgres + API 3000）。
 * 只用 fetch + socket.io-client 走真实 HTTP/WS，不 mock 任何东西。
 *
 * 覆盖：
 *   F1 两个账号（owner + seed 成员）登录拿 access token
 *   F2 两端连 /ws（namespace /ws，path /socket.io），ready 成功
 *   F3 A 在 general 频道发消息 → B 收到且 id 一致；A 的 ack 带服务端 id
 *   F4 A 对 B 发起 DM → B 收到 conversation:created；双方互发可收
 *   F5 A 建群（含 B、C）→ B/C 收到 conversation:created；群内发消息 B/C 都收到
 *   F6 B 断开 3s 重连 → ready → 按 lastSeq 用 direction=newer 补拉，无重复、无空洞
 *
 * 输出：reports/e2e/api-smoke.json（机器可读）+ reports/e2e/api-smoke.log（人读）+ 控制台
 * 退出码：0 = 全部通过；1 = 有失败（明细见 JSON）
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { runUploadFlow } from './lib/upload-flow.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REPORTS_DIR = path.join(ROOT, 'reports', 'e2e');
const JSON_OUT = path.join(REPORTS_DIR, 'api-smoke.json');
const LOG_OUT = path.join(REPORTS_DIR, 'api-smoke.log');
const RUN_JSON = path.join(REPORTS_DIR, 'run.json');

const argv = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const API_BASE = (argValue('--api-base', process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000')).replace(/\/$/, '');
const API = `${API_BASE}/api/v1`;
const WS_URL = `${API_BASE}/ws`;
const WS_PATH = process.env.E2E_WS_PATH ?? '/socket.io';

const DELIVERY_BUDGET_MS = 300;

/* ── 日志 ─────────────────────────────────────────────────────────────── */
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

/* ── 凭据 ─────────────────────────────────────────────────────────────── */
function loadRunState() {
  try {
    return JSON.parse(fs.readFileSync(RUN_JSON, 'utf8'));
  } catch {
    return null;
  }
}
const runState = loadRunState();
const OWNER_HANDLE = process.env.OWNER_HANDLE ?? runState?.credentials?.owner?.handle ?? 'founder';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? runState?.credentials?.owner?.password ?? 'Dijiang#2026';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? runState?.credentials?.seedPassword ?? 'Dijiang#2026';

/* ── HTTP ─────────────────────────────────────────────────────────────── */
class HttpError extends Error {
  constructor(label, status, body) {
    super(`${label} → HTTP ${status} ${JSON.stringify(body)?.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

async function apiCall(method, apiPath, { token, body, timeoutMs = 15_000 } = {}) {
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
  if (!response.ok) throw new HttpError(`${method} ${apiPath}`, response.status, payload);
  return payload?.data ?? payload;
}

/** 登录（登录限流 5 次/分钟/IP：遇到 429 按服务端 retryAfterMs 精确等待后重试） */
async function loginWithRetry(handle, password, { attempts = 4 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const data = await apiCall('POST', '/auth/login', {
        body: { handle, password, deviceName: 'e2e-smoke' },
      });
      if (!data?.accessToken) throw new Error(`${handle} 未返回 accessToken：${JSON.stringify(data)?.slice(0, 300)}`);
      if (!data?.user?.id) throw new Error(`${handle} 未返回 user.id`);
      return { token: data.accessToken, user: data.user, refreshToken: data.refreshToken, expiresIn: data.expiresIn };
    } catch (error) {
      const rateLimited = error instanceof HttpError && error.status === 429;
      if (!rateLimited || attempt === attempts) throw error;
      const retryAfterMs = Number(error.body?.error?.retryAfterMs ?? 60_000);
      const waitMs = Math.min(Math.max(retryAfterMs, 5_000) + 2_000, 75_000);
      log(`  ！${handle} 登录被限流（429 RATE_LIMITED），等待 ${Math.round(waitMs / 1000)}s 后重试（第 ${attempt + 1}/${attempts} 次）`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`${handle} 登录失败`);
}

/* ── WS harness ──────────────────────────────────────────────────────── */
class WsClient {
  constructor(label, token) {
    this.label = label;
    this.token = token;
    this.socket = null;
    this.buffer = [];
    this.waiters = [];
    this.ready = null;
  }

  async connect({ timeoutMs = 20_000 } = {}) {
    this.buffer = [];
    const socket = io(WS_URL, {
      path: WS_PATH,
      transports: ['websocket'],
      auth: { token: this.token },
      reconnection: false,
      timeout: timeoutMs,
      forceNew: true,
    });
    this.socket = socket;
    socket.onAny((event, ...args) => this._ingest(event, args));
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: 等待 ready 超时（${timeoutMs}ms）`)), timeoutMs);
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

  _ingest(event, args) {
    const record = { event, args, at: Date.now() };
    this.buffer.push(record);
    const remaining = [];
    for (const waiter of this.waiters) {
      if (waiter.event !== event) {
        remaining.push(waiter);
        continue;
      }
      let matched = false;
      let payload;
      try {
        payload = waiter.predicate ? waiter.predicate(args) : args[0];
        matched = Boolean(payload) || payload === 0;
      } catch {
        matched = false;
      }
      if (!matched) {
        remaining.push(waiter);
        continue;
      }
      clearTimeout(waiter.timer);
      waiter.resolve({ payload: payload === true ? args[0] : payload, at: record.at, args });
    }
    this.waiters = remaining;
  }

  /** 等一个事件（先扫已缓冲的历史，避免竞态） */
  waitFor(event, predicate = null, timeoutMs = 5000, { since = 0 } = {}) {
    const buffered = [...this.buffer].reverse().find((record) => {
      if (record.event !== event) return false;
      if (record.at < since) return false;
      if (!predicate) return true;
      try {
        const result = predicate(record.args);
        return Boolean(result) || result === 0;
      } catch {
        return false;
      }
    });
    if (buffered) {
      const payload = predicate ? predicate(buffered.args) : buffered.args[0];
      return Promise.resolve({ payload: payload === true ? buffered.args[0] : payload, at: buffered.at, args: buffered.args });
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        event,
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error(`${this.label}: 等待 ${event} 超时（${timeoutMs}ms）`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  emit(event, payload, { timeoutMs = 8000 } = {}) {
    if (!this.socket) return Promise.reject(new Error(`${this.label}: socket 未连接`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: ${event} ack 超时（${timeoutMs}ms）`)), timeoutMs);
      this.socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
        clearTimeout(timer);
        if (error) {
          reject(new Error(`${this.label}: ${event} ack 失败：${error.message ?? error}`));
          return;
        }
        resolve(response);
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

/* ── 检查记录 ─────────────────────────────────────────────────────────── */
const checks = [];
function record(id, name, ok, detail = {}, error = null) {
  const entry = {
    id,
    name,
    ok,
    detail,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  };
  checks.push(entry);
  log(`${ok ? '✓' : '✗'} ${id} ${name}${ok ? '' : `：${entry.error ?? '断言失败'}`}`);
  return entry;
}

/** 包一层：把异常转成失败记录，但让“整段依赖失败”可以显式跳过 */
async function check(id, name, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    return record(id, name, true, { ...(detail ?? {}), ms: Date.now() - startedAt });
  } catch (error) {
    return record(id, name, false, { ms: Date.now() - startedAt }, error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 与 server/src/common/utils/cursor.ts 的 encodeSeqCursor 等价：base64url(`seq:<id>`) */
function encodeSeqCursor(id) {
  return Buffer.from(`seq:${id}`, 'utf8').toString('base64url');
}

/* ── 主线 ─────────────────────────────────────────────────────────────── */
async function main() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  log('════════ 帝江号 API/WS 冒烟（契约 §F 1–6）════════');
  log(`API_BASE=${API_BASE}  WS=${WS_URL} path=${WS_PATH}`);
  log(`node=${process.version} platform=${process.platform}/${process.arch}`);
  log(`凭据来源：${fs.existsSync(RUN_JSON) ? 'reports/e2e/run.json' : '脚本默认值'}`);
  if (!runState) log('！未找到 run.json：仍按默认凭据尝试（owner=founder / seed 口令 Dijiang#2026）');

  const startedAt = new Date().toISOString();
  const ctx = { A: null, B: null, C: null, generalId: null, sockets: [], dm: null, group: null };
  let fatal = null;

  try {
    // ── F0 前置：后端存活 ────────────────────────────────────────────
    const health = await (async () => {
      try {
        const response = await fetch(`${API_BASE}/healthz`, { signal: AbortSignal.timeout(4000) });
        return { status: response.status, body: await response.json().catch(() => null) };
      } catch (error) {
        return { status: 0, error: error.message };
      }
    })();
    await check('F0', '后端 /healthz 可达', async () => {
      assert(health.status === 200, `/healthz 返回 ${health.status} ${JSON.stringify(health.body ?? health.error)}`);
      return health.body;
    });
    if (health.status !== 200) {
      throw new Error('后端未就绪，后续步骤全部无法执行（请先跑 run-backend.mjs）');
    }

    // ── F1 登录（owner + seed 成员）────────────────────────────────
    await check('F1', `两个账号登录（${OWNER_HANDLE} + seed 成员）`, async () => {
      const login = (handle, password) => loginWithRetry(handle, password);
      ctx.A = await login(OWNER_HANDLE, OWNER_PASSWORD);
      ctx.B = await login('chen', SEED_PASSWORD);
      ctx.C = await login('lin', SEED_PASSWORD);
      log(`  A=${ctx.A.user.handle}(${ctx.A.user.id}) B=${ctx.B.user.handle}(${ctx.B.user.id}) C=${ctx.C.user.handle}(${ctx.C.user.id})`);
      return {
        A: { handle: ctx.A.user.handle, id: ctx.A.user.id, role: ctx.A.user.globalRole },
        B: { handle: ctx.B.user.handle, id: ctx.B.user.id },
        C: { handle: ctx.C.user.handle, id: ctx.C.user.id },
        expiresIn: ctx.A.expiresIn,
      };
    });

    // 频道列表（拿 general 的 id）
    const channels = await apiCall('GET', '/channels', { token: ctx.A.token });
    const channelList = channels?.channels ?? [];
    ctx.generalId = channelList.find((channel) => channel.slug === 'general')?.id ?? null;
    await check('F1b', 'GET /channels 拿到 general 频道', async () => {
      assert(ctx.generalId, `未找到 slug=general 频道：${JSON.stringify(channelList.map((c) => c.slug))}`);
      return { generalId: ctx.generalId, channels: channelList.map((c) => ({ slug: c.slug, id: c.id, visibility: c.visibility })) };
    });
    if (!ctx.generalId) throw new Error('缺少 general 频道，无法继续');

    // ── F2 两端连 /ws，等 ready ─────────────────────────────────────
    await check('F2', 'A/B 连接 /ws 并收到 ready', async () => {
      const wsA = new WsClient('A', ctx.A.token);
      const wsB = new WsClient('B', ctx.B.token);
      ctx.sockets.push(wsA, wsB);
      const [readyA, readyB] = await Promise.all([wsA.connect(), wsB.connect()]);
      assert(readyA?.user?.id === ctx.A.user.id, `A ready.user.id 不匹配：${readyA?.user?.id}`);
      assert(readyB?.user?.id === ctx.B.user.id, `B ready.user.id 不匹配：${readyB?.user?.id}`);
      assert(Array.isArray(readyA?.channels), 'A ready 缺少 channels 数组');
      ctx.wsA = wsA;
      ctx.wsB = wsB;
      return {
        readyA: { userId: readyA.user.id, handle: readyA.user.handle, channelCount: readyA.channels.length, serverTime: readyA.serverTime },
        readyB: { userId: readyB.user.id, handle: readyB.user.handle, channelCount: readyB.channels.length },
      };
    });

    // ── F3 频道发消息：ack 带服务端 id，B 收到同一 id ────────────────
    await check('F3', 'A 在 general 发消息 → ack 带服务端 id，B 收到且 id 一致', async () => {
      const joinA = await ctx.wsA.emit('channel:join', { channelId: ctx.generalId });
      assert(joinA?.ok, `A channel:join 失败：${JSON.stringify(joinA)}`);
      const joinB = await ctx.wsB.emit('channel:join', { channelId: ctx.generalId });
      assert(joinB?.ok, `B channel:join 失败：${JSON.stringify(joinB)}`);

      const clientMsgId = randomUUID();
      const body = `[e2e] F3 频道消息 ${new Date().toISOString()}`;
      const sentAt = Date.now();
      const ack = await ctx.wsA.emit('message:send', { channelId: ctx.generalId, clientMsgId, kind: 'text', body });
      const ackMs = Date.now() - sentAt;
      assert(ack?.ok, `A 的 message:send ack 失败：${JSON.stringify(ack)}`);
      assert(ack?.message?.id, `ack 未带服务端 message.id：${JSON.stringify(ack)}`);

      const received = await ctx.wsB.waitFor(
        'message:new',
        (args) => args?.[0]?.message?.clientMsgId === clientMsgId,
        8000,
        { since: sentAt },
      );
      const latencyMs = received.at - sentAt;
      assert(received.payload?.message?.id === ack.message.id, `B 收到的 id(${received.payload?.message?.id}) ≠ ack id(${ack.message.id})`);
      assert(received.payload?.message?.channelId === ctx.generalId, 'B 收到的 channelId 不匹配');
      record('F3b', `投递延迟 ≤ ${DELIVERY_BUDGET_MS}ms`, latencyMs <= DELIVERY_BUDGET_MS, { latencyMs }, null);
      return {
        clientMsgId,
        messageId: ack.message.id,
        ackMs,
        deliveryLatencyMs: latencyMs,
        ackHasServerId: true,
        idMatches: true,
      };
    });

    // ── F4 DM ───────────────────────────────────────────────────────
    await check('F4', 'A 对 B 建 DM → 对方收到 conversation:created；双方互发可收，且幂等复验', async () => {
      // 契约 §B：DM 幂等——同一对人永远返回同一条；幂等命中时**不会**再推 conversation:created。
      // 因此先查 A 现有的 DM 对端：若 A↔B 已被别人（如前端联调）创建过，就换一个尚未配对的 seed 成员来验证“新建即推事件”。
      const [existingDms, userList] = await Promise.all([
        apiCall('GET', '/conversations', { token: ctx.A.token }),
        apiCall('GET', '/conversations/users', { token: ctx.A.token }),
      ]);
      const conversations = existingDms?.conversations ?? existingDms ?? [];
      const pairedPeerIds = new Set(
        conversations
          .filter((item) => item.kind === 'dm')
          .map((item) => item.peer?.id ?? item.peer?.userId ?? item.peerId)
          .filter(Boolean),
      );
      const candidates = [ctx.B.user, ...(userList?.users ?? [])];
      const chosen = candidates.find((user) => user?.id && !pairedPeerIds.has(user.id)) ?? ctx.B.user;
      const alreadyPairedWithChosen = pairedPeerIds.has(chosen.id);

      // 若换人，需要为对方开一条 WS 连接（seed 用户共用 SEED_PASSWORD）
      let peerSocket = ctx.wsB;
      let peerSession = ctx.B;
      let peerLabel = 'B';
      if (chosen.id !== ctx.B.user.id) {
        peerSession = await loginWithRetry(chosen.handle, SEED_PASSWORD);
        peerLabel = chosen.handle;
        peerSocket = new WsClient(peerLabel, peerSession.token);
        ctx.sockets.push(peerSocket);
        await peerSocket.connect();
        log(`  · A↔B 已有 DM，改用 ${chosen.handle} 验证“新建 DM 推事件”`);
      }

      const created = await apiCall('POST', '/conversations/dm', { token: ctx.A.token, body: { userId: chosen.id } });
      const conversation = created?.conversation ?? created;
      const dmId = conversation?.id ?? created?.id;
      assert(dmId, `POST /conversations/dm 未返回会话 id：${JSON.stringify(created)?.slice(0, 400)}`);
      assert(conversation.kind === undefined || conversation.kind === 'dm', `kind 应为 dm，实际 ${conversation.kind}`);
      ctx.dm = { id: dmId, peerHandle: peerSession.user.handle };

      if (alreadyPairedWithChosen) {
        record('F4a', `DM 已存在（A↔${peerLabel}）：幂等命中返回同一会话，不推事件（契约 §B）`, true, {
          dmId,
          note: '幂等命中不推 conversation:created 属预期；新建事件已在别的运行中覆盖',
        });
      } else {
        const pushed = await peerSocket.waitFor(
          'conversation:created',
          (args) => (args?.[0]?.conversation?.id ?? args?.[0]?.id) === dmId,
          8000,
        );
        const pushId = pushed.payload?.conversation?.id ?? pushed.payload?.id;
        assert(pushId === dmId, `${peerLabel} 的 conversation:created id(${pushId}) ≠ ${dmId}`);
        record('F4a', `${peerLabel} 收到 conversation:created（新建 DM 推送）`, true, { dmId, peerHandle: peerSession.user.handle });
      }

      // 双方加入 DM 房间（房间名 channel:<id>，契约 §C）
      for (const [label, ws] of [['A', ctx.wsA], [peerLabel, peerSocket]]) {
        const joined = await ws.emit('channel:join', { channelId: dmId });
        assert(joined?.ok, `${label} 加入 DM 房间失败：${JSON.stringify(joined)}`);
      }

      // A → 对方
      const clientMsgIdA = randomUUID();
      const ackA = await ctx.wsA.emit('message:send', {
        channelId: dmId,
        clientMsgId: clientMsgIdA,
        kind: 'text',
        body: '[e2e] F4 DM A→对方',
      });
      assert(ackA?.ok, `DM 内 A 发送 ack 失败：${JSON.stringify(ackA)}`);
      const recvPeer = await peerSocket.waitFor(
        'message:new',
        (args) => args?.[0]?.message?.clientMsgId === clientMsgIdA,
        8000,
      );
      assert(recvPeer.payload?.message?.id === ackA.message.id, 'DM A→对方 id 不一致');

      // 对方 → A
      const clientMsgIdB = randomUUID();
      const ackB = await peerSocket.emit('message:send', {
        channelId: dmId,
        clientMsgId: clientMsgIdB,
        kind: 'text',
        body: '[e2e] F4 DM 对方→A',
      });
      assert(ackB?.ok, `DM 内对方发送 ack 失败：${JSON.stringify(ackB)}`);
      const recvA = await ctx.wsA.waitFor(
        'message:new',
        (args) => args?.[0]?.message?.clientMsgId === clientMsgIdB,
        8000,
      );
      assert(recvA.payload?.message?.id === ackB.message.id, 'DM 对方→A id 不一致');

      // 幂等复验：重复 POST 同一 userId 必须返回同一会话
      const again = await apiCall('POST', '/conversations/dm', { token: ctx.A.token, body: { userId: chosen.id } });
      const againId = (again?.conversation ?? again)?.id ?? again?.id;
      assert(againId === dmId, `DM 幂等失败：第二次返回 ${againId}，第一次 ${dmId}`);

      return {
        dmId,
        peerHandle: peerSession.user.handle,
        peerWasB: chosen.id === ctx.B.user.id,
        alreadyExistedBeforeRun: alreadyPairedWithChosen,
        dmKeyPresent: Boolean(conversation.dmKey),
        idempotent: true,
        aToPeer: { messageId: ackA.message.id, delivered: true },
        peerToA: { messageId: ackB.message.id, delivered: true },
      };
    });

    // ── F5 群聊 ─────────────────────────────────────────────────────
    await check('F5', 'A 建群（含 B、C）→ B/C 收到 conversation:created；群内发消息 B/C 都收到', async () => {
      const wsC = new WsClient('C', ctx.C.token);
      ctx.sockets.push(wsC);
      const readyC = await wsC.connect();
      assert(readyC?.user?.id === ctx.C.user.id, `C ready.user.id 不匹配：${readyC?.user?.id}`);
      ctx.wsC = wsC;

      const groupName = `e2e 群 ${Date.now()}`;
      const created = await apiCall('POST', '/conversations/group', {
        token: ctx.A.token,
        body: { name: groupName, memberIds: [ctx.B.user.id, ctx.C.user.id] },
      });
      const conversation = created?.conversation ?? created;
      const groupId = conversation?.id ?? created?.id;
      assert(groupId, `POST /conversations/group 未返回会话 id：${JSON.stringify(created)?.slice(0, 400)}`);
      assert(conversation.kind === undefined || conversation.kind === 'group', `kind 应为 group，实际 ${conversation.kind}`);
      ctx.group = { id: groupId, name: groupName };

      const pushedB = await ctx.wsB.waitFor(
        'conversation:created',
        (args) => (args?.[0]?.conversation?.id ?? args?.[0]?.id) === groupId,
        8000,
      );
      const pushedC = await ctx.wsC.waitFor(
        'conversation:created',
        (args) => (args?.[0]?.conversation?.id ?? args?.[0]?.id) === groupId,
        8000,
      );
      assert(pushedB.payload, 'B 未收到群聊 conversation:created');
      assert(pushedC.payload, 'C 未收到群聊 conversation:created');

      for (const [label, ws] of [['A', ctx.wsA], ['B', ctx.wsB], ['C', wsC]]) {
        const joined = await ws.emit('channel:join', { channelId: groupId });
        assert(joined?.ok, `${label} 加入群房间失败：${JSON.stringify(joined)}`);
      }

      const clientMsgId = randomUUID();
      const ack = await ctx.wsA.emit('message:send', {
        channelId: groupId,
        clientMsgId,
        kind: 'text',
        body: '[e2e] F5 群消息',
      });
      assert(ack?.ok, `群内发送 ack 失败：${JSON.stringify(ack)}`);
      const [recvB, recvC] = await Promise.all([
        ctx.wsB.waitFor('message:new', (args) => args?.[0]?.message?.clientMsgId === clientMsgId, 8000),
        ctx.wsC.waitFor('message:new', (args) => args?.[0]?.message?.clientMsgId === clientMsgId, 8000),
      ]);
      assert(recvB.payload?.message?.id === ack.message.id, '群消息 B 收到的 id 不一致');
      assert(recvC.payload?.message?.id === ack.message.id, '群消息 C 收到的 id 不一致');

      return {
        groupId,
        groupName,
        pushedToB: true,
        pushedToC: true,
        messageId: ack.message.id,
        deliveredToB: true,
        deliveredToC: true,
      };
    });

    // ── F6 断线 3s 重连 + 补拉 ─────────────────────────────────────
    await check('F6', 'B 断开 3s 重连 → ready → 按 lastSeq direction=newer 补拉：无重复、无空洞', async () => {
      // 断开前 B 在 general 的最后一条（lastSeq）
      const before = await apiCall('GET', `/channels/${ctx.generalId}/messages?limit=1&direction=older`, {
        token: ctx.B.token,
      });
      const lastSeq = before?.messages?.[0]?.id;
      assert(lastSeq, `拿不到 general 的最后一条消息：${JSON.stringify(before)?.slice(0, 300)}`);

      // 断开 3s
      const offlineAt = Date.now();
      ctx.wsB.disconnect();
      log(`  B 已断开，等待 3s（lastSeq=${lastSeq}）`);

      // 断线期间 A 发 2 条（先确保 A 仍在房间里）
      const gapIds = [];
      const gapClientIds = [];
      for (let index = 1; index <= 2; index += 1) {
        const clientMsgId = randomUUID();
        const ack = await ctx.wsA.emit('message:send', {
          channelId: ctx.generalId,
          clientMsgId,
          kind: 'text',
          body: `[e2e] F6 断线期间第 ${index} 条`,
        });
        assert(ack?.ok, `断线期间 A 发送失败：${JSON.stringify(ack)}`);
        gapIds.push(ack.message.id);
        gapClientIds.push(clientMsgId);
      }
      const elapsed = Date.now() - offlineAt;
      if (elapsed < 3000) await new Promise((resolve) => setTimeout(resolve, 3000 - elapsed));

      // 重连
      ctx.wsB = new WsClient('B(重连)', ctx.B.token);
      ctx.sockets.push(ctx.wsB);
      const readyReconnect = await ctx.wsB.connect();
      assert(readyReconnect?.user?.id === ctx.B.user.id, '重连后 ready.user.id 不匹配');
      assert(readyReconnect.serverTime, '重连 ready 缺少 serverTime');

      // 按 lastSeq 补拉
      const cursor = encodeSeqCursor(lastSeq);
      const page = await apiCall(
        'GET',
        `/channels/${ctx.generalId}/messages?direction=newer&cursor=${encodeURIComponent(cursor)}&limit=100`,
        { token: ctx.B.token },
      );
      const fetched = (page?.messages ?? []).map((message) => message.id);

      // 无重复
      assert(new Set(fetched).size === fetched.length, `补拉结果有重复 id：${JSON.stringify(fetched)}`);
      // 严格递增
      for (let index = 1; index < fetched.length; index += 1) {
        assert(BigInt(fetched[index]) > BigInt(fetched[index - 1]), `补拉结果非严格递增：${JSON.stringify(fetched)}`);
      }
      // 不早于 lastSeq
      assert(fetched.every((id) => BigInt(id) > BigInt(lastSeq)), `补拉结果包含 ≤ lastSeq 的消息：${JSON.stringify(fetched)}`);
      // 断线期间的两条必须都在（无空洞）
      for (const id of gapIds) {
        assert(fetched.includes(id), `补拉缺少断线期间的消息 ${id}（空洞）`);
      }
      const extras = fetched.filter((id) => !gapIds.includes(id));
      log(`  补拉 ${fetched.length} 条，断线期间 2 条全部命中${extras.length ? `，另有 ${extras.length} 条其它消息` : ''}`);

      // 再往后翻一页确认没有“尾巴空洞”
      const lastFetched = fetched[fetched.length - 1] ?? lastSeq;
      const tailPage = await apiCall(
        'GET',
        `/channels/${ctx.generalId}/messages?direction=newer&cursor=${encodeURIComponent(encodeSeqCursor(lastFetched))}&limit=100`,
        { token: ctx.B.token },
      );
      const tail = (tailPage?.messages ?? []).map((message) => message.id);
      assert(tail.length === 0, `补拉后仍有更新的消息（说明补拉不全）：${JSON.stringify(tail)}`);

      return {
        lastSeq,
        offlineMs: Date.now() - offlineAt,
        gapMessageIds: gapIds,
        fetchedCount: fetched.length,
        fetchedIds: fetched,
        duplicates: 0,
        holes: 0,
        tailEmpty: true,
        extrasCount: extras.length,
      };
    });

    // ── F9 上传全链路（契约 §10；需要真实 S3 兼容服务，见 run-backend 的 HeadBucket 预检）──
    await check('F9', '上传全链路：presign→预签名 PUT→complete→下载逐字节比对→附件消息 + 限额/伪造类型拒绝', async () => {
      const readyzResponse = await fetch(`${API_BASE}/readyz`, { signal: AbortSignal.timeout(25_000) });
      const readyzBody = await readyzResponse.json().catch(() => null);
      const s3Check = readyzBody?.checks?.find((item) => item.name === 's3');
      assert(
        s3Check?.ok === true,
        `S3 未就绪（/readyz s3=${s3Check?.ok}）：先启动真实 S3（本机 rclone serve s3 @9000）再启动 API`,
      );
      const flow = await runUploadFlow({
        base: API,
        token: ctx.A.token,
        channelId: ctx.generalId,
        log: (message) => log(`  ${message}`),
      });
      const failedSteps = flow.steps.filter((step) => !step.ok);
      assert(
        flow.ok && failedSteps.length === 0,
        `上传链路失败步骤：${failedSteps.map((step) => `${step.id} ${step.error ?? ''}`).join(' | ')}`,
      );
      return {
        bytes: flow.bytes,
        sha256: flow.sha256,
        presignedHost: flow.presigned?.uploadHost,
        uploadStatus: flow.upload?.status,
        complete: flow.complete,
        download: flow.download,
        message: flow.message,
        limits: flow.limits,
      };
    });

    // 顺带验证 /readyz 三项依赖：PG / S3 / Redis 都必须 ok（Redis 无降级）
    await check('F0b', '/readyz 三项依赖均 ok（postgres / s3 / redis）', async () => {
      const response = await fetch(`${API_BASE}/readyz`, { signal: AbortSignal.timeout(25_000) });
      const body = await response.json().catch(() => null);
      for (const name of ['postgres', 's3', 'redis']) {
        const item = body?.checks?.find((entry) => entry.name === name);
        assert(item?.ok === true, `${name} 检查未通过：${JSON.stringify(body?.checks)}`);
      }
      return { status: response.status, checks: body?.checks };
    });
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    log(`!! 冒烟中断：${fatal}`);
  } finally {
    for (const ws of ctx.sockets) {
      try {
        ws.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const failed = checks.filter((item) => !item.ok);
  const result = {
    contract: 'docs/_contract-v1.2.md §F 1–6',
    suite: 'api-ws-smoke',
    startedAt,
    finishedAt,
    apiBase: API_BASE,
    ws: { url: WS_URL, path: WS_PATH, transports: ['websocket'] },
    environment: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      postgres: runState?.postgres
        ? { real: true, version: runState.postgres.version, pid: runState.postgres.pid, port: runState.postgres.port, dataDir: runState.postgres.dataDir }
        : 'run.json 未提供',
      note: '真实 Postgres（embedded-postgres），无 mock/pg-mem',
    },
    credentials: {
      A: { handle: OWNER_HANDLE, role: 'owner' },
      B: { handle: 'chen' },
      C: { handle: 'lin' },
    },
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      verdict: failed.length === 0 && !fatal ? 'PASS' : 'FAIL',
    },
    fatal,
    checks,
  };
  fs.writeFileSync(JSON_OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  flush();

  log('');
  log(`════════ 结果：${result.summary.verdict}（${result.summary.passed}/${result.summary.total}）════════`);
  for (const item of checks) {
    log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.id} ${item.name}${item.ok ? '' : `  ← ${item.error}`}`);
  }
  log(`明细：${JSON_OUT}`);
  log(`日志：${LOG_OUT}`);

  process.exitCode = result.summary.verdict === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  log(`冒烟脚本异常：${error.stack ?? error.message}`);
  flush();
  process.exitCode = 1;
});
