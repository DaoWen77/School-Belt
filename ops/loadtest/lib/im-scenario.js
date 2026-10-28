// O.M.V 工作台 · 全域广播 —— k6 ack 压测场景（共享实现）
//
// 设计口径（task-18 / docs/09 压测方案）：
//   50 VU 持续 2 分钟；每个 VU 建立真实 Socket.IO 连接（namespace /ws），
//   周期性发送 `message:send`，用服务端 ack 计算端到端延迟；输出可直接读的 P95/P99。
//
// 为什么不是"每 VU 每秒 1 条"：
//   契约 §9 对消息发送有**用户级**限流：5 条/秒突发 + 60 条/分钟/用户
//   （server/src/common/redis/rate-limiter.service.ts → assertMessageSend）。
//   因此脚本按"多用户 + 均匀错峰"设计：
//     - setup() 登录多个 seed 账号（登录 5 次/分钟/IP，所以分批 + 61s 间隔）；
//     - VU 按 round-robin 分配到账号，同一账号内再按槽位错峰；
//     - 发送间隔由 VUS / 账号数自动推导，保证单账号速率 ≤ ~51 条/分钟（留 15% 余量），
//       既真实又不会被 RATE_LIMITED 主导。
//   想压满吞吐可调大 CHAT_USERS（账号数）或手动指定 SEND_INTERVAL_MS。
//
// 帧格式：k6 只有原始 WebSocket，这里按 Engine.IO v4 + Socket.IO v4 手工收发：
//   服务器 → 0{"sid":...}             Engine.IO open
//   客户端 → 40/ws,{"token":"..."}    Socket.IO 命名空间 CONNECT（auth 走 payload）
//   服务器 → 40/ws,{"sid":"..."}      命名空间连接成功
//   客户端 → 42/ws,<ackId>["message:send",{channelId,clientMsgId,kind,body}]
//   服务器 → 43/ws,<ackId>[{ok,message,dup}]    ack（持久化成功后才回）
//   心跳：服务器 2 → 客户端 3
import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/* ── 指标 ─────────────────────────────────────────────────────────────── */
const ackLatency = new Trend('ack_latency_ms', true); // ack 端到端（ms）
const ackOk = new Rate('ack_ok'); // ack.ok === true 的比例
const ackFailures = new Rate('ack_failures'); // 网络错误 / 超时 / 非 ok（不含 RATE_LIMITED）
const rateLimitedAcks = new Counter('rate_limited_acks');
const messagesSent = new Counter('messages_sent');
const wsReady = new Counter('ws_ready');
const wsConnectFailed = new Counter('ws_connect_failed');

