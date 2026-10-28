#!/usr/bin/env node
/**
 * Phase D UI 证据：
 *   - 内部好友申请 / 同意 / DM 出现在侧边栏
 *   - 悬赏详情【建立联络】→ 跨面 bridge 申请
 *   - 环塔私聊链路页；bridge DM 双方可见
 */
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
const extHandle = `probe_du_${stamp}`;
const extPassword = 'ProbeDU#2026';
const bountyTitle = `D视觉悬赏${stamp}`;
const images = [];
let internalFriendshipId = null;
let internalDmId = null;
let bridgeFriendshipId = null;
let bridgeDmId = null;
let bountyId = null;

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'user-agent': 'phase-d-ui/1.0',
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
  const data = await call('/auth/login', { method: 'POST', body: { handle, password: 'Dijiang#2026' } });
  return { token: data.accessToken, refresh: data.refreshToken, user: data.user };
}

async function beltFromInternal(token, next = '/belt/channel') {
  const handoff = await call('/access/belt/handoff', { method: 'POST', token, body: { next } });
  const exchange = await call('/belt/auth/handoff/exchange', {
    method: 'POST',
    body: { code: handoff.code },
  });
  return { token: exchange.accessToken, refresh: exchange.refreshToken, user: exchange.user };
}

async function cleanup() {
  const channelIds = [internalDmId, bridgeDmId].filter(Boolean);
  const friendshipIds = [internalFriendshipId, bridgeFriendshipId].filter(Boolean);
  if (channelIds.length) {
    await prisma.message.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.channelMember.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
  }
  if (friendshipIds.length) {
    await prisma.friendship.deleteMany({ where: { id: { in: friendshipIds } } });
  }
  const posts = await prisma.post.findMany({
    where: { title: { startsWith: bountyTitle } },
    select: { id: true },
  });
  if (posts.length) {
    await prisma.post.deleteMany({ where: { id: { in: posts.map((post) => post.id) } } });
  }
  await prisma.user.deleteMany({ where: { handle: extHandle } });
}

