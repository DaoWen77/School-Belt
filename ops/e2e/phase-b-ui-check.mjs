#!/usr/bin/env node
/**
 * Phase B UI 证据：真实 API 创建组织 → Playwright 抓组织证章/审批/私有频道。
 * 不登录 UI，直接把 API 签发的 token 写进 localStorage，避免登录限流干扰。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const API = 'http://127.0.0.1:3000/api/v1';
const WEB = 'http://127.0.0.1:3100';
const stamp = Date.now().toString(36).slice(-5);
const activeName = `视觉验收${stamp}`;
const pendingName = `待审验收${stamp}`;
const PREFIXES = ['视觉验收', '待审验收'];
const images = [];
let activeOrgId = null;
let pendingOrgId = null;

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'user-agent': 'phase-b-ui/1.0',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function login(handle) {
  const data = await call('/auth/login', {
    method: 'POST',
    body: { handle, password: 'Dijiang#2026' },
  });
  return { token: data.accessToken, refresh: data.refreshToken, user: data.user };
}

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { OR: PREFIXES.map((prefix) => ({ name: { startsWith: prefix } })) },
    select: { id: true },
  });
  const ids = orgs.map((org) => org.id);
  if (ids.length === 0) return;
  const channels = await prisma.channel.findMany({ where: { organizationId: { in: ids } }, select: { id: true } });
  const channelIds = channels.map((channel) => channel.id);
  await prisma.channelMember.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.message.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
}

async function pageWithToken(browser, token, refresh) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  await page.addInitScript(
    ({ access, refreshToken }) => {
      window.localStorage.setItem('dj.access', access);
      window.localStorage.setItem('dj.refresh', refreshToken);
    },
    { access: token, refreshToken: refresh },
  );
  page.on('pageerror', (error) => console.log('PAGE_ERROR', error.message.slice(0, 160)));
  return { context, page };
}

async function shot(page, name) {
  const file = path.join(ROOT, 'reports', 'frontend', name);
  await page.screenshot({ path: file, fullPage: false });
  images.push(file);
  console.log('SHOT', file);
}

async function elementShot(locator, name) {
  const file = path.join(ROOT, 'reports', 'frontend', name);
  await locator.screenshot({ path: file });
  images.push(file);
  console.log('SHOT', file);
}

async function main() {
  await cleanup();

  const chen = await login('chen');
  const lin = await login('lin');
  const founder = await login('founder');
  const yue = await login('yue');

  const active = await call('/organizations', {
    method: 'POST',
    token: chen.token,
    body: { name: activeName, summary: '视觉验收用组织：拥有私有频道、证章与成员。' },
  });
  activeOrgId = active.organization.id;
  await call(`/organizations/${activeOrgId}/review`, {
    method: 'PATCH',
    token: founder.token,
    body: { action: 'approve' },
  });
  await call(`/organizations/${activeOrgId}/join`, {
    method: 'POST',
    token: lin.token,
    body: { note: '视觉验收成员' },
  });
  await call(`/organizations/${activeOrgId}/requests/${lin.user.id}`, {
    method: 'PATCH',
    token: chen.token,
    body: { action: 'approve' },
  });

  const pending = await call('/organizations', {
    method: 'POST',
    token: yue.token,
    body: { name: pendingName, summary: '视觉验收用待审组织：用于展示 Owner 审批卡片。' },
  });
  pendingOrgId = pending.organization.id;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // 1. Owner：Header 全局 [站长]Official
    const owner = await pageWithToken(browser, founder.token, founder.refresh);
    await owner.page.goto(WEB, { waitUntil: 'networkidle' });
    await owner.page.waitForTimeout(600);
    const ownerBadges = await owner.page.locator('.identity-badge').allInnerTexts();
    console.log('OWNER_BADGES', JSON.stringify(ownerBadges.slice(0, 8)));
    await shot(owner.page, 'phase-b-owner-header-1440.png');

    // 2. Owner：设置 → 组织 → 待审组织
    await owner.page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
    await owner.page.waitForTimeout(400);
    await owner.page.getByRole('button', { name: '组织', exact: true }).click();
    await owner.page.waitForTimeout(350);
    await owner.page.locator('#tab-org').scrollIntoViewIfNeeded();
    await owner.page.waitForTimeout(250);
    const ownerOrgText = await owner.page.locator('#tab-org').innerText();
    console.log('OWNER_ORG_HAS_PENDING', ownerOrgText.includes(pendingName));
    await shot(owner.page, 'phase-b-owner-org-review-1440.png');
    await elementShot(owner.page.locator('#tab-org'), 'phase-b-owner-org-panel-1440.png');
    await owner.context.close();

    // 3. 组织 Owner：设置 → 组织 → 自有组织与证章
    const member = await pageWithToken(browser, chen.token, chen.refresh);
    await member.page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
    await member.page.waitForTimeout(400);
    await member.page.getByRole('button', { name: '组织', exact: true }).click();
    await member.page.waitForTimeout(350);
    await member.page.locator('#tab-org').scrollIntoViewIfNeeded();
    await member.page.waitForTimeout(250);
    const memberOrgText = await member.page.locator('#tab-org').innerText();
    console.log('MEMBER_ORG_HAS_PREFIX', memberOrgText.includes(`[${activeName}]Official`));
    console.log('MEMBER_ORG_HAS_CHANNEL', memberOrgText.includes('议事厅'));
    await shot(member.page, 'phase-b-member-org-1440.png');
    await elementShot(member.page.locator('#tab-org'), 'phase-b-member-org-panel-1440.png');

    // 4. 组织频道出现在侧边栏，且带 ORG 标记
    await member.page.goto(WEB, { waitUntil: 'networkidle' });
    await member.page.waitForTimeout(600);
    const channelText = await member.page.locator('body').innerText();
    console.log('SIDEBAR_HAS_ORG_CHANNEL', channelText.includes('ORG ·'));
    const memberBadges = await member.page.locator('.identity-badge').allInnerTexts();
    console.log('MEMBER_BADGES', JSON.stringify(memberBadges.slice(0, 8)));
    await shot(member.page, 'phase-b-org-channel-sidebar-1440.png');
    await member.context.close();
  } finally {
    await browser.close();
  }

  console.log(
    'PHASE_B_UI_RESULT=' +
      JSON.stringify({
        ok: true,
        activeOrgId,
        pendingOrgId,
        images: images.map((file) => path.relative(ROOT, file).replaceAll('\\', '/')),
      }),
  );
}

main()
  .catch((error) => {
    console.error(`\nPHASE_B_UI_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error('cleanup failed', error));
    await prisma.$disconnect();
  });
