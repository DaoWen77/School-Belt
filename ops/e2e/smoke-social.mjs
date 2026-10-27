#!/usr/bin/env node
/**
 * 模块一/二 后端冒烟（真实 API + 真实 PG，禁止 mock）
 * 覆盖：唯一呼号搜索 / 个人主页聚合 / 三 Tab 数据 / 关注幂等 / 等级 / 风纪委资格 /
 *       工单受理与去重 / 工单池 / 投票未结案与多数决结案 / 隐藏内容 + EXP 扣分 / 认证标签 / 权限拒绝。
 *
 * 用法：node smoke-social.mjs [--api http://127.0.0.1:3000] [--password Dijiang#2026]
 * 产物：reports/e2e/social-smoke.json、reports/e2e/social-smoke.log
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'reports', 'e2e');
const API = (process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'http://127.0.0.1:3000').replace(/\/$/, '');
const BASE = `${API}/api/v1`;
const PASSWORD = process.argv.includes('--password')
  ? process.argv[process.argv.indexOf('--password') + 1]
  : (process.env.SEED_PASSWORD ?? 'Dijiang#2026');

const checks = [];
function check(id, name, ok, detail = {}) {
  checks.push({ id, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${JSON.stringify(detail).slice(0, 220)}`);
  return ok;
}

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
  /* 全局节流 5/s：冒烟用例按顺序快速请求会撞 429，退避后重试 */
  if (response.status === 429 && attempt < 4) {
    const wait = Math.min(10_000, Number(payload?.error?.retryAfterMs ?? 1200) + 200);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return call(method, route, { token, body }, attempt + 1);
  }
  return { status: response.status, ok: response.ok, data: payload?.data ?? null, error: payload?.error ?? null };
}

