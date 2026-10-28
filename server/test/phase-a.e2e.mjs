#!/usr/bin/env node
/**
 * Phase A 验证（真实 API + 真实 PG，不 mock）：
 *   1. 内部登录 / 内部 API 正常；
 *   2. 内部 → 环带 handoff，兑换后拿到 belt 会话；
 *   3. belt 会话打内部 API 必须 403 SURFACE_MISMATCH；
 *   4. 内部账号从环带登入帝江号：check → internal handoff → 内部 API 200；
 *   5. 外网注册账号 is_internal=false；内部登录 403 PROTOCOL_DENIED；
 *   6. 外网 tag 被移除后，旧内部 token 立即被 INTERNAL_ONLY 拦截；
 *   7. 验证 DB 触发器：改 tags 会同步 is_internal。
 *
 * 用法：cd server && node test/phase-a.e2e.mjs
 * 会创建并清理 probe_* 测试账号。
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const UA = 'phase-a-probe/1.0';
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const externalHandle = `probe_b_${suffix}`;
const internalHandle = `probe_i_${suffix}`;
const password = 'Probe#2026';
const results = [];

function check(condition, label, detail = '') {
  if (!condition) throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  results.push(label);
  console.log(`✓ ${label}`);
}

async function call(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'user-agent': UA,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

function dataOf(response) {
  return response.json?.data;
}

function codeOf(response) {
  return response.json?.error?.code ?? response.json?.code;
}

async function cleanup() {
  await prisma.user.deleteMany({
    where: { handle: { in: [externalHandle, internalHandle] } },
  });
}

async function main() {
  await cleanup();

  // 1. 内部账号登录
  const internalLogin = await call('/auth/login', {
    method: 'POST',
    body: { handle: 'chen', password: 'Dijiang#2026' },
  });
  check(internalLogin.status === 200, '内部账号 chen 登录成功');
  const internalToken = dataOf(internalLogin).accessToken;
  check(dataOf(internalLogin).user.isInternal === true, '内部登录返回 isInternal=true');

  const channels = await call('/channels', { token: internalToken });
  check(channels.status === 200, '内部 token 调 /channels 返回 200');

  // 2. 内部 → 环带 handoff
  const issue = await call('/access/belt/handoff', {
    method: 'POST',
    token: internalToken,
    body: { next: '/belt/channel' },
  });
  check(issue.status === 201, '内部签发环带交接码 201');
  const beltCode = dataOf(issue).code;
  check(typeof beltCode === 'string' && beltCode.length >= 20, '交接码已返回');

  const exchange = await call('/belt/auth/handoff/exchange', {
    method: 'POST',
    body: { code: beltCode },
  });
  check(exchange.status === 200, '环带兑换交接码 200');
  const beltToken = dataOf(exchange).accessToken;
  check(dataOf(exchange).user.isInternal === true, '兑换后用户仍是内部账号');

  const beltToInternalApi = await call('/channels', { token: beltToken });
  check(
    beltToInternalApi.status === 403 && codeOf(beltToInternalApi) === 'SURFACE_MISMATCH',
    'belt token 调内部 /channels 被 403 SURFACE_MISMATCH',
    `${beltToInternalApi.status}/${codeOf(beltToInternalApi)}`,
  );

  // 3. 内部账号从环带进入帝江号
  const accessCheck = await call('/belt/access/internal/check', {
    method: 'POST',
    token: beltToken,
    body: { next: '/' },
  });
  check(accessCheck.status === 200, '内部账号 belt 会话通过登入门禁');
  const internalCode = dataOf(accessCheck).code;
  const internalExchange = await call('/auth/handoff/exchange', {
    method: 'POST',
    body: { code: internalCode },
  });
  check(internalExchange.status === 200, '内部侧兑换交接码 200');
  const internalToken2 = dataOf(internalExchange).accessToken;
  const channels2 = await call('/channels', { token: internalToken2 });
  check(channels2.status === 200, '交接得到的内部 token 调 /channels 200');

  // 4. 外网账号注册
  const externalRegister = await call('/belt/auth/register', {
    method: 'POST',
    body: {
      handle: externalHandle,
      displayName: `外环测试员${suffix.slice(-3)}`,
      password,
      deviceName: 'phase-a-probe',
    },
  });
  check(externalRegister.status === 201, '外网账号注册 201');
  check(dataOf(externalRegister).user.isInternal === false, '外网账号 isInternal=false');
  check(dataOf(externalRegister).user.accountOrigin === 'belt', '外网账号 accountOrigin=belt');
  const externalBeltToken = dataOf(externalRegister).accessToken;

  const externalInternalLogin = await call('/auth/login', {
    method: 'POST',
    body: { handle: externalHandle, password },
  });
  check(
    externalInternalLogin.status === 403 && codeOf(externalInternalLogin) === 'PROTOCOL_DENIED',
    '外网账号尝试内部登录 403 PROTOCOL_DENIED',
    `${externalInternalLogin.status}/${codeOf(externalInternalLogin)}`,
  );

  const externalBeltLogin = await call('/belt/auth/login', {
    method: 'POST',
    body: { handle: externalHandle, password },
  });
  check(externalBeltLogin.status === 200, '外网账号 ring 登录 200');
  check(dataOf(externalBeltLogin).user.isInternal === false, '环带登录仍 isInternal=false');

  const externalToInternalApi = await call('/channels', { token: externalBeltToken });
  check(
    externalToInternalApi.status === 403 &&
      ['SURFACE_MISMATCH', 'INTERNAL_ONLY'].includes(codeOf(externalToInternalApi)),
    '外网 belt token 调内部 /channels 被 403',
    `${externalToInternalApi.status}/${codeOf(externalToInternalApi)}`,
  );

  const externalAccessCheck = await call('/belt/access/internal/check', {
    method: 'POST',
    token: externalBeltToken,
    body: { next: '/' },
  });
  check(
    externalAccessCheck.status === 403 && codeOf(externalAccessCheck) === 'PROTOCOL_DENIED',
    '外网账号登入帝江号 403 PROTOCOL_DENIED',
    `${externalAccessCheck.status}/${codeOf(externalAccessCheck)}`,
  );

  // 5. DB 触发器：临时内部账号先有标签，移除后 is_internal 立即变 false，旧 token 被拦
  const passwordHash = await argon2.hash(password);
  const tempInternal = await prisma.user.create({
    data: {
      handle: internalHandle,
      displayName: `临时内部${suffix.slice(-3)}`,
      passwordHash,
      globalRole: 'member',
      tags: ['[站长]'],
      accountOrigin: 'internal',
    },
  });
  const tempAfterCreate = await prisma.user.findUnique({
    where: { id: tempInternal.id },
    select: { isInternal: true, tags: true },
  });
  check(tempAfterCreate?.isInternal === true, 'DB 触发器：内部标签写入后 is_internal=true');

  const tempLogin = await call('/auth/login', {
    method: 'POST',
    body: { handle: internalHandle, password },
  });
  check(tempLogin.status === 200, '临时内部账号登录 200');
  const tempToken = dataOf(tempLogin).accessToken;

  await prisma.user.update({
    where: { id: tempInternal.id },
    data: { tags: [] },
  });
  const tempAfterRevoke = await prisma.user.findUnique({
    where: { id: tempInternal.id },
    select: { isInternal: true, tags: true },
  });
  check(tempAfterRevoke?.isInternal === false, 'DB 触发器：移除标签后 is_internal=false');

  const revokedTokenCall = await call('/channels', { token: tempToken });
  check(
    revokedTokenCall.status === 403 && codeOf(revokedTokenCall) === 'INTERNAL_ONLY',
    '标签撤销后旧内部 token 立即 403 INTERNAL_ONLY',
    `${revokedTokenCall.status}/${codeOf(revokedTokenCall)}`,
  );

  // 6. 交接码单次消费
  const replayIssue = await call('/access/belt/handoff', {
    method: 'POST',
    token: internalToken,
    body: {},
  });
  const replayCode = dataOf(replayIssue).code;
  const first = await call('/belt/auth/handoff/exchange', {
    method: 'POST',
    body: { code: replayCode },
  });
  const second = await call('/belt/auth/handoff/exchange', {
    method: 'POST',
    body: { code: replayCode },
  });
  check(first.status === 200, '交接码第一次兑换 200');
  check(second.status === 401 && codeOf(second) === 'HANDOFF_INVALID', '交接码第二次兑换 401');

  console.log('\nPHASE_A_RESULT=' + JSON.stringify({ ok: true, checks: results.length }));
}

main()
  .catch((error) => {
    console.error(`\nPHASE_A_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
