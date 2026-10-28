#!/usr/bin/env node
/**
 * 模块五 委托交易冒烟：发布 → 申请 → 选择接单人（冻结）→ 提交 → 验收打款（扣 5%）→ 取消退款
 * 真实 API + 真实 PG；金额单位：分。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const API = 'http://127.0.0.1:3000/api/v1';
const OUT = path.join(ROOT, 'reports', 'e2e');
const require = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:55432/dijiang?schema=public' } },
});

const checks = [];
const check = (id, ok, detail = {}) => {
  checks.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${JSON.stringify(detail).slice(0, 260)}`);
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

const wallet = async (token) => (await call('GET', '/belt/me/wallet', token)).data?.balanceCents ?? 0;
const balanceOf = async (handle) =>
  (await prisma.user.findUnique({ where: { handle }, select: { balanceCents: true } }))?.balanceCents ?? 0;

try {
  const creator = await login('creator');
  const qiu = await login('qiu');
  const officer = await login('protocol_officer');

  await prisma.task.deleteMany({ where: { title: { startsWith: 'P5 冒烟' } } });

  const beforeCreator = await wallet(creator);
  const beforeQiu = await wallet(qiu);
  const beforeTreasury = await balanceOf('platform_treasury');

  /* 1. 发布 */
  const created = await call('POST', '/belt/tasks', creator, {
    title: `P5 冒烟委托 ${Date.now()}`,
    description: '把外环信号整理成一页 PDF，今天内交付。',
    priceCents: 1000,
  });
  const taskId = created.data?.task?.id;
  check('T1 发布委托', created.status === 201 && Boolean(taskId), {
    status: created.status,
    price: created.data?.task?.priceCents,
    fee: created.data?.task?.feeCents,
    net: created.data?.task?.netCents,
    myRole: created.data?.task?.myRole,
  });

  /* 2. 非发起人不能编辑 */
  const editByOther = await call('PATCH', `/belt/tasks/${taskId}`, qiu, { title: '篡改标题' });
  check('T2 非发起人不能编辑', editByOther.status === 403 || editByOther.status === 404, { status: editByOther.status });

  /* 3. 申请 + 重复申请 */
  const apply = await call('POST', `/belt/tasks/${taskId}/apply`, qiu, { message: '我来做，今晚交付。' });
  const dupe = await call('POST', `/belt/tasks/${taskId}/apply`, qiu, { message: '再来一次' });
  check('T3 申请 + 重复 409', apply.status === 201 && dupe.status === 409, { apply: apply.status, dupe: dupe.status, code: dupe.error?.code });

  /* 4. 选择接单人 → 冻结 */
  const detail = await call('GET', `/belt/tasks/${taskId}`, creator);
  const applicationId = detail.data?.applications?.[0]?.id;
  const select = await call('POST', `/belt/tasks/${taskId}/select`, creator, { applicationId });
  const afterSelectCreator = await wallet(creator);
  const escrow = await prisma.escrow.findUnique({ where: { taskId } });
  check(
    'T4 选择接单人并冻结资金',
    select.status === 200 &&
      afterSelectCreator === beforeCreator - 1000 &&
      escrow?.state === 'held' &&
      escrow?.amountCents === 1000 &&
      escrow?.feeCents === 50,
    {
      status: select.status,
      creatorBalance: `${beforeCreator} → ${afterSelectCreator}`,
      escrow: escrow ? { state: escrow.state, amount: escrow.amountCents, fee: escrow.feeCents } : null,
      taskStatus: select.data?.task?.status,
    },
  );

  /* 5. 提交 + 验收打款 */
  const submit = await call('POST', `/belt/tasks/${taskId}/submit`, qiu);
  const accept = await call('POST', `/belt/tasks/${taskId}/accept`, creator);
  const afterQiu = await wallet(qiu);
  const afterTreasury = await balanceOf('platform_treasury');
  const settledEscrow = await prisma.escrow.findUnique({ where: { taskId } });
  const ledger = await prisma.ledgerEntry.findMany({ where: { refId: taskId }, orderBy: { createdAt: 'asc' } });
  check(
    'T5 提交 + 验收打款（5% 抽成）',
    submit.status === 200 &&
      accept.status === 200 &&
      afterQiu === beforeQiu + 950 &&
      afterTreasury === beforeTreasury + 50 &&
      settledEscrow?.state === 'released' &&
      ledger.some((row) => row.kind === 'task_escrow') &&
      ledger.some((row) => row.kind === 'task_payout') &&
      ledger.some((row) => row.kind === 'fee'),
    {
      payout: accept.data?.payout,
      qiuBalance: `${beforeQiu} → ${afterQiu}`,
      treasury: `${beforeTreasury} → ${afterTreasury}`,
      escrowState: settledEscrow?.state,
      ledgerKinds: ledger.map((row) => row.kind),
      taskStatus: accept.data?.task?.status,
    },
  );

  /* 6. 取消退款 */
  const t2 = await call('POST', '/belt/tasks', creator, {
    title: `P5 冒烟取消 ${Date.now()}`,
    description: '将被取消的委托。',
    priceCents: 2000,
  });
  const t2Id = t2.data?.task?.id;
  await call('POST', `/belt/tasks/${t2Id}/apply`, officer, { message: '我接。' });
  const t2Detail = await call('GET', `/belt/tasks/${t2Id}`, creator);
  const beforeCancelCreator = await wallet(creator);
  await call('POST', `/belt/tasks/${t2Id}/select`, creator, { applicationId: t2Detail.data?.applications?.[0]?.id });
  const cancel = await call('POST', `/belt/tasks/${t2Id}/cancel`, creator);
  const afterCancelCreator = await wallet(creator);
  const refunded = await prisma.escrow.findUnique({ where: { taskId: t2Id } });
  check(
    'T6 取消并退款',
    cancel.status === 200 && afterCancelCreator === beforeCancelCreator && refunded?.state === 'refunded',
    { status: cancel.status, balance: `${beforeCancelCreator} → ${afterCancelCreator}`, escrow: refunded?.state },
  );

  /* 7. 余额不足 */
  const t3 = await call('POST', '/belt/tasks', officer, {
    title: `P5 冒烟余额不足 ${Date.now()}`,
    description: '价格远超余额。',
    priceCents: 1000000,
  });
  const t3Id = t3.data?.task?.id;
  await call('POST', `/belt/tasks/${t3Id}/apply`, qiu, { message: '试试' });
  const t3Detail = await call('GET', `/belt/tasks/${t3Id}`, officer);
  const poor = await call('POST', `/belt/tasks/${t3Id}/select`, officer, { applicationId: t3Detail.data?.applications?.[0]?.id });
  check('T7 余额不足被拒', poor.status === 400 && poor.error?.code === 'INSUFFICIENT_FUNDS', {
    status: poor.status,
    code: poor.error?.code,
  });

  /* 8. 清理 */
  await prisma.task.deleteMany({ where: { title: { startsWith: 'P5 冒烟' } } });
} catch (error) {
  checks.push({ id: 'fatal', ok: false, error: String(error?.stack ?? error) });
  console.error(error);
} finally {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'tasks-smoke.json'), `${JSON.stringify(checks, null, 2)}\n`, 'utf8');
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  await prisma.$disconnect();
  process.exitCode = failed.length ? 1 : 0;
}
