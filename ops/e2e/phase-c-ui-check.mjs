#!/usr/bin/env node
/**
 * Phase C UI 证据：
 *   - 环带登录 / 频道 / 快报 / 悬赏 / 日常 / 帖子详情
 *   - belt WS 实时事件
 *   - 内部 1.5s 终端过场 → /belt/handoff
 *   - 外网身份 3s 红色拒绝 → 回环带
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const requireServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const requireWeb = createRequire(path.join(ROOT, 'web', 'package.json'));
const { PrismaClient } = requireServer('@prisma/client');
const { io } = requireWeb('socket.io-client');
const prisma = new PrismaClient();

const API = 'http://127.0.0.1:3000/api/v1';
const WEB = 'http://127.0.0.1:3100';
const stamp = Date.now().toString(36).slice(-5);
const prefix = `C视觉${stamp}`;
const externalHandle = `probe_cv_${stamp}`;
const externalPassword = 'ProbeCV#2026';
const messageMarker = `[PHASE-C-UI] ${stamp}`;
const images = [];
let dailyId = null;
let bulletinId = null;
let bountyId = null;

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'user-agent': 'phase-c-ui/1.0',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function login(handle, password = 'Dijiang#2026') {
  const data = await call('/auth/login', { method: 'POST', body: { handle, password } });
  return { token: data.accessToken, refresh: data.refreshToken };
}

async function beltFromInternal(internalToken) {
  const handoff = await call('/access/belt/handoff', {
    method: 'POST',
    token: internalToken,
    body: { next: '/belt/channel' },
  });
  const exchange = await call('/belt/auth/handoff/exchange', {
    method: 'POST',
    body: { code: handoff.code },
  });
  return { token: exchange.accessToken, refresh: exchange.refreshToken };
}

async function cleanup() {
  const posts = await prisma.post.findMany({
    where: { title: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = posts.map((post) => post.id);
  if (ids.length > 0) {
    await prisma.postLike.deleteMany({ where: { postId: { in: ids } } });
    await prisma.postComment.deleteMany({ where: { postId: { in: ids } } });
    await prisma.post.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.message.deleteMany({ where: { body: { startsWith: messageMarker } } });
  await prisma.user.deleteMany({ where: { handle: externalHandle } });
}

async function pageWithTokens(browser, tokens) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  await page.addInitScript(
    ({ beltAccess, beltRefresh, access, refresh }) => {
      if (beltAccess) window.localStorage.setItem('dj.belt.access', beltAccess);
      if (beltRefresh) window.localStorage.setItem('dj.belt.refresh', beltRefresh);
      if (access) window.localStorage.setItem('dj.access', access);
      if (refresh) window.localStorage.setItem('dj.refresh', refresh);
    },
    {
      beltAccess: tokens.belt?.token ?? null,
      beltRefresh: tokens.belt?.refresh ?? null,
      access: tokens.internal?.token ?? null,
      refresh: tokens.internal?.refresh ?? null,
    },
  );
  page.on('pageerror', (error) => console.log('PAGE_ERROR', error.message.slice(0, 200)));
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

  const founder = await login('founder');
  const founderBelt = await beltFromInternal(founder.token);

  await call('/belt/channels', { token: founderBelt.token });
  const channels = await call('/belt/channels', { token: founderBelt.token });
  const channelId = channels.channels[0]?.id;
  if (!channelId) throw new Error('no belt channel');
  for (const body of [
    `${messageMarker} 外环中继在线。`,
    `${messageMarker} 载波锁定 1420.7 kHz。`,
    `${messageMarker} 所有外环身份可在此发言。`,
  ]) {
    await call(`/belt/channels/${channelId}/messages`, {
      method: 'POST',
      token: founderBelt.token,
      body: { body },
    });
  }

  const bulletin = await call('/belt/posts', {
    method: 'POST',
    token: founderBelt.token,
    body: {
      board: 'bulletin',
      title: `${prefix} 环带快报 · 中继恢复`,
      body: '外环中继 07 已恢复。所有在册身份可接入公共频段，跨环带联络仍受协议限制。',
    },
  });
  bulletinId = bulletin.post.id;

  const bounty = await call('/belt/posts', {
    method: 'POST',
    token: founderBelt.token,
    body: {
      board: 'bounty',
      title: `${prefix} 回收外环测绘浮标`,
      body: '需要一名熟悉外环航路的人回收失联测绘浮标。坐标在中继站东侧断带。',
      bountyReward: '1200 环带券',
      bountyDeadline: new Date(Date.now() + 86400000 * 3).toISOString(),
    },
  });
  bountyId = bounty.post.id;

  const daily = await call('/belt/posts', {
    method: 'POST',
    token: founderBelt.token,
    body: {
      board: 'daily',
      title: `${prefix} 外环值班记录`,
      body: '今日环带信号稳定。听得到远处中继的载波，像有人在敲金属墙。',
    },
  });
  dailyId = daily.post.id;
  await call(`/belt/posts/${dailyId}/comments`, {
    method: 'POST',
    token: founderBelt.token,
    body: { body: '回波确认：中继东侧有微弱载波。' },
  });

  const external = await call('/belt/auth/register', {
    method: 'POST',
    body: {
      handle: externalHandle,
      displayName: `外环C${stamp.slice(-3)}`,
      password: externalPassword,
    },
  });
  const externalBelt = { token: external.accessToken, refresh: external.refreshToken };

  // WS 验证：连接 /ws/belt，等一条 REST 发出的消息
  const ws = io('http://127.0.0.1:3000/ws/belt', {
    auth: { token: founderBelt.token },
    transports: ['websocket'],
    timeout: 8000,
  });
  const wsReady = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('belt ws timeout')), 8000);
    ws.on('belt:ready', () => {
      clearTimeout(timer);
      resolve(true);
    });
    ws.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(new Error(`belt ws error: ${error.message}`));
    });
  });
  console.log('BELT_WS_READY', wsReady);
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('belt ws message timeout')), 5000);
    ws.on('belt:message', (payload) => {
      if (String(payload?.body ?? '').includes(messageMarker)) {
        clearTimeout(timer);
        resolve(payload);
      }
    });
  });
  await call(`/belt/channels/${channelId}/messages`, {
    method: 'POST',
    token: founderBelt.token,
    body: { body: `${messageMarker} 实时回环测试。` },
  });
  const wsMessage = await received;
  console.log('BELT_WS_MESSAGE', wsMessage.id);
  ws.disconnect();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // 登录页
    const anon = await pageWithTokens(browser, {});
    await anon.page.goto(`${WEB}/belt/login`, { waitUntil: 'networkidle' });
    await anon.page.waitForTimeout(500);
    await shot(anon.page, 'phase-c-belt-login-1440.png');
    await anon.context.close();

    // 频道 / 快报 / 悬赏 / 日常 / 帖子详情
    const belt = await pageWithTokens(browser, { belt: founderBelt });
    await belt.page.goto(`${WEB}/belt/channel`, { waitUntil: 'networkidle' });
    await belt.page.waitForTimeout(900);
    const channelImage = path.join(ROOT, 'reports', 'frontend', 'phase-c-belt-channel-1440.png');
    await belt.page.screenshot({ path: channelImage });
    images.push(channelImage);
    console.log('SHOT', channelImage);
    console.log(
      'OWNER_BADGE_IN_BELT',
      (await belt.page.locator('.identity-badge').allInnerTexts()).includes('[极光科技]Official'),
    );
    const channelText = await belt.page.locator('body').innerText();
    console.log('CHANNEL_HAS_SIGNAL', channelText.includes(messageMarker));

    for (const [route, name] of [
      ['/belt/dispatch', 'phase-c-belt-dispatch-1440.png'],
      ['/belt/bounty', 'phase-c-belt-bounty-1440.png'],
      ['/belt/daily', 'phase-c-belt-daily-1440.png'],
      ['/belt/telegraph', 'phase-c-belt-telegraph-1440.png'],
    ]) {
      await belt.page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
      await belt.page.waitForTimeout(450);
      await shot(belt.page, name);
    }

    await belt.page.goto(`${WEB}/belt/posts/${dailyId}`, { waitUntil: 'networkidle' });
    await belt.page.waitForTimeout(500);
    await shot(belt.page, 'phase-c-belt-post-1440.png');
    console.log('POST_DETAIL_HAS_TITLE', (await belt.page.locator('body').innerText()).includes(prefix));

    // 内部 → 环带：1.5s 终端过场
    await belt.page.goto(`${WEB}/belt/access`, { waitUntil: 'networkidle' });
    await belt.page.waitForTimeout(400);
    await shot(belt.page, 'phase-c-belt-access-1440.png');

    const inner = await pageWithTokens(browser, { internal: founder });
    await inner.page.goto(WEB, { waitUntil: 'networkidle' });
    await inner.page.waitForTimeout(700);
    const entry = inner.page.getByRole('button', { name: /接入文明环带/ }).first();
    await entry.click();
    await inner.page.waitForTimeout(720);
    await shot(inner.page, 'phase-c-internal-entry-1440.png');
    console.log(
      'ENTRY_LINES',
      (await inner.page.locator('.belt-entry').innerText()).replace(/\s+/g, ' ').slice(0, 180),
    );
    await inner.page.waitForTimeout(900);
    console.log('ENTRY_URL_AFTER_1500', inner.page.url());
    await inner.page.waitForTimeout(1200);
    console.log('ENTRY_URL_AFTER_HANDOFF', inner.page.url());
    await inner.context.close();
    await belt.context.close();

    // 外网拒绝
    const denied = await pageWithTokens(browser, { belt: externalBelt });
    await denied.page.goto(`${WEB}/belt/access`, { waitUntil: 'networkidle' });
    await denied.page.waitForTimeout(500);
    await denied.page.getByRole('button', { name: /登入 O\.M\.V 帝江号/ }).click();
    await denied.page.waitForTimeout(280);
    const denialText = await denied.page.locator('.belt-denial').innerText();
    console.log('DENIAL_HAS_PROTOCOL', denialText.includes('PROTOCOL DENIED') || denialText.includes('协议拒绝'));
    await shot(denied.page, 'phase-c-denial-1440.png');
    await denied.page.waitForTimeout(3200);
    console.log('DENIAL_RETURN_URL', denied.page.url());
    await denied.context.close();
  } finally {
    await browser.close();
  }

  console.log(
    'PHASE_C_UI_RESULT=' +
      JSON.stringify({
        ok: true,
        dailyId,
        bulletinId,
        bountyId,
        images: images.map((file) => path.relative(ROOT, file).replaceAll('\\', '/')),
      }),
  );
}

main()
  .catch((error) => {
    console.error(`\nPHASE_C_UI_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error('cleanup failed', error));
    await prisma.$disconnect();
  });