/* ── 参数 ─────────────────────────────────────────────────────────────── */
const API_BASE = (__ENV.API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const WS_PATH = __ENV.WS_PATH || '/socket.io';
const SEED_PASSWORD = __ENV.SEED_PASSWORD || 'Dijiang#2026';
const DEFAULT_USERS = 'qiu,chen,lin,yue,shen,an_obs,protocol_officer,founder';
const USERS = (__ENV.CHAT_USERS || DEFAULT_USERS)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const CHANNEL_SLUG = __ENV.CHANNEL_SLUG || 'general';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '2m';
const HOLD_MS = Number(__ENV.HOLD_MS || 135_000); // 单次连接保持时长（≈场景时长 + 余量）
const ACK_TIMEOUT_MS = Number(__ENV.ACK_TIMEOUT_MS || 5000);
const LOGIN_BATCH = Number(__ENV.LOGIN_BATCH || 5); // 登录 5 次/分钟/IP
const LOGIN_WAIT_SEC = Number(__ENV.LOGIN_WAIT_SEC || 61);
const ORIGIN = __ENV.ORIGIN || 'http://localhost:3100';

/** 单账号允许的发送速率（条/秒），留余量给 60 条/分钟的用户级限流 */
const PER_USER_RATE = Number(__ENV.PER_USER_RATE || 0.85);

function autoIntervalMs() {
  const perUserVus = Math.max(1, Math.ceil(VUS / Math.max(1, USERS.length)));
  // 单账号内 perUserVus 个 VU 共用 0.85 条/秒 → 每个 VU 的间隔
  const interval = Math.ceil((perUserVus * 1000) / PER_USER_RATE);
  return Math.max(1200, Math.ceil(interval / 100) * 100);
}

const SEND_INTERVAL_MS = Number(__ENV.SEND_INTERVAL_MS || 0) || autoIntervalMs();

function uuid(seed) {
  const hex = seed.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

/* ── options ──────────────────────────────────────────────────────────── */
export const options = {
  // setup 里为登录限流（5 次/分钟/IP）保留 61s 等待，必须放大 setup 超时（k6 默认仅 60s）
  setupTimeout: __ENV.SETUP_TIMEOUT || '600s',
  teardownTimeout: '60s',
  scenarios: {
    chat_ack: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      gracefulStop: '15s',
    },
  },
  thresholds: {
    // docs/09 §1 S2：发送 ack P95 < 150ms、P99 < 300ms；失败率 < 1%
    ack_latency_ms: ['p(95)<150', 'p(99)<300'],
    ack_ok: ['rate>0.99'],
    ack_failures: ['rate<0.01'],
    ws_ready: ['count>0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

/* ── setup：真实登录 + 取频道 ─────────────────────────────────────────── */
/**
 * 登录带 429 重试：/auth/login 限流是 5 次/分钟/IP（契约 §9）。
 * 若上一轮压测刚登录过，这里按服务端 retryAfterMs 等待后重试，避免 setup 直接失败。
 */
function loginWithRetry(handle) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = http.post(
      `${API_BASE}/api/v1/auth/login`,
      JSON.stringify({ handle, password: SEED_PASSWORD, deviceName: 'k6-loadtest' }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
    );
    if (response.status === 200) {
      const body = response.json();
      const data = body.data || body;
      if (!data.accessToken) fail(`[setup] ${handle} 未返回 accessToken`);
      return { handle, token: data.accessToken, userId: data.user && data.user.id };
    }
    if (response.status === 429 && attempt < 3) {
      let waitMs = 61_000;
      try {
        const body = response.json();
        waitMs = Number((body.error && body.error.retryAfterMs) || body.retryAfterMs || waitMs);
      } catch (_) {
        /* 用默认值 */
      }
      const waitSec = Math.min(120, Math.ceil(waitMs / 1000) + 2);
      console.log(`[setup] ${handle} 登录被限流（429），等待 ${waitSec}s 后重试（${attempt + 1}/3）`);
      sleep(waitSec);
      continue;
    }
    fail(`[setup] 登录失败 ${handle} → HTTP ${response.status}：${String(response.body).slice(0, 200)}`);
  }
  fail(`[setup] ${handle} 登录失败`);
  return null;
}

export function setup() {
  const sessions = [];

  // 快速通道：允许外部注入已登录 token（便于反复试跑，不再消耗登录配额）
  if (__ENV.ACCESS_TOKEN) {
    sessions.push({ handle: __ENV.TOKEN_HANDLE || 'env-token', token: __ENV.ACCESS_TOKEN });
    console.log('[setup] 使用外部注入的 ACCESS_TOKEN（跳过登录）');
  } else {
    console.log(`[setup] 登录 ${USERS.length} 个账号（每批 ${LOGIN_BATCH}，登录限流 5 次/分钟/IP）`);
    for (let offset = 0; offset < USERS.length; offset += LOGIN_BATCH) {
      const batch = USERS.slice(offset, offset + LOGIN_BATCH);
      for (const handle of batch) {
        sessions.push(loginWithRetry(handle));
      }
      if (offset + LOGIN_BATCH < USERS.length) {
        console.log(`[setup] 等待 ${LOGIN_WAIT_SEC}s 让登录限流窗口过期…`);
        sleep(LOGIN_WAIT_SEC);
      }
    }
  }

  const first = sessions[0];
  let channel = null;
  if (__ENV.CHANNEL_ID) {
    channel = { id: __ENV.CHANNEL_ID, slug: __ENV.CHANNEL_SLUG || 'env-channel' };
    console.log(`[setup] 使用外部注入的 CHANNEL_ID=${channel.id}`);
  } else {
    const channelsRes = http.get(`${API_BASE}/api/v1/channels`, {
      headers: { Authorization: `Bearer ${first.token}` },
      tags: { name: 'channels' },
    });
    if (channelsRes.status !== 200) {
      fail(`[setup] GET /channels → HTTP ${channelsRes.status}：${String(channelsRes.body).slice(0, 200)}`);
    }
    const channelsBody = channelsRes.json();
    const channels = (channelsBody.data || channelsBody).channels || [];
    channel = channels.find((item) => item.slug === CHANNEL_SLUG) || channels[0];
    if (!channel) fail('[setup] 没有任何可见频道，无法压测');
  }

  console.log(
    `[setup] 就绪：users=${sessions.length} channel=${channel.slug}(${channel.id}) ` +
      `VUS=${VUS} interval=${SEND_INTERVAL_MS}ms（单账号 ~${(1000 / SEND_INTERVAL_MS).toFixed(2)} 条/秒 × ${Math.ceil(VUS / sessions.length)} VU）`,
  );
  return { sessions, channelId: channel.id, channelSlug: channel.slug, apiBase: API_BASE };
}

/* ── 单个 VU：一条 WS 连接，周期发送并统计 ack ────────────────────────── */
export default function (data) {
  const sessions = data.sessions;
  const userIndex = (__VU - 1) % sessions.length;
  const slot = Math.floor((__VU - 1) / sessions.length); // 同账号内的第几个 VU
  const session = sessions[userIndex];
  const wsUrl = `${data.apiBase.replace(/^http/, 'ws')}${WS_PATH}/?EIO=4&transport=websocket`;

  let ackSeq = 0;
  let messageSeq = 0;
  const pending = {}; // ackId → 发送时间
  let connected = false;

  const cleanupPending = () => {
    const now = Date.now();
    for (const key of Object.keys(pending)) {
      if (now - pending[key] > ACK_TIMEOUT_MS) {
        delete pending[key];
        ackFailures.add(1);
      }
    }
  };

  const res = ws.connect(wsUrl, { headers: { Origin: ORIGIN } }, function (socket) {
    socket.on('message', function (raw) {
      // Engine.IO 心跳
      if (raw === '2') {
        socket.send('3');
        return;
      }
      // Engine.IO open → 发 Socket.IO 命名空间 CONNECT（auth.token 走 payload）
      if (raw.charAt(0) === '0') {
        socket.send(`40/ws,${JSON.stringify({ token: session.token })}`);
        return;
      }
      // 命名空间连接成功
      if (raw.indexOf('40/ws') === 0) {
        if (connected) return;
        connected = true;
        wsReady.add(1);
        // 同账号内错峰：第 slot 个 VU 延迟 slot*(interval/perUser) 再开跑
        const perUserVus = Math.max(1, Math.ceil(VUS / sessions.length));
        const startDelay = Math.round((slot / perUserVus) * SEND_INTERVAL_MS) + 200;
        socket.setTimeout(function () {
          socket.setInterval(function () {
            // 注意：k6 的 socket 没有浏览器那种 readyState；用 connected 标记判断
            if (!connected) return;
            cleanupPending();
            messageSeq += 1;
            ackSeq += 1;
            const ackId = ackSeq;
            pending[ackId] = Date.now();
            const clientMsgId = uuid(__VU * 1_000_000 + messageSeq);
            const payload = [
              'message:send',
              {
                channelId: data.channelId,
                clientMsgId,
                kind: 'text',
                body: `[k6] VU${__VU} #${messageSeq}`,
              },
            ];
            socket.send(`42/ws,${ackId}${JSON.stringify(payload)}`);
            messagesSent.add(1);
          }, SEND_INTERVAL_MS);
        }, startDelay);
        return;
      }
      // Socket.IO error（如 RATE_LIMITED / 鉴权失败）
      if (raw.indexOf('44/ws') === 0) {
        ackFailures.add(1);
        return;
      }
      // ack：43/ws,<ackId>[{ ok, message, dup, code }]
      if (raw.indexOf('43/ws,') === 0) {
        const body = raw.slice('43/ws,'.length);
        const match = /^(\d+)(.*)$/.exec(body);
        if (!match) return;
        const ackId = Number(match[1]);
        const startedAt = pending[ackId];
        if (startedAt === undefined) return;
        delete pending[ackId];
        ackLatency.add(Date.now() - startedAt);
        let payload = null;
        try {
          payload = JSON.parse(match[2])[0];
        } catch (_) {
          payload = null;
        }
        const ok = Boolean(payload && payload.ok === true);
        check(payload, {
          'ack.ok=true': () => ok,
          'ack 带服务端 message.id': () => Boolean(payload && payload.message && payload.message.id),
        });
        if (ok) {
          ackOk.add(1);
          // 显式写入 0，保证 ack_failures 指标存在且 rate=0（阈值与 summary 更可读）
          ackFailures.add(0);
        } else {
          const code = payload && payload.code;
          if (code === 'RATE_LIMITED') {
            rateLimitedAcks.add(1);
          } else {
            ackFailures.add(1);
          }
          ackOk.add(0);
        }
        return;
      }
      // 其余 42/ws 广播忽略
    });

    socket.on('error', function () {
      ackFailures.add(1);
    });

    socket.setTimeout(function () {
      socket.close();
    }, HOLD_MS);
  });

  const handshakeOk = check(res, { 'ws 握手 101': (r) => Boolean(r && r.status === 101) });
  if (!handshakeOk) wsConnectFailed.add(1);
}

/* ── summary：把 ack P95/P99 写成可直接读的 JSON ──────────────────────── */
export function handleSummary(data) {
  const metrics = data.metrics || {};
  const values = (name, stat) => (metrics[name] && metrics[name].values ? metrics[name].values[stat] : null);
  const trend = (name) => ({
    count: values(name, 'count'),
    avg: values(name, 'avg'),
    min: values(name, 'min'),
    med: values(name, 'med'),
    p90: values(name, 'p(90)'),
    p95: values(name, 'p(95)'),
    p99: values(name, 'p(99)'),
    max: values(name, 'max'),
  });
  const thresholdResults = {};
  for (const [metric, list] of Object.entries(data.metrics || {})) {
    if (list && list.thresholds) {
      thresholdResults[metric] = list.thresholds;
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    scenario: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      users: USERS.length,
      sendIntervalMs: SEND_INTERVAL_MS,
      perUserRateLimit: '5/s 突发 + 60/min/用户（契约 §9）',
    },
    env: { apiBase: API_BASE, wsPath: WS_PATH, channelSlug: CHANNEL_SLUG, origin: ORIGIN },
    ack_latency_ms: trend('ack_latency_ms'),
    ack_ok_rate: values('ack_ok', 'rate'),
    ack_failures_rate: values('ack_failures', 'rate'),
    rate_limited_acks: values('rate_limited_acks', 'count'),
    messages_sent: values('messages_sent', 'count'),
    ws_ready: values('ws_ready', 'count'),
    ws_connect_failed: values('ws_connect_failed', 'count'),
    http_req_duration_ms: trend('http_req_duration'),
    thresholds: thresholdResults,
    passed: Object.values(thresholdResults).every((items) => Object.values(items).every((item) => item.ok !== false)),
  };
  const outPath = __ENV.SUMMARY_OUT || 'ops/loadtest/out/k6-summary.json';
  return {
    [outPath]: JSON.stringify(summary, null, 2),
    stdout: `\n[k6] ack P95=${summary.ack_latency_ms.p95}ms P99=${summary.ack_latency_ms.p99}ms ` +
      `ok=${summary.ack_ok_rate} failures=${summary.ack_failures_rate} ` +
      `rateLimited=${summary.rate_limited_acks} sent=${summary.messages_sent} wsReady=${summary.ws_ready}\n`,
  };
}
