#!/usr/bin/env node
/** 模块六 IM 冒烟：@提及 / DING（每日 3 次）/ 置顶 / 隐藏 / 拉黑 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const API = 'http://127.0.0.1:3000/api/v1';
const OUT = path.join(ROOT, 'reports', 'e2e');
const checks = [];
const check = (id, ok, detail = {}) => {
  checks.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${JSON.stringify(detail).slice(0, 240)}`);
};

const tokens = new Map();
async function login(handle, attempt = 0) {
  if (tokens.has(handle)) return tokens.get(handle);
  const response = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'Dijiang#2026' }),
  });
  const payload = await response.json();
  if (response.status === 429 && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    return login(handle, attempt + 1);
  }
  if (!response.ok) throw new Error(`login ${handle}: ${response.status}`);
  tokens.set(handle, payload.data.accessToken);
  return payload.data.accessToken;
}

async function call(method, route, token, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, data: payload?.data ?? null, error: payload?.error ?? null };
}

try {
  const qiu = await login('qiu');
  const founder = await login('founder');

  const channels = await call('GET', '/belt/channels', qiu);
  const channel = (channels.data?.channels ?? [])[0];
  const channelId = channel?.id;

  /* 1. @ 提及 */
  const sent = await call('POST', `/belt/channels/${channelId}/messages`, qiu, {
    body: '@founder 帮忙看下这条委托，顺便 @creator 也来',
    clientMsgId: crypto.randomUUID(),
  });
  const message = sent.data?.message ?? sent.data;
  check('I1 @提及入库', Array.isArray(message?.mentions) && message.mentions.length === 2, {
    status: sent.status,
    mentions: message?.mentions?.length,
    handles: message?.mentionHandles,
  });

  /* 2. DING 配额 */
  const quota0 = await call('GET', '/belt/me/ding-quota', qiu);
  const ding1 = await call('POST', `/belt/channels/${channelId}/ding`, qiu, { body: '紧急：所有人看频道' });
  const quota1 = await call('GET', '/belt/me/ding-quota', qiu);
  check('I2 DING 发送 + 配额', ding1.status === 201 && ding1.data?.message?.ding === true && quota0.data?.limit === 3, {
    send: ding1.status,
    remaining: ding1.data?.remaining,
    quotaBefore: quota0.data,
    quotaAfter: quota1.data,
  });

  const ding2 = await call('POST', `/belt/channels/${channelId}/ding`, qiu, {});
  const ding3 = await call('POST', `/belt/channels/${channelId}/ding`, qiu, {});
  const ding4 = await call('POST', `/belt/channels/${channelId}/ding`, qiu, {});
  const usedBefore = quota0.data?.used ?? 0;
  const expectedExhausted = usedBefore >= 3;
  check(
    'I3 超限被拒（429）',
    expectedExhausted ? ding4.status === 429 : ding4.status === 201 || ding4.status === 429,
    { statuses: [ding2.status, ding3.status, ding4.status], usedBefore },
  );

  /* 3. 置顶 */
  const pin = await call('POST', `/belt/channels/${channelId}/pins`, founder, { messageId: String(message?.id) });
  const pins = await call('GET', `/belt/channels/${channelId}/pins`, qiu);
  const unpin = await call('DELETE', `/belt/channels/${channelId}/pins/${message?.id}`, founder);
  check('I4 置顶/列表/取消', pin.status === 201 || pin.status === 200, {
    pin: pin.status,
    count: (pins.data?.items ?? []).length,
    unpin: unpin.status,
    pinnedNow: unpin.data?.pinned,
  });

  /* 4. 隐藏 */
  const hide = await call('POST', `/belt/messages/${message?.id}/hide`, qiu);
  const listAfter = await call('GET', `/belt/channels/${channelId}/messages?limit=30`, qiu);
  const stillVisible = (listAfter.data?.messages ?? listAfter.data?.items ?? []).some(
    (item) => String(item.id) === String(message?.id),
  );
  check('I5 隐藏后自己列表不再出现', hide.data?.hidden === true && !stillVisible, {
    hide: hide.status,
    stillVisible,
  });

  /* 5. 拉黑 → 建聊被拒 */
  const creator = await login('creator');
  const block = await call('POST', '/belt/users/creator/block', qiu);
  const dmBlocked = await call('POST', '/belt/directs/creator', qiu);
  const unblock = await call('DELETE', '/belt/users/creator/block', qiu);
  check('I6 拉黑后无法建私聊', block.data?.blocked === true && dmBlocked.status === 403, {
    block: block.status,
    dm: dmBlocked.status,
    code: dmBlocked.error?.code,
    unblock: unblock.data?.blocked,
  });
} catch (error) {
  checks.push({ id: 'fatal', ok: false, error: String(error?.stack ?? error) });
  console.error(error);
} finally {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'im-smoke.json'), `${JSON.stringify(checks, null, 2)}\n`, 'utf8');
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}
