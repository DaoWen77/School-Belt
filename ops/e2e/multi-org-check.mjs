#!/usr/bin/env node
/** 扩展模块1：多组织身份 + 前端前缀切换验证。 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const requireServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = requireServer('@prisma/client');
const prisma = new PrismaClient();

const API = 'http://127.0.0.1:3000/api/v1';
const WEB = 'http://127.0.0.1:3100';
const stamp = Date.now().toString(36).slice(-5);
const orgAName = `测绘组${stamp}`;
const orgBName = `新闻部${stamp}`;
const images = [];
let orgA = null;
let orgB = null;

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function main() {
  const chen = await prisma.user.findUniqueOrThrow({ where: { handle: 'chen' } });
  const lin = await prisma.user.findUniqueOrThrow({ where: { handle: 'lin' } });
  orgA = await prisma.organization.create({
    data: { name: orgAName, slug: `test-survey-${stamp}`, summary: '多组织身份测试 A', status: 'active', ownerId: chen.id },
  });
  orgB = await prisma.organization.create({
    data: { name: orgBName, slug: `test-news-${stamp}`, summary: '多组织身份测试 B', status: 'active', ownerId: lin.id },
  });
  await prisma.organizationMember.createMany({
    data: [
      { organizationId: orgA.id, userId: chen.id, role: 'owner', status: 'active', joinedAt: new Date() },
      { organizationId: orgB.id, userId: lin.id, role: 'owner', status: 'active', joinedAt: new Date() },
      { organizationId: orgB.id, userId: chen.id, role: 'member', status: 'active', joinedAt: new Date() },
    ],
  });

  const login = await call('/auth/login', { method: 'POST', body: { handle: 'chen', password: 'Dijiang#2026' } });
  const token = login.accessToken;
  const before = await call('/me/organizations', { token });
  console.log('BEFORE', JSON.stringify(before));
  if (before.options.length !== 2) throw new Error('expected two organization options');
  if (before.effectiveOrganizationId !== orgA.id) throw new Error('default should be organization owner A');

  const meBefore = await call('/me', { token });
  console.log('PREFIX_BEFORE', JSON.stringify(meBefore.user.prefixes));
  if (!meBefore.user.prefixes.some((prefix) => prefix === `[${orgAName}]Official`)) throw new Error('owner prefix A missing');

  const switched = await call('/me/display-organization', {
    method: 'PATCH',
    token,
    body: { organizationId: orgB.id },
  });
  console.log('SWITCHED', JSON.stringify(switched.user.prefixes), switched.effectiveOrganizationId);
  if (switched.effectiveOrganizationId !== orgB.id) throw new Error('switch to B failed');
  if (!switched.user.prefixes.some((prefix) => prefix === `[${orgBName}]`)) throw new Error('member prefix B missing');

  const meAfter = await call('/me', { token });
  console.log('PREFIX_AFTER', JSON.stringify(meAfter.user.prefixes));
  if (meAfter.user.prefixes.some((prefix) => prefix === `[${orgAName}]Official`)) throw new Error('stale owner prefix A remains');

  // 回到自动模式，让 UI 截图从“组织 Owner 默认身份”开始，再演示切到成员组织。
  await call('/me/display-organization', {
    method: 'PATCH',
    token,
    body: { organizationId: null },
  });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(({ access, refresh }) => {
      localStorage.setItem('dj.access', access);
      localStorage.setItem('dj.refresh', refresh);
    }, { access: login.accessToken, refresh: login.refreshToken });
    await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const select = page.locator('select[aria-label="当前展示身份"]');
    console.log('SELECT_OPTIONS', await select.locator('option').count());
    console.log('SELECT_VALUE', await select.inputValue());
    await page.locator('section').filter({ has: select }).scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(300);
    const beforeShot = path.join(ROOT, 'reports', 'frontend', 'multi-org-before-switch.png');
    await page.screenshot({ path: beforeShot, fullPage: false });
    images.push(beforeShot);

    await select.selectOption(orgB.id);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(700);
    const selectAfter = page.locator('select[aria-label="当前展示身份"]');
    console.log('SELECT_VALUE_AFTER', await selectAfter.inputValue());
    console.log('PREFIX_B_UI', (await page.locator('body').innerText()).includes(`[${orgBName}]`));
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    console.log('WORKSPACE_PREFIX_B', (await page.locator('body').innerText()).includes(`[${orgBName}]`));
    const afterShot = path.join(ROOT, 'reports', 'frontend', 'multi-org-after-switch.png');
    await page.screenshot({ path: afterShot, fullPage: false });
    images.push(afterShot);
    await context.close();
  } finally {
    await browser.close();
  }

  console.log(
    'MULTI_ORG_RESULT=' +
      JSON.stringify({
        ok: true,
        options: before.options.map((option) => ({ name: option.name, role: option.role, prefix: option.prefix })),
        defaultOrganizationId: before.effectiveOrganizationId,
        switchedOrganizationId: switched.effectiveOrganizationId,
        prefixesBefore: meBefore.user.prefixes,
        prefixesAfter: meAfter.user.prefixes,
        images: images.map((file) => path.relative(ROOT, file).replaceAll('\\', '/')),
      }),
  );
}

main()
  .catch((error) => {
    console.error(`MULTI_ORG_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.user.updateMany({ where: { handle: 'chen' }, data: { displayOrganizationId: null } }).catch(() => null);
    if (orgA) await prisma.organization.delete({ where: { id: orgA.id } }).catch(() => null);
    if (orgB) await prisma.organization.delete({ where: { id: orgB.id } }).catch(() => null);
    await prisma.$disconnect();
  });
