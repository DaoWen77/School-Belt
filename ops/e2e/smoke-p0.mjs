#!/usr/bin/env node
/**
 * P0 重构后端冒烟：关注即私聊 / 商券打赏 / 收藏 / Feed 过滤 / Founder 特权 / 风纪外壳
 * 真实 API + 真实 PG，禁止 mock。产物：reports/e2e/p0-smoke.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e');
const API = 'http://127.0.0.1:3000';
const BASE = `${API}/api/v1`;
const PASSWORD = 'Dijiang#2026';

const checks = [];
const check = (id, name, ok, detail = {}) => {
  checks.push({ id, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${JSON.stringify(detail).slice(0, 240)}`);
};

async function call(method, route, { token, body } = {}, attempt = 0) {
  const response = await fetch(`${BASE}${route}`, {
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
  if (response.status === 429 && attempt < 4) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return call(method, route, { token, body }, attempt + 1);
  }
  return { status: response.status, ok: response.ok, data: payload?.data ?? null, error: payload?.error ?? null };
}

const tokens = new Map();
async function login(handle, attempt = 0) {
  if (tokens.has(handle)) return tokens.get(handle);
  const result = await call('POST', '/belt/auth/login', { body: { handle, password: PASSWORD } });
  if (result.status === 429 && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    return login(handle, attempt + 1);
  }
  if (!result.ok) throw new Error(`login ${handle}: ${result.status} ${JSON.stringify(result.error)}`);
  tokens.set(handle, result.data.accessToken);
  return result.data.accessToken;
}

const summary = { at: new Date().toISOString(), checks };
try {
  const qiu = await login('qiu');
  const creator = await login('creator');
  const founder = await login('founder');
  const applicant = await login('applicant');

  /* 1. 关注即私聊 */
  await call('POST', '/belt/users/creator/follow', { token: qiu });
  const dm1 = await call('POST', '/belt/directs/creator', { token: qiu });
  const dm2 = await call('POST', '/belt/directs/creator', { token: qiu });
  const dmList = await call('GET', '/belt/directs', { token: qiu });
  const conversation = (dmList.data?.conversations ?? []).find((item) => item.peer?.handle === 'creator');
  check('P1', '关注后建聊返回 channelId 且幂等', dm1.status === 201 || dm1.status === 200 ? Boolean(dm1.data?.channelId) && dm2.data?.channelId === dm1.data?.channelId : false, {
    first: { status: dm1.status, id: dm1.data?.channelId?.slice(0, 8), created: dm1.data?.created },
    second: { status: dm2.status, created: dm2.data?.created },
  });
  check('P2', '私聊列表出现对方', Boolean(conversation), { peer: conversation?.peer?.handle, id: conversation?.id?.slice(0, 8) });

  const channelId = dm1.data?.channelId ?? conversation?.id;
  const sent = await call('POST', `/belt/directs/${channelId}/messages`, { token: qiu, body: { body: 'P0 冒烟：关注即私聊' } });
  const messages = await call('GET', `/belt/directs/${channelId}/messages`, { token: qiu });
  const list = messages.data?.messages ?? messages.data?.items ?? [];
  check('P3', '私聊可发送并回读', Boolean(sent.ok) && list.some((m) => (m.body ?? m.content ?? '').includes('关注即私聊')), {
    send: sent.status,
    count: list.length,
  });

  const noFollow = await call('POST', '/belt/directs/founder', { token: applicant });
  check('P4', '未关注时私聊被拒 403', noFollow.status === 403, { status: noFollow.status, code: noFollow.error?.code, message: noFollow.error?.message });

  /* 2. 钱包与商券 */
  const walletQiu = await call('GET', '/belt/me/wallet', { token: qiu });
  const walletCreator = await call('GET', '/belt/me/wallet', { token: creator });
  check('W1', '钱包接口返回余额', typeof walletQiu.data?.balanceCents === 'number', {
    qiu: walletQiu.data?.balanceCents,
    creator: walletCreator.data?.balanceCents,
    recent: (walletQiu.data?.recent ?? []).length,
  });

  const posts = await call('GET', '/belt/users/creator/posts?limit=10', { token: qiu });
  const postId = (posts.data?.items ?? []).find((item) => item.board !== 'telegraph')?.id;
  const beforeQiu = walletQiu.data?.balanceCents ?? 0;
  const beforeCreator = walletCreator.data?.balanceCents ?? 0;

  /* 3. 打赏（事务 + 幂等） */
  const tipKey = `smoke-${Date.now()}`;
  const tip = await call('POST', `/belt/posts/${postId}/tip`, { token: qiu, body: { amountCents: 100, idempotencyKey: tipKey } });
  const tipAgain = await call('POST', `/belt/posts/${postId}/tip`, { token: qiu, body: { amountCents: 100, idempotencyKey: tipKey } });
  const afterQiu = (await call('GET', '/belt/me/wallet', { token: qiu })).data?.balanceCents ?? 0;
  const afterCreator = (await call('GET', '/belt/me/wallet', { token: creator })).data?.balanceCents ?? 0;
  check(
    'W2',
    '打赏扣款/入账正确且幂等',
    tip.ok && afterQiu === beforeQiu - 100 && afterCreator === beforeCreator + 100 && tipAgain.status >= 200 && tipAgain.status < 300,
    { beforeQiu, afterQiu, beforeCreator, afterCreator, tipStatus: tip.status, repeatStatus: tipAgain.status, groupId: tip.data?.groupId },
  );

  const selfTip = await call('POST', `/belt/posts/${postId}/tip`, { token: creator, body: { amountCents: 100, idempotencyKey: `self-${Date.now()}` } });
  check('W3', '不能打赏自己', selfTip.status === 400, { status: selfTip.status, code: selfTip.error?.code });

  const poorTip = await call('POST', `/belt/posts/${postId}/tip`, { token: qiu, body: { amountCents: 100_000, idempotencyKey: `poor-${Date.now()}` } });
  check('W4', '余额不足被拒', poorTip.status === 400 && poorTip.error?.code === 'INSUFFICIENT_FUNDS', { status: poorTip.status, code: poorTip.error?.code });

  /* 4. 收藏 */
  const bm1 = await call('POST', `/belt/posts/${postId}/bookmark`, { token: qiu });
  const bm2 = await call('POST', `/belt/posts/${postId}/bookmark`, { token: qiu });
  const bmOff = await call('DELETE', `/belt/posts/${postId}/bookmark`, { token: qiu });
  check('B1', '收藏开关幂等', bm1.data?.bookmarked === true && bm2.data?.bookmarked === true && bmOff.data?.bookmarked === false, {
    on: bm1.data,
    again: bm2.data,
    off: bmOff.data,
  });

  /* 5. Feed 过滤 */
  const marker = Date.now().toString().slice(-6);
  const mk = await Promise.all(
    ['moments', 'campus', 'daily'].map((board) =>
      call('POST', '/belt/posts', { token: qiu, body: { board, body: `P0 feed 冒烟 ${board} ${marker}` } }),
    ),
  );
  const feeds = {};
  for (const feed of ['all', 'dynamic', 'campus', 'daily']) {
    const response = await call('GET', `/belt/posts?feed=${feed}&limit=50`, { token: qiu });
    feeds[feed] = (response.data?.posts ?? response.data?.items ?? []).map((item) => item.board);
  }
  check(
    'F1',
    'feed 过滤只返回对应版块',
    mk.every((r) => r.ok) &&
      feeds.dynamic.every((b) => b === 'moments') &&
      feeds.campus.every((b) => b === 'campus') &&
      feeds.daily.every((b) => b === 'daily') &&
      feeds.all.includes('moments') &&
      feeds.all.includes('campus') &&
      feeds.all.includes('daily'),
    { counts: Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, v.length])), created: mk.map((r) => r.status) },
  );

  /* 6. Founder 特权 */
  const pin = await call('POST', `/belt/posts/${postId}/pin`, { token: founder });
  const detail = await call('GET', `/belt/posts/${postId}`, { token: qiu });
  const detailPost = detail.data?.post ?? detail.data ?? {};
  const pinByCreator = await call('POST', `/belt/posts/${postId}/pin`, { token: creator });
  check('G1', 'Founder 置顶生效 / 普通用户 403', pin.ok && detailPost.pinned === true && pinByCreator.status === 403, {
    pin: pin.status,
    pinned: detailPost.pinned,
    normalUser: pinByCreator.status,
  });

  const promote = await call('POST', `/belt/posts/${postId}/promote`, { token: founder });
  const telegraph = await call('GET', '/belt/posts?board=telegraph&limit=50', { token: qiu });
  const mirror = (telegraph.data?.posts ?? telegraph.data?.items ?? []).find((item) => item.id === promote.data?.mirrorId);
  check('G2', '推送到新闻生成 telegraph 镜像', promote.ok && Boolean(mirror) && mirror.board === 'telegraph', {
    promote: promote.status,
    mirrorBoard: mirror?.board,
  });

  const announce = await call('POST', '/belt/announcement', { token: founder, body: { body: `P0 冒烟公告 ${marker}`, level: 'warning' } });
  const current = await call('GET', '/belt/announcement', { token: qiu });
  const announceByCreator = await call('POST', '/belt/announcement', { token: creator, body: { body: 'x', level: 'info' } });
  check('G3', 'Founder 环塔内发公告 / 普通用户 403', announce.ok && (current.data?.announcement?.body ?? '').includes(marker) && announceByCreator.status === 403, {
    publish: announce.status,
    current: current.data?.announcement?.body,
    normalUser: announceByCreator.status,
  });

  /* 7. 风纪外壳 */
  const meCreator = await call('GET', '/belt/moderation/me', { token: creator });
  const meApplicant = await call('GET', '/belt/moderation/me', { token: applicant });
  const meQiu = await call('GET', '/belt/moderation/me', { token: qiu });
  check(
    'M1',
    '风纪外壳对任意登录用户可达并给出资格',
    meCreator.ok && meCreator.data?.eligibility?.canApply === true && meApplicant.data?.application?.status === 'pending' && meQiu.data?.eligibility?.levelOk === false,
    {
      creator: { level: meCreator.data?.eligibility?.level, canApply: meCreator.data?.eligibility?.canApply },
      applicant: { status: meApplicant.data?.application?.status, canApply: meApplicant.data?.eligibility?.canApply },
      qiu: { level: meQiu.data?.eligibility?.level, levelOk: meQiu.data?.eligibility?.levelOk, reasons: meQiu.data?.eligibility?.reasons },
    },
  );

  /* 8. 资料页钱包/私信标记 */
  const profile = await call('GET', '/belt/users/founder/profile', { token: applicant });
  check('M2', 'profile 带 balanceCents/canDirect', typeof profile.data?.user?.balanceCents === 'number' && typeof profile.data?.user?.canDirect === 'boolean', {
    balanceCents: profile.data?.user?.balanceCents,
    canDirect: profile.data?.user?.canDirect,
  });

  summary.passed = checks.filter((item) => item.ok).length;
  summary.total = checks.length;
} catch (error) {
  summary.fatal = String(error?.stack ?? error);
  console.error(summary.fatal);
} finally {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'p0-smoke.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const failed = (summary.checks ?? []).filter((item) => !item.ok);
  console.log(`\n${summary.passed ?? 0}/${summary.total ?? 0} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  process.exitCode = summary.fatal || failed.length ? 1 : 0;
}
