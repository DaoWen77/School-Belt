#!/usr/bin/env node
/** 论坛化布局验证：快报信息流 / 发布抽屉 / 朋友圈发布入口。 */
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
const stamp = Date.now().toString(36).slice(-4);
const createdIds = [];

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'user-agent': 'feed-layout-check/1.0',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function main() {
  const login = await call('/auth/login', {
    method: 'POST',
    body: { handle: 'founder', password: 'Dijiang#2026' },
  });
  const handoff = await call('/access/belt/handoff', {
    method: 'POST',
    token: login.accessToken,
    body: { next: '/belt/dispatch' },
  });
  const belt = await call('/belt/auth/handoff/exchange', {
    method: 'POST',
    body: { code: handoff.code },
  });

  const seeds = [
    ['外环第七码头的静默窗口', '中继 07 在昨夜 23:40 至 02:10 之间进入低功率静默。协议官确认这是一次计划内审计，不是断带。所有经停船只按旧航标继续通行，不要靠近未登记浮标。'],
    ['环带通行证更新：中继 07 审计周', '本周起，所有外环通行证持有者需要在任一公共中继完成一次身份回写。未回写的通行证仍可读取，但无法签发新的委托。'],
    ['关于未登记信标的回收通告', '测绘处在东侧断带发现三枚未登记信标。任何单位不得自行拆解；发现坐标请回传至环带快报，由协议官统一登记。'],
    ['夜间中继维护窗口', '中继 07 将在每日 03:00 进行十二分钟维护。维护期间只保留应急频段，请提前安排跨环带链路。'],
  ];
  for (const [title, body] of seeds) {
    const post = await call('/belt/posts', {
      method: 'POST',
      token: belt.accessToken,
      body: { board: 'bulletin', title, body },
    });
    createdIds.push(post.post.id);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1120 } });
    const page = await context.newPage();
    await page.addInitScript(
      ({ access, refresh }) => {
        localStorage.setItem('dj.belt.access', access);
        localStorage.setItem('dj.belt.refresh', refresh);
      },
      { access: belt.accessToken, refresh: belt.refreshToken },
    );
    await page.goto(`${WEB}/belt/dispatch`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const inlineTextareas = await page.locator('textarea').count();
    const publishButtons = await page.getByRole('button', { name: /发布新信号/ }).count();
    const headline = await page.locator('.belt-headline h2').count();
    const rows = await page.locator('.belt-ledger.is-compact .belt-row').count();
    console.log('INLINE_TEXTAREAS', inlineTextareas);
    console.log('PUBLISH_BUTTONS', publishButtons);
    console.log('HEADLINE', headline);
    console.log('COMPACT_ROWS', rows);

    const shot1 = path.join(ROOT, 'reports', 'frontend', 'phase-ui-belt-dispatch-1440.png');
    await page.screenshot({ path: shot1, fullPage: false });

    await page.getByRole('button', { name: /发布新信号/ }).first().click();
    await page.waitForTimeout(420);
    await page.locator('.signal-drawer input').first().fill(`测试快报：${stamp}`);
    await page.locator('.signal-drawer textarea').fill('这是一条在发布抽屉里填写的测试快报。信息流本身不再平铺发帖框。');
    await page.waitForTimeout(250);
    const drawerTextareas = await page.locator('.signal-drawer textarea').count();
    console.log('DRAWER_TEXTAREAS', drawerTextareas);
    const shot2 = path.join(ROOT, 'reports', 'frontend', 'phase-ui-belt-composer-1440.png');
    await page.screenshot({ path: shot2, fullPage: false });

    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.waitForTimeout(250);

    // 内部朋友圈：常驻发帖框应消失，只保留发布入口。
    const internalContext = await browser.newContext({ viewport: { width: 1440, height: 1120 } });
    const internal = await internalContext.newPage();
    await internal.addInitScript(
      ({ access, refresh }) => {
        localStorage.setItem('dj.access', access);
        localStorage.setItem('dj.refresh', refresh);
      },
      { access: login.accessToken, refresh: login.refreshToken },
    );
    await internal.goto(WEB, { waitUntil: 'networkidle' });
    await internal.waitForTimeout(500);
    await internal.getByRole('button', { name: '朋友圈', exact: true }).click();
    await internal.waitForTimeout(400);
    const momentsInline = await internal.locator('textarea').count();
    const momentsButton = await internal.getByRole('button', { name: /发布动态/ }).count();
    console.log('MOMENTS_INLINE_TEXTAREAS', momentsInline);
    console.log('MOMENTS_PUBLISH_BUTTONS', momentsButton);
    await internal.getByRole('button', { name: /发布动态/ }).first().click();
    await internal.waitForTimeout(420);
    const momentsDrawer = await internal.locator('.signal-drawer').count();
    console.log('MOMENTS_DRAWER', momentsDrawer);
    const shot3 = path.join(ROOT, 'reports', 'frontend', 'phase-ui-moments-composer-1440.png');
    await internal.screenshot({ path: shot3, fullPage: false });
    await internalContext.close();
    await context.close();

    console.log(
      'FEED_UI_RESULT=' +
        JSON.stringify({
          ok:
            inlineTextareas === 0 &&
            publishButtons >= 1 &&
            headline >= 1 &&
            drawerTextareas === 1 &&
            momentsInline === 0 &&
            momentsButton >= 1 &&
            momentsDrawer === 1,
          inlineTextareas,
          publishButtons,
          headline,
          rows,
          drawerTextareas,
          momentsInline,
          momentsButton,
          momentsDrawer,
          shots: [shot1, shot2, shot3].map((file) => path.relative(ROOT, file).replaceAll('\\', '/')),
        }),
    );
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    console.error(`FEED_UI_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdIds.length) {
      await prisma.post.deleteMany({ where: { id: { in: createdIds } } }).catch(() => null);
    }
    await prisma.$disconnect();
  });
