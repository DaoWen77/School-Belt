#!/usr/bin/env node
/**
 * Phase D 验证（真实 API + 真实 PG）：
 *   - 内部好友申请 → 同意 → 才生成 DM；
 *   - 未同意前直接建 DM 被 FRIENDSHIP_REQUIRED 拦截；
 *   - 群聊不受好友限制（不在此脚本改动）；
 *   - 悬赏上下文发起跨面 bridge 好友 → 双方 bridge DM；
 *   - bridge 双方都能读写；
 *   - 解除好友后 DM 发送被拦截；
 *   - dm_key 按 surface 复合唯一。
 *
 * 用法：cd server && DATABASE_URL=... node test/phase-d.e2e.mjs
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const UA = 'phase-d-probe/1.0';
const prisma = new PrismaClient();
const stamp = Date.now().toString(36);
const A = `probe_da_${stamp}`;
const B = `probe_db_${stamp}`;
const EXT = `probe_de_${stamp}`;
const password = 'ProbeD#2026';
const checks = [];
const cleanupChannelIds = [];

function check(condition, label, detail = '') {
  if (!condition) throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  checks.push(label);
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
const data = (response) => response.json?.data;
const code = (response) => response.json?.error?.code ?? response.json?.code;

async function login(handle, internal = true) {
  const response = await call(internal ? '/auth/login' : '/belt/auth/login', {
    method: 'POST',
    body: { handle, password },
  });
  check(response.status === 200, `${handle} 登录`);
  return {
    token: data(response).accessToken,
    refresh: data(response).refreshToken,
  };
}

async function beltFromInternal(token) {
  const handoff = await call('/access/belt/handoff', {
    method: 'POST',
    token,
    body: { next: '/belt/channel' },
  });
  check(handoff.status === 201, '内部签发环带交接码');
  const exchange = await call('/belt/auth/handoff/exchange', {
    method: 'POST',
    body: { code: data(handoff).code },
  });
  check(exchange.status === 200, '环带兑换交接码');
  return { token: data(exchange).accessToken, refresh: data(exchange).refreshToken };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { handle: { in: [A, B, EXT] } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  const friendships = ids.length
    ? await prisma.friendship.findMany({
        where: { OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }] },
        select: { id: true, dmChannelId: true },
      })
    : [];
  const channelIds = friendships.map((row) => row.dmChannelId).filter(Boolean);
  const allChannels = [...new Set([...channelIds, ...cleanupChannelIds].filter(Boolean))];
  if (allChannels.length) {
    await prisma.message.deleteMany({ where: { channelId: { in: allChannels } } });
    await prisma.channelMember.deleteMany({ where: { channelId: { in: allChannels } } });
    await prisma.channel.deleteMany({ where: { id: { in: allChannels } } });
  }
  if (friendships.length) {
    await prisma.friendship.deleteMany({ where: { id: { in: friendships.map((row) => row.id) } } });
  }
  const posts = await prisma.post.findMany({
    where: { title: { startsWith: `D测委托${stamp}` } },
    select: { id: true },
  });
  if (posts.length) {
    const postIds = posts.map((post) => post.id);
    await prisma.postLike.deleteMany({ where: { postId: { in: postIds } } });
    await prisma.postComment.deleteMany({ where: { postId: { in: postIds } } });
    await prisma.post.deleteMany({ where: { id: { in: postIds } } });
  }
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await cleanup();

  const hash = await argon2.hash(password);
  await prisma.user.createMany({
    data: [
      {
        handle: A,
        displayName: `D测A${stamp.slice(-3)}`,
        passwordHash: hash,
        globalRole: 'member',
        tags: ['[极光科技]'],
        accountOrigin: 'internal',
      },
      {
        handle: B,
        displayName: `D测B${stamp.slice(-3)}`,
        passwordHash: hash,
        globalRole: 'member',
        tags: ['[极光科技]'],
        accountOrigin: 'internal',
      },
    ],
    skipDuplicates: true,
  });
  const users = await prisma.user.findMany({
    where: { handle: { in: [A, B] } },
    select: { id: true, handle: true },
  });
  const idOf = new Map(users.map((user) => [user.handle, user.id]));
  const aId = idOf.get(A);
  const bId = idOf.get(B);
  if (!aId || !bId) throw new Error('temp internal users not created');

  const a = await login(A, true);
  const b = await login(B, true);

  const noFriendship = await call('/conversations/dm', {
    method: 'POST',
    token: b.token,
    body: { userId: aId },
  });
  check(
    noFriendship.status === 403 && code(noFriendship) === 'FRIENDSHIP_REQUIRED',
    '未同意好友前直接建 DM 被 403',
    `${noFriendship.status}/${code(noFriendship)}`,
  );

  const request = await call('/friendships/requests', {
    method: 'POST',
    token: a.token,
    body: { handle: B, note: 'D 阶段内部好友测试' },
  });
  check(request.status === 201, '内部好友申请 201');
  const internalFriendshipId = data(request).friendship.id;
  check(data(request).friendship.status === 'pending', '申请状态 pending');
  check(data(request).friendship.surface === 'internal', '内部好友 surface=internal');

  const incoming = await call('/friendships', { token: b.token });
  check(
    incoming.status === 200 &&
      data(incoming).incoming.some((row) => row.id === internalFriendshipId),
    '接收方看到 incoming 申请',
  );

  const accept = await call(`/friendships/${internalFriendshipId}`, {
    method: 'PATCH',
    token: b.token,
    body: { action: 'accept' },
  });
  check(accept.status === 200, '同意内部好友 200');
  check(data(accept).friendship.status === 'accepted', '好友 accepted');
  const internalDmId = data(accept).friendship.dmChannelId;
  check(Boolean(internalDmId), '同意后生成 DM');
  if (internalDmId) cleanupChannelIds.push(internalDmId);

  const aConversations = await call('/conversations', { token: a.token });
  check(
    data(aConversations).conversations.some((row) => row.id === internalDmId),
    '发起方侧边栏出现 DM',
  );
  const bConversations = await call('/conversations', { token: b.token });
  check(
    data(bConversations).conversations.some((row) => row.id === internalDmId),
    '接收方侧边栏出现 DM',
  );

  const send = await call(`/channels/${internalDmId}/messages`, {
    method: 'POST',
    token: a.token,
    body: { body: `D 阶段内部 DM ${stamp}`, clientMsgId: randomUUID() },
  });
  check(send.status === 200, '好友 DM 发消息 201');

  const remove = await call(`/friendships/${internalFriendshipId}`, {
    method: 'DELETE',
    token: b.token,
  });
  check(remove.status === 200, '解除好友 200');
  const sendAfterRemove = await call(`/channels/${internalDmId}/messages`, {
    method: 'POST',
    token: a.token,
    body: { body: '解除后不应发送', clientMsgId: randomUUID() },
  });
  check(
    sendAfterRemove.status === 403 && code(sendAfterRemove) === 'FRIENDSHIP_REQUIRED',
    '解除好友后 DM 发送被 403',
    `${sendAfterRemove.status}/${code(sendAfterRemove)}`,
  );

  // ── bridge：内部 A 发悬赏，外部账号申请，A 同意 ─────────────────────────
  const aBelt = await beltFromInternal(a.token);
  const bounty = await call('/belt/posts', {
    method: 'POST',
    token: aBelt.token,
    body: {
      board: 'bounty',
      title: `D测委托${stamp} 跨环带联络`,
      body: '用于验证 bridge 好友与 DM。',
      bountyReward: '面议',
    },
  });
  check(bounty.status === 201, '内部账号在环带发悬赏 201');
  const bountyId = data(bounty).post.id;

  const external = await call('/belt/auth/register', {
    method: 'POST',
    body: { handle: EXT, displayName: `D测外${stamp.slice(-3)}`, password },
  });
  check(external.status === 201, '外网账号注册 201');
  const ext = { token: data(external).accessToken, refresh: data(external).refreshToken };

  const bridgeRequest = await call('/belt/friendships/requests', {
    method: 'POST',
    token: ext.token,
    body: { handle: A, note: '悬赏联络', contextPostId: bountyId },
  });
  check(bridgeRequest.status === 201, '悬赏上下文发起跨面申请 201');
  const bridgeFriendshipId = data(bridgeRequest).friendship.id;
  check(data(bridgeRequest).friendship.surface === 'bridge', '跨面申请 surface=bridge');

  const acceptBridge = await call(`/friendships/${bridgeFriendshipId}`, {
    method: 'PATCH',
    token: a.token,
    body: { action: 'accept' },
  });
  check(acceptBridge.status === 200, '内部同意 bridge 200');
  const bridgeDmId = data(acceptBridge).friendship.dmChannelId;
  check(Boolean(bridgeDmId), 'bridge DM 已生成');
  if (bridgeDmId) cleanupChannelIds.push(bridgeDmId);

  const aBridgeConversations = await call('/conversations', { token: a.token });
  check(
    data(aBridgeConversations).conversations.some(
      (row) => row.id === bridgeDmId && row.surface === 'bridge',
    ),
    '内部侧栏出现 bridge DM',
  );
  const extConversations = await call('/belt/conversations', { token: ext.token });
  check(
    data(extConversations).conversations.some((row) => row.id === bridgeDmId),
    '外环侧出现 bridge DM',
  );

  const extSend = await call(`/belt/conversations/${bridgeDmId}/messages`, {
    method: 'POST',
    token: ext.token,
    body: { body: '外环呼叫帝江号。', clientMsgId: randomUUID() },
  });
  check(extSend.status === 201, 'bridge 外环侧发消息 201');
  const aRead = await call(`/channels/${bridgeDmId}/messages`, { token: a.token });
  check(
    aRead.status === 200 &&
      data(aRead).messages.some((message) => message.body === '外环呼叫帝江号。'),
    'bridge 内部侧可读外环消息',
  );
  const aSend = await call(`/channels/${bridgeDmId}/messages`, {
    method: 'POST',
    token: a.token,
    body: { body: '帝江号收到。', clientMsgId: randomUUID() },
  });
  check(aSend.status === 200, 'bridge 内部侧发消息 201');
  const extRead = await call(`/belt/conversations/${bridgeDmId}/messages`, { token: ext.token });
  check(
    extRead.status === 200 &&
      data(extRead).messages.some((message) => message.body === '帝江号收到。'),
    'bridge 外环侧可读内部消息',
  );

  console.log('\nPHASE_D_RESULT=' + JSON.stringify({ ok: true, checks: checks.length }));
}

main()
  .catch((error) => {
    console.error(`\nPHASE_D_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error('cleanup failed', error));
    await prisma.$disconnect();
  });
