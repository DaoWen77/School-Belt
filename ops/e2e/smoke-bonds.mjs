#!/usr/bin/env node
/**
 * 模块三 bond/火花 冒烟：邀请 → 同意 → 延续幂等 → 懒结算（+5/-10/-20 归零）→ 解除
 * 真实 API + 真实 PG；结算用 DB 回拨日期模拟"几天没人续"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const API = 'http://127.0.0.1:3000/api/v1';
const PASSWORD = 'Dijiang#2026';
const OUT = path.join(ROOT, 'reports', 'e2e');
const require = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:55432/dijiang?schema=public' } },
});

const checks = [];
const check = (id, ok, detail = {}) => {
  checks.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${JSON.stringify(detail).slice(0, 240)}`);
};

const dayInShanghai = (offset = 0) => {
  const base = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(base);
};
const toDate = (iso) => new Date(`${iso}T00:00:00.000Z`);

const tokens = new Map();
async function login(handle, attempt = 0) {
  if (tokens.has(handle)) return tokens.get(handle);
  const response = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: PASSWORD }),
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
  const founder = await login('founder');
  const qiu = await login('qiu');
  const creator = await login('creator');

  /* 清理历史 bonds，保证可重复 */
  await prisma.bond.deleteMany({});

  /* 1. 邀请 */
  const invite = await call('POST', '/belt/bonds/invite', founder, { handle: 'qiu', type: 'buddy' });
  const bondId = invite.data?.bond?.id;
  check('B1 发起羁绊', invite.status === 201 && Boolean(bondId), {
    status: invite.status,
    type: invite.data?.bond?.typeLabel,
    statusNow: invite.data?.bond?.status,
    peer: invite.data?.bond?.peer?.handle,
  });

  const dup = await call('POST', '/belt/bonds/invite', founder, { handle: 'qiu', type: 'buddy' });
  check('B2 重复邀请 409', dup.status === 409, { status: dup.status, code: dup.error?.code });

  /* 2. 收件箱 / 同意 */
  const incoming = await call('GET', '/belt/bonds', qiu);
  const incomingCard = (incoming.data?.incoming ?? []).find((item) => item.id === bondId);
  check('B3 对方收到邀请', Boolean(incomingCard), { incoming: (incoming.data?.incoming ?? []).length });

  const accept = await call('POST', `/belt/bonds/${bondId}/accept`, qiu);
  check('B4 同意后为 active 且初始 10', accept.data?.bond?.status === 'active' && accept.data?.bond?.intimacy === 10, {
    status: accept.data?.bond?.status,
    intimacy: accept.data?.bond?.intimacy,
  });

  /* 3. 延续幂等 + 双方完成 */
  const renew1 = await call('POST', `/belt/bonds/${bondId}/renew`, qiu);
  const renew2 = await call('POST', `/belt/bonds/${bondId}/renew`, qiu);
  const renew3 = await call('POST', `/belt/bonds/${bondId}/renew`, founder);
  check(
    'B5 延续幂等 + 双方完成',
    renew1.data?.renewedToday === true &&
      renew2.data?.bond?.intimacy === renew1.data?.bond?.intimacy &&
      renew3.data?.bothRenewed === true,
    {
      first: renew1.data?.bond?.intimacy,
      second: renew2.data?.bond?.intimacy,
      bothRenewed: renew3.data?.bothRenewed,
    },
  );

  /* 4. 懒结算：都没续 → -20 */
  await prisma.bond.update({
    where: { id: bondId },
    data: { lastSettledOn: toDate(dayInShanghai(-2)), lastRenewA: null, lastRenewB: null, intimacy: 30 },
  });
  const settleNone = await call('GET', '/belt/bonds', qiu);
  const noneCard = (settleNone.data?.active ?? []).find((item) => item.id === bondId);
  check('B6 双方都没续 → -20', noneCard?.intimacy === 10, { intimacy: noneCard?.intimacy });

  /* 5. 懒结算：单方续 → -10 */
  const bond2 = await call('POST', '/belt/bonds/invite', creator, { handle: 'qiu', type: 'pal' });
  const bond2Id = bond2.data?.bond?.id;
  await call('POST', `/belt/bonds/${bond2Id}/accept`, qiu);
  const dates = await prisma.bond.findUnique({ where: { id: bond2Id }, select: { userAId: true, inviterId: true } });
  const mySide = dates?.userAId === (await prisma.user.findUnique({ where: { handle: 'qiu' }, select: { id: true } }))?.id ? 'A' : 'B';
  await prisma.bond.update({
    where: { id: bond2Id },
    data: {
      lastSettledOn: toDate(dayInShanghai(-2)),
      lastRenewA: toDate(dayInShanghai(-1)),
      intimacy: 30,
      ...(mySide === 'A' ? {} : { lastRenewB: toDate(dayInShanghai(-1)) }),
    },
  });
  const settleOne = await call('GET', '/belt/bonds', qiu);
  const oneCard = (settleOne.data?.active ?? []).find((item) => item.id === bond2Id);
  check('B7 仅一方续 → -10', oneCard?.intimacy === 20, { intimacy: oneCard?.intimacy });

  /* 6. 归零解除 */
  const bond3 = await call('POST', '/belt/bonds/invite', founder, { handle: 'creator', type: 'partner' });
  const bond3Id = bond3.data?.bond?.id;
  await call('POST', `/belt/bonds/${bond3Id}/accept`, creator);
  await prisma.bond.update({
    where: { id: bond3Id },
    data: { lastSettledOn: toDate(dayInShanghai(-2)), lastRenewA: null, lastRenewB: null, intimacy: 10 },
  });
  const settled = await call('GET', '/belt/bonds', founder);
  const endedCard = (settled.data?.ended ?? []).find((item) => item.id === bond3Id);
  check('B8 归零自动解除', endedCard?.status === 'ended' && /归零/.test(endedCard?.endReason ?? ''), {
    status: endedCard?.status,
    reason: endedCard?.endReason,
    endedCount: (settled.data?.ended ?? []).length,
  });

  /* 7. 主动解除 */
  const remove = await call('DELETE', `/belt/bonds/${bond2Id}`, qiu);
  check('B9 主动解除', remove.data?.bond?.status === 'ended', { status: remove.data?.bond?.status, reason: remove.data?.bond?.endReason });

  /* 8. 未授权：外人不能 accept */
  const outsider = await login('protocol_officer');
  const bond4 = await call('POST', '/belt/bonds/invite', founder, { handle: 'qiu', type: 'mentor' });
  const hack = await call('POST', `/belt/bonds/${bond4.data?.bond?.id}/accept`, outsider);
  check('B10 非被邀请人不能同意', hack.status === 403 || hack.status === 404, { status: hack.status, code: hack.error?.code });
} catch (error) {
  checks.push({ id: 'fatal', ok: false, error: String(error?.stack ?? error) });
  console.error(error);
} finally {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'bonds-smoke.json'), `${JSON.stringify(checks, null, 2)}\n`, 'utf8');
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  await prisma.$disconnect();
  process.exitCode = failed.length ? 1 : 0;
}