async function pageWithTokens(browser, tokens) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  await page.addInitScript(
    ({ beltAccess, beltRefresh, access, refresh }) => {
      if (beltAccess) localStorage.setItem('dj.belt.access', beltAccess);
      if (beltRefresh) localStorage.setItem('dj.belt.refresh', beltRefresh);
      if (access) localStorage.setItem('dj.access', access);
      if (refresh) localStorage.setItem('dj.refresh', refresh);
    },
    {
      beltAccess: tokens.belt?.token ?? null,
      beltRefresh: tokens.belt?.refresh ?? null,
      access: tokens.internal?.token ?? null,
      refresh: tokens.internal?.refresh ?? null,
    },
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

async function main() {
  await cleanup();

  const chen = await login('chen');
  const yue = await login('yue');
  const chenBelt = await beltFromInternal(chen.token);
  const extReg = await call('/belt/auth/register', {
    method: 'POST',
    body: { handle: extHandle, displayName: `D外环${stamp.slice(-3)}`, password: extPassword },
  });
  const ext = {
    token: extReg.accessToken,
    refresh: extReg.refreshToken,
    user: extReg.user,
  };

  // 内部好友：chen → lin
  const request = await call('/friendships/requests', {
    method: 'POST',
    token: chen.token,
    body: { handle: 'yue', note: 'D 阶段视觉验收内部链路' },
  });
  internalFriendshipId = request.friendship.id;

  const bounty = await call('/belt/posts', {
    method: 'POST',
    token: chenBelt.token,
    body: {
      board: 'bounty',
      title: bountyTitle,
      body: '需要回收一枚外环测绘浮标，坐标在中继东侧断带。',
      bountyReward: '900 环塔券',
      bountyDeadline: new Date(Date.now() + 86400000 * 2).toISOString(),
    },
  });
  bountyId = bounty.post.id;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // 1. yue 设置 → 好友：收到申请
    const yuePage = await pageWithTokens(browser, { internal: yue });
    await yuePage.page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
    await yuePage.page.waitForTimeout(500);
    await yuePage.page.getByRole('button', { name: '好友', exact: true }).click();
    await yuePage.page.waitForTimeout(350);
    await yuePage.page.locator('#tab-friends').scrollIntoViewIfNeeded();
    await yuePage.page.waitForTimeout(250);
    const incomingText = await yuePage.page.locator('#tab-friends').innerText();
    console.log('INCOMING_VISIBLE', incomingText.includes('@chen'));
    await shot(yuePage.page, 'phase-d-internal-friend-incoming-1440.png');
    const accept = yuePage.page.locator('#tab-friends').getByRole('button', { name: '同意', exact: true }).first();
    await accept.click();
    await yuePage.page.waitForTimeout(900);
    console.log('ACCEPTED_TEXT', (await yuePage.page.locator('#tab-friends').innerText()).includes('私聊已建立'));
    const acceptedFriends = await call('/friendships', { token: yue.token });
    const acceptedInternal = acceptedFriends.friends.find((row) => row.peer.handle === 'chen');
    internalDmId = acceptedInternal?.dmChannelId ?? null;
    console.log('INTERNAL_DM_ID', internalDmId);
    await yuePage.context.close();

    // 2. chen 主界面：内部 DM 已出现在侧边栏
    const chenPage = await pageWithTokens(browser, { internal: chen, belt: chenBelt });
    await chenPage.page.goto(WEB, { waitUntil: 'networkidle' });
    await chenPage.page.waitForTimeout(900);
    const chenText = await chenPage.page.locator('body').innerText();
    console.log('INTERNAL_DM_VISIBLE', chenText.includes('岳调度'));
    await shot(chenPage.page, 'phase-d-internal-dm-sidebar-1440.png');

    // 3. 外环账号在悬赏详情点【建立联络】
    const extPage = await pageWithTokens(browser, { belt: ext });
    await extPage.page.goto(`${WEB}/belt/posts/${bountyId}`, { waitUntil: 'networkidle' });
    await extPage.page.waitForTimeout(500);
    await extPage.page.getByRole('button', { name: '建立联络', exact: true }).click();
    await extPage.page.waitForTimeout(700);
    const contactText = await extPage.page.locator('body').innerText();
    console.log('CONTACT_REQUESTED', contactText.includes('链路申请已发出'));
    await shot(extPage.page, 'phase-d-bounty-contact-1440.png');

    // 4. chen 侧接受 bridge 申请（API），检查内部 bridge DM
    const chenFriends = await call('/friendships', { token: chen.token });
    const bridge = chenFriends.incoming.find((row) => row.surface === 'bridge');
    if (!bridge) throw new Error('bridge incoming not found');
    bridgeFriendshipId = bridge.id;
    const accepted = await call(`/friendships/${bridgeFriendshipId}`, {
      method: 'PATCH',
      token: chen.token,
      body: { action: 'accept' },
    });
    bridgeDmId = accepted.friendship.dmChannelId;
    await chenPage.page.reload({ waitUntil: 'networkidle' });
    await chenPage.page.waitForTimeout(700);
    const bridgeSidebar = await chenPage.page.locator('body').innerText();
    console.log('INTERNAL_BRIDGE_VISIBLE', bridgeSidebar.includes('BRIDGE'));
    await shot(chenPage.page, 'phase-d-internal-bridge-sidebar-1440.png');

    // 5. 外环私聊链路页
    const extDirect = await pageWithTokens(browser, { belt: ext });
    await extDirect.page.goto(`${WEB}/belt/direct`, { waitUntil: 'networkidle' });
    await extDirect.page.waitForTimeout(700);
    const directText = await extDirect.page.locator('body').innerText();
    console.log('BELT_DIRECT_VISIBLE', directText.includes('私聊 / DIRECT'));
    console.log('BELT_BRIDGE_VISIBLE', directText.includes('BRIDGE'));
    await shot(extDirect.page, 'phase-d-belt-direct-1440.png');
    await extDirect.context.close();
    await extPage.context.close();
    await chenPage.context.close();
  } finally {
    await browser.close();
  }

  console.log(
    'PHASE_D_UI_RESULT=' +
      JSON.stringify({
        ok: true,
        internalFriendshipId,
        internalDmId,
        bridgeFriendshipId,
        bridgeDmId,
        bountyId,
        images: images.map((file) => path.relative(ROOT, file).replaceAll('\\', '/')),
      }),
  );
}

main()
  .catch((error) => {
    console.error(`\nPHASE_D_UI_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error('cleanup failed', error));
    await prisma.$disconnect();
  });
