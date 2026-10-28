#!/usr/bin/env node
/**
 * Phase C 验证（真实 API + 真实 PG）：
 *   - 内部 → 环带 handoff，belt 会话可用；
 *   - 环带频道列表 / 发消息 / 读消息；
 *   - 帖子公开读、登录发帖、点赞、评论；
 *   - 公告仅协议官可发；外网账号不能发公告；
 *   - 外网账号不能登入内部；
 *   - 帖子按 surface/board 隔离。
 *
 * 用法：cd server && DATABASE_URL=... node test/phase-c.e2e.mjs
 */
import { PrismaClient } from '@prisma/client';

const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const UA = 'phase-c-probe/1.0';
const prisma = new PrismaClient();
const stamp = Date.now().toString(36);
const externalHandle = `probe_c_${stamp}`;
const password = 'ProbeC#2026';
const titlePrefix = `C测信号${stamp}`;
const checks = [];
let channelId = null;
let dailyId = null;
let bulletinId = null;

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

async function loginInternal(handle) {
  const response = await call('/auth/login', {
    method: 'POST',
    body: { handle, password: 'Dijiang#2026' },
  });
  check(response.status === 200, `${handle} 内部登录`);
  return data(response).accessToken;
}

async function beltFromInternal(internalToken) {
  const handoff = await call('/access/belt/handoff', {
    method: 'POST',
    token: internalToken,
    body: { next: '/belt/channel' },
  });
  check(handoff.status === 201, '内部签发环带交接码 201');
  const exchange = await call('/belt/auth/handoff/exchange', {
    method: 'POST',
    body: { code: data(handoff).code },
  });
  check(exchange.status === 200, '环带兑换交接码 200');
  return data(exchange).accessToken;
}

async function cleanup() {
  const posts = await prisma.post.findMany({
    where: { title: { startsWith: titlePrefix } },
    select: { id: true },
  });
  const ids = posts.map((post) => post.id);
  if (ids.length > 0) {
    await prisma.postLike.deleteMany({ where: { postId: { in: ids } } });
    await prisma.postComment.deleteMany({ where: { postId: { in: ids } } });
    await prisma.post.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.message.deleteMany({ where: { body: { startsWith: `[PHASE-C] ${stamp}` } } });
  await prisma.user.deleteMany({ where: { handle: externalHandle } });
}

async function main() {
  await cleanup();

  const founder = await loginInternal('founder');
  const founderBelt = await beltFromInternal(founder);

  const me = await call('/belt/me', { token: founderBelt });
  check(me.status === 200, 'GET /belt/me 200');
  check(data(me).user.handle === 'founder', '环带身份与内部账号一致');
  check(data(me).user.isInternal === true, '内部账号进入环带后仍标记 internal');

  const channels = await call('/belt/channels', { token: founderBelt });
  check(channels.status === 200, 'GET /belt/channels 200');
  channelId = data(channels).channels[0]?.id ?? null;
  check(Boolean(channelId), '环带默认频道存在');

  const send = await call(`/belt/channels/${channelId}/messages`, {
    method: 'POST',
    token: founderBelt,
    body: { body: `[PHASE-C] ${stamp} 公共频段测试信号` },
  });
  check(send.status === 201, '环带频道发消息 201');
  check(data(send).message.sender.prefixes.includes('[站长]Official'), '发送者证章进入消息投影');

  const messages = await call(`/belt/channels/${channelId}/messages?limit=20`, { token: founderBelt });
  check(messages.status === 200, '环带频道读消息 200');
  check(
    data(messages).messages.some((message) => message.body.includes(`[PHASE-C] ${stamp}`)),
    '消息列表包含刚发送的信号',
  );

  const publicList = await call('/belt/posts?board=daily');
  check(publicList.status === 200, '帖子公开读（无 token）200');

  const daily = await call('/belt/posts', {
    method: 'POST',
    token: founderBelt,
    body: {
      board: 'daily',
      title: `${titlePrefix} 日常日志`,
      body: '这是 Phase C 的公开日常帖子。',
    },
  });
  check(daily.status === 201, '环带登录用户发日常帖 201');
  dailyId = data(daily).post.id;
  check(data(daily).post.board === 'daily', '日常帖 board=daily');
  check(data(daily).post.author.prefixes.includes('[站长]Official'), '帖子作者证章正确');

  const detail = await call(`/belt/posts/${dailyId}`);
  check(detail.status === 200, '帖子详情公开读 200');
  check(data(detail).post.title.includes(titlePrefix), '帖子详情标题正确');

  const like = await call(`/belt/posts/${dailyId}/like`, { method: 'POST', token: founderBelt });
  check(like.status === 200 && data(like).liked === true, '点赞 200');
  const withLike = await call(`/belt/posts?board=daily`, { token: founderBelt });
  check(
    data(withLike).posts.find((post) => post.id === dailyId)?.likedByMe === true,
    '登录读列表 likedByMe=true',
  );

  const comment = await call(`/belt/posts/${dailyId}/comments`, {
    method: 'POST',
    token: founderBelt,
    body: { body: 'Phase C 回波。' },
  });
  check(comment.status === 201, '评论 201');
  const comments = await call(`/belt/posts/${dailyId}/comments`);
  check(comments.status === 200 && data(comments).comments.length === 1, '评论公开读 200');

  const bulletin = await call('/belt/posts', {
    method: 'POST',
    token: founderBelt,
    body: {
      board: 'bulletin',
      title: `${titlePrefix} 官方快报`,
      body: 'Phase C 官方公告测试。',
    },
  });
  check(bulletin.status === 201, '协议官发官方快报 201');
  bulletinId = data(bulletin).post.id;
  check(data(bulletin).post.source === 'official', '快报 source=official');

  const badBoard = await call('/belt/posts?board=moments');
  check(badBoard.status === 400, '环带帖子拒绝 moments 版块', `${badBoard.status}`);

  const register = await call('/belt/auth/register', {
    method: 'POST',
    body: {
      handle: externalHandle,
      displayName: `外环C${stamp.slice(-3)}`,
      password,
    },
  });
  check(register.status === 201, '外网账号注册 201');
  const externalBelt = data(register).accessToken;
  check(data(register).user.isInternal === false, '外网账号 isInternal=false');

  const externalBulletin = await call('/belt/posts', {
    method: 'POST',
    token: externalBelt,
    body: { board: 'bulletin', title: `${titlePrefix} 外网公告`, body: '不应成功' },
  });
  check(externalBulletin.status === 403, '外网账号不能发官方快报 403', `${externalBulletin.status}`);

  const externalDaily = await call('/belt/posts', {
    method: 'POST',
    token: externalBelt,
    body: { board: 'daily', title: `${titlePrefix} 外网日常`, body: '外网公开日常。' },
  });
  check(externalDaily.status === 201, '外网账号可发日常帖 201');

  const externalInternalLogin = await call('/auth/login', {
    method: 'POST',
    body: { handle: externalHandle, password },
  });
  check(
    externalInternalLogin.status === 403 && code(externalInternalLogin) === 'PROTOCOL_DENIED',
    '外网账号内部登录 403 PROTOCOL_DENIED',
  );

  const internalPosts = await call('/posts', { token: founder });
  check(
    internalPosts.status === 200 && data(internalPosts).posts.every((post) => !post.body.includes(titlePrefix)),
    '内部朋友圈不混入环带帖子',
  );

  console.log('\nPHASE_C_RESULT=' + JSON.stringify({ ok: true, checks: checks.length }));
}

main()
  .catch((error) => {
    console.error(`\nPHASE_C_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error('cleanup failed', error));
    await prisma.$disconnect();
  });
