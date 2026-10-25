#!/usr/bin/env node
/**
 * Sprint1 真实链路验证（task-19）：
 * 群主发消息 → 群主解散 → 成员 WS 收到 conversation:removed → DB 中 archived_at 已置、消息/成员保留。
 *
 * 前置：API 已用真实 Redis/S3 启动（node ops/e2e/run-backend.mjs --skip-build --skip-seed）。
 * 输出：reports/infra/sprint1-verify.json
 * 用法：node ops/e2e/verify-sprint1.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'reports', 'infra');
const OUT = path.join(OUT_DIR, 'sprint1-verify.json');
const BASE = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Dijiang#2026';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/dijiang?connection_limit=20&pool_timeout=10&connect_timeout=5';

const require = createRequire(import.meta.url);
const { PrismaClient } = require(path.join(ROOT, 'server', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL, log: ['error'] });

async function login(handle) {
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: PASSWORD }),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(`login ${handle} failed: ${JSON.stringify(payload)}`);
  return payload.data;
}

async function api(token, method, url, body) {
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function wsReady(token) {
  return new Promise((resolve, reject) => {
    const socket = io(`${BASE}/ws`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 8000,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('WS ready 超时'));
    }, 10_000);
    socket.on('ready', (payload) => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const evidence = { checkedAt: new Date().toISOString(), base: BASE, steps: [] };
  const step = (name, ok, detail = {}) => {
    evidence.steps.push({ name, ok, ...detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(detail)}`}`);
  };

  const founder = await login('founder');
  const chen = await login('chen');
  step('双账号登录', true, { founder: founder.user.handle, chen: chen.user.handle });

  const created = await api(founder.accessToken, 'POST', '/api/v1/conversations/group', {
    name: `Sprint1 归档验证 ${new Date().toISOString().slice(11, 19)}`,
    memberIds: [chen.user.id],
  });
  if (created.status !== 201) throw new Error(`创建群聊失败：${JSON.stringify(created)}`);
  const conversationId = created.payload.data.conversation.id;
  step('创建群聊', true, { conversationId });

  const chenSocket = await wsReady(chen.accessToken);
  step('成员 WS 已连接并收到 ready', true);

  const removed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 conversation:removed 超时')), 10_000);
    chenSocket.on('conversation:removed', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

  const sent = await api(founder.accessToken, 'POST', `/api/v1/channels/${conversationId}/messages`, {
    body: '解散前最后一条消息（用于证明消息保留）',
    clientMsgId: randomUUID(),
  });
  step('解散前发消息成功', sent.status === 201 || sent.status === 200, {
    status: sent.status,
    body: sent.payload?.data?.id ?? null,
  });

  const dissolved = await api(founder.accessToken, 'DELETE', `/api/v1/conversations/${conversationId}`);
  step('群主解散返回 archived', dissolved.status === 200 && dissolved.payload?.data?.archived === true, {
    status: dissolved.status,
    data: dissolved.payload?.data ?? null,
  });

  const removedPayload = await removed;
  step('成员收到 conversation:removed', removedPayload?.conversationId === conversationId, {
    payload: removedPayload,
    reason: removedPayload?.reason,
  });
  chenSocket.close();

  const [channel, messageCount, memberCount, listAfter] = await Promise.all([
    prisma.channel.findUnique({ where: { id: conversationId }, select: { archivedAt: true, kind: true } }),
    prisma.message.count({ where: { channelId: conversationId } }),
    prisma.channelMember.count({ where: { channelId: conversationId } }),
    api(founder.accessToken, 'GET', '/api/v1/conversations'),
  ]);
  step('DB archived_at 已置', channel?.archivedAt instanceof Date, {
    archivedAt: channel?.archivedAt?.toISOString() ?? null,
  });
  step('消息/成员保留（软归档未物理删）', messageCount >= 1 && memberCount === 2, {
    messages: messageCount,
    members: memberCount,
  });
  const visible = (listAfter.payload?.data?.conversations ?? []).some((item) => item.id === conversationId);
  step('归档后列表不可见', !visible, { listCount: listAfter.payload?.data?.conversations?.length ?? 0 });

  const detailAfter = await api(founder.accessToken, 'GET', `/api/v1/conversations/${conversationId}`);
  step('归档后详情 404', detailAfter.status === 404, {
    status: detailAfter.status,
    code: detailAfter.payload?.error?.code,
  });

  evidence.verdict = evidence.steps.every((item) => item.ok) ? 'PASS' : 'FAIL';
  fs.writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await prisma.$disconnect();
  console.log(`\nverdict=${evidence.verdict}  证据：${OUT}`);
  process.exitCode = evidence.verdict === 'PASS' ? 0 : 1;
}

main().catch(async (error) => {
  console.error('!! 验证失败：', error);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ checkedAt: new Date().toISOString(), verdict: 'FAIL', error: String(error?.stack ?? error) }, null, 2)}\n`,
    'utf8',
  );
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