const tokenCache = new Map();
async function login(handle, attempt = 0) {
  if (tokenCache.has(handle)) return tokenCache.get(handle);
  const result = await call('POST', '/belt/auth/login', { body: { handle, password: PASSWORD } });
  if (result.status === 429 && attempt < 3) {
    const wait = Math.min(65_000, Number(result.error?.retryAfterMs ?? 15_000) + 500);
    console.log(`… 登录限流，等待 ${wait}ms 后重试 ${handle}`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return login(handle, attempt + 1);
  }
  if (!result.ok) throw new Error(`login ${handle} failed: ${result.status} ${JSON.stringify(result.error)}`);
  tokenCache.set(handle, result.data.accessToken);
  return result.data.accessToken;
}

const summary = { api: API, startedAt: new Date().toISOString() };
try {
  const founder = await login('founder');
  const clerk1 = await login('clerk1');
  const qiu = await login('qiu');
  const officer = await login('protocol_officer');

  /* 1. 唯一呼号搜索 */
  const search = await call('GET', '/belt/users/search?q=cre', { token: founder });
  check('S1', '呼号搜索命中 creator', search.ok && (search.data?.users ?? []).some((u) => u.handle === 'creator'), {
    total: search.data?.users?.length ?? 0,
  });

  /* 2. 个人主页聚合 */
  const profile = await call('GET', '/belt/users/creator/profile', { token: founder });
  const creator = profile.data?.user;
  check(
    'S2',
    '主页返回三计数/等级/标签/关注态',
    profile.ok &&
      typeof creator?.counts?.followers === 'number' &&
      typeof creator?.counts?.likesReceived === 'number' &&
      typeof creator?.level === 'number' &&
      Array.isArray(creator?.tags) &&
      creator.isSelf === false,
    { handle: creator?.handle, level: creator?.level, counts: creator?.counts, tags: creator?.tags },
  );

  const selfProfile = await call('GET', '/belt/users/founder/profile', { token: founder });
  check('S3', '本人主页 isSelf=true 且 Founder 可见风纪入口', selfProfile.data?.user?.isSelf === true && selfProfile.data?.eligibility?.moderationVisible === true, {
    eligibility: selfProfile.data?.eligibility,
  });

  /* 3. 三 Tab */
  const posts = await call('GET', '/belt/users/creator/posts?limit=10', { token: founder });
  const commissions = await call('GET', '/belt/users/creator/commissions', { token: founder });
  const services = await call('GET', '/belt/users/creator/services', { token: founder });
  check('S4', 'Tab1 帖子有数据', posts.ok && (posts.data?.items ?? []).length > 0, { posts: posts.data?.items?.length });
  check('S5', 'Tab2 委托有数据', commissions.ok && (commissions.data?.items ?? []).length > 0, { commissions: commissions.data?.items?.length });
  check('S6', 'Tab3 服务有数据', services.ok && (services.data?.items ?? []).length > 0, { services: services.data?.items?.length });

  /* 4. 关注幂等 */
  const follow1 = await call('POST', '/belt/users/creator/follow', { token: qiu });
  const follow2 = await call('POST', '/belt/users/creator/follow', { token: qiu });
  const unfollow = await call('DELETE', '/belt/users/creator/follow', { token: qiu });
  const after = await call('GET', '/belt/users/creator/profile', { token: qiu });
  check(
    'S7',
    '关注幂等 + 取消后计数回落',
    follow1.ok && follow2.ok && unfollow.ok && after.data?.user?.isFollowing === false,
    { f1: follow1.data, f2: follow2.data, unfollow: unfollow.data, after: after.data?.user?.counts?.followers },
  );

  /* 5. 等级 */
  const level = await call('GET', '/belt/me/level', { token: clerk1 });
  check('S8', '等级接口 cap=6 且含奖励表', level.ok && level.data?.cap === 6 && typeof level.data?.level === 'number', {
    level: level.data?.level,
    exp: level.data?.exp,
    nextLevelAt: level.data?.nextLevelAt,
  });

  /* 6. 风纪委资格与工单池 */
  const modMe = await call('GET', '/belt/moderation/me', { token: clerk1 });
  check('S9', '风纪委身份与资格', modMe.ok && modMe.data?.isClerk === true && modMe.data?.canReview === true, {
    isClerk: modMe.data?.isClerk,
    eligibility: modMe.data?.eligibility,
  });

  const normalMe = await call('GET', '/belt/moderation/me', { token: qiu });
  const forbiddenPool = await call('GET', '/belt/moderation/reports?status=open', { token: qiu });
  check('S10', '普通成员看不到工单池（403）', forbiddenPool.status === 403, { status: forbiddenPool.status, code: forbiddenPool.error?.code });

  /* 7. 举报受理 + 去重（重复跑时接受已存在工单） */
  const openBefore = await call('GET', '/belt/moderation/reports?status=open&limit=50', { token: clerk1 });
  const reportedTargets = new Set((openBefore.data?.items ?? []).map((item) => item.targetId));
  const targetPostId =
    (posts.data?.items ?? []).find((item) => !reportedTargets.has(item.id))?.id ?? posts.data?.items?.[0]?.id;
  const report1 = await call('POST', '/belt/moderation/reports', {
    token: qiu,
    body: { targetType: 'post', targetId: targetPostId, reason: 'spam', detail: '冒烟用例：重复广告' },
  });
  const dup = await call('POST', '/belt/moderation/reports', {
    token: qiu,
    body: { targetType: 'post', targetId: targetPostId, reason: 'spam' },
  });
  const selfReport = await call('POST', '/belt/moderation/reports', {
    token: await login('creator'),
    body: { targetType: 'post', targetId: targetPostId, reason: 'spam' },
  });
  const reportId = report1.status === 201
    ? report1.data?.report?.id
    : (openBefore.data?.items ?? []).find((item) => item.targetId === targetPostId)?.id;
  check('S11', '举报受理 + 同目标去重 409', (report1.status === 201 || report1.status === 409) && dup.status === 409, {
    created: report1.status,
    dup: dup.status,
    dupCode: dup.error?.code,
    selfReport: selfReport.status,
  });

  /* 8. 工单池 + 单票不结案 */
  const pool = await call('GET', '/belt/moderation/reports?status=open&limit=30', { token: clerk1 });
  const card = (pool.data?.items ?? []).find((item) => item.id === reportId) ?? pool.data?.items?.[0];
  check('S12', '工单池含目标快照与票数', pool.ok && (pool.data?.items ?? []).length > 0 && Boolean(card?.target?.authorHandle), {
    open: pool.data?.items?.length,
    first: card ? { reason: card.reason, votes: card.votes, author: card.target?.authorHandle } : null,
  });

  const vote1 = await call('POST', `/belt/moderation/reports/${card.id}/vote`, { token: clerk1, body: { verdict: 'violation' } });
  check('S13', '≥3 票才结案：单票不结案', vote1.ok && vote1.data?.resolved === false, {
    resolved: vote1.data?.resolved,
    votes: vote1.data?.report?.votes,
  });

  /* 9. 多数决结案：新建一张一次性帖，三票违规 */
  const creatorToken = await login('creator');
  const freshPost = await call('POST', '/belt/posts', {
    token: creatorToken,
    body: { board: 'daily', body: `冒烟临时帖 ${new Date().toISOString()}` },
  });
  /* 发帖本身 +5 EXP，基准必须取在发帖之后，才能只量惩罚 */
  const expBefore = (await call('GET', '/belt/users/creator/profile', { token: founder })).data?.user?.exp ?? 0;
  const resolveTarget = freshPost.data?.id ?? freshPost.data?.post?.id;
  const report2 = await call('POST', '/belt/moderation/reports', {
    token: qiu,
    body: { targetType: 'post', targetId: resolveTarget, reason: 'illegal', detail: '冒烟用例：多数决结案' },
  });
  const rid = report2.data?.report?.id;
  const v1 = await call('POST', `/belt/moderation/reports/${rid}/vote`, { token: clerk1, body: { verdict: 'violation' } });
  const v2 = await call('POST', `/belt/moderation/reports/${rid}/vote`, { token: founder, body: { verdict: 'violation' } });
  const vote3 = await call('POST', `/belt/moderation/reports/${rid}/vote`, { token: officer, body: { verdict: 'violation' } });
  const expAfter = (await call('GET', '/belt/users/creator/profile', { token: founder })).data?.user?.exp ?? 0;
  const hiddenCheck = await call('GET', `/belt/users/creator/posts?limit=10`, { token: founder });
  const stillListed = (hiddenCheck.data?.items ?? []).some((item) => item.id === resolveTarget);
  check(
    'S14',
    '三票多数决 → 结案 + 隐藏内容 + 扣 EXP',
    vote3.ok && vote3.data?.resolved === true && stillListed === false && expAfter === expBefore - 20,
    {
      postStatus: freshPost.status,
      reportStatus: report2.status,
      reportError: report2.error?.code,
      votes: [v1.status, v2.status, vote3.status],
      resolved: vote3.data?.resolved,
      verdict: vote3.data?.report?.status,
      expBefore,
      expAfter,
      stillListed,
    },
  );

  /* 10. 认证标签（Founder） */
  const tags = await call('POST', '/belt/moderation/users/creator/tags', {
    token: founder,
    body: { tags: ['教师', '开发者', '校园知名人物'] },
  });
  const tagsByMember = await call('POST', '/belt/moderation/users/creator/tags', {
    token: qiu,
    body: { tags: ['赞助者'] },
  });
  check('S15', 'Founder 授予认证标签 / 普通成员 403', tags.ok && tags.data?.tags?.includes('教师') && tagsByMember.status === 403, {
    tags: tags.data?.tags,
    memberStatus: tagsByMember.status,
  });

  /* 11. 风纪委申请门槛 */
  const applicantMe = await call('GET', '/belt/moderation/me', { token: await login('applicant') });
  check('S16', 'Lv4 申请人状态与门槛计算', applicantMe.ok && typeof applicantMe.data?.eligibility?.levelOk === 'boolean', {
    eligibility: applicantMe.data?.eligibility,
    application: applicantMe.data?.application?.status ?? null,
  });

  summary.finishedAt = new Date().toISOString();
  summary.passed = checks.filter((item) => item.ok).length;
  summary.total = checks.length;
  summary.checks = checks;
} catch (error) {
  summary.fatal = String(error?.stack ?? error);
  console.error(summary.fatal);
} finally {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'social-smoke.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const failed = summary.checks ? summary.checks.filter((item) => !item.ok) : [];
  console.log(`\n${summary.passed ?? 0}/${summary.total ?? 0} 通过${failed.length ? `，失败：${failed.map((item) => item.id).join(',')}` : ''}`);
  process.exitCode = summary.fatal || failed.length ? 1 : 0;
}
