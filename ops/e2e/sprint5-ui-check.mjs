#!/usr/bin/env node
/** Sprint5 / Phase E UI 证据：新闻塔源管理 + 环带电文 RSS 拼贴。 */
import { createServer } from 'node:http';
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
const FEED_PORT = 4218;
const FEED_URL = `http://127.0.0.1:${FEED_PORT}/feed.xml`;
const stamp = Date.now().toString(36).slice(-5);
const sourceName = '36Kr';
const titles = ['外环物流网络进入低功耗调度', '新型中继天线完成首次跨带测试', '协议官发布未登记信标回收指引'];
const images = [];
let sourceId = null;
let internalToken = null;

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'user-agent': 'sprint5-ui/1.0',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${sourceName}</title>
<item><title>${titles[0]}</title><guid>ui-a-${stamp}</guid><link>https://example.test/a</link><pubDate>Fri, 24 Oct 2026 20:20:00 GMT</pubDate><description>多家运输节点开始采用夜间低功耗调度。</description></item>
<item><title>${titles[1]}</title><guid>ui-b-${stamp}</guid><link>https://example.test/b</link><pubDate>Fri, 24 Oct 2026 20:10:00 GMT</pubDate><description>测试信号在断带边缘保持了十七分钟。</description></item>
<item><title>${titles[2]}</title><guid>ui-c-${stamp}</guid><link>https://example.test/c</link><pubDate>Fri, 24 Oct 2026 20:00:00 GMT</pubDate><description>指引要求所有单位不得自行拆解未登记信标。</description></item>
</channel></rss>`;

async function main() {
  const login = await call('/auth/login', { method: 'POST', body: { handle: 'founder', password: 'Dijiang#2026' } });
  internalToken = login.accessToken;
  const handoff = await call('/access/belt/handoff', {
    method: 'POST',
    token: internalToken,
    body: { next: '/belt/dispatch' },
  });
  const belt = await call('/belt/auth/handoff/exchange', { method: 'POST', body: { code: handoff.code } });

  const server = createServer((request, response) => {
    if (request.url === '/feed.xml') {
      response.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
      response.end(feed);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(FEED_PORT, '127.0.0.1', resolve));

  try {
    const created = await call('/rss/sources', {
      method: 'POST',
      token: internalToken,
      body: { name: sourceName, url: FEED_URL },
    });
    sourceId = created.source.id;
    const fetched = await call('/rss/fetch', { method: 'POST', token: internalToken, body: {} });
    console.log('FETCH', JSON.stringify(fetched.reports));

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const internal = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const page = await internal.newPage();
      await page.addInitScript(({ access, refresh }) => {
        localStorage.setItem('dj.access', access);
        localStorage.setItem('dj.refresh', refresh);
      }, { access: login.accessToken, refresh: login.refreshToken });
      await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: '新闻塔', exact: true }).first().click();
      await page.waitForTimeout(400);
      await page.locator('#tab-rss').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      console.log('RSS_SETTINGS_VISIBLE', (await page.locator('#tab-rss').innerText()).includes(sourceName));
      const settingsShot = path.join(ROOT, 'reports', 'frontend', 'sprint5-rss-settings-390.png');
      await page.screenshot({ path: settingsShot, fullPage: false });
      images.push(settingsShot);
      await internal.close();

      const beltContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const beltPage = await beltContext.newPage();
      await beltPage.addInitScript(({ access, refresh }) => {
        localStorage.setItem('dj.belt.access', access);
        localStorage.setItem('dj.belt.refresh', refresh);
      }, { access: belt.accessToken, refresh: belt.refreshToken });
      await beltPage.goto(`${WEB}/belt/dispatch`, { waitUntil: 'networkidle' });
      await beltPage.waitForTimeout(900);
      const text = await beltPage.locator('body').innerText();
      console.log('RSS_TELEGRAPH_VISIBLE', titles.every((title) => text.includes(title)));
      console.log('RSS_SOURCE_LABEL', text.includes('INTERCEPT /'));
      const beltShot = path.join(ROOT, 'reports', 'frontend', 'sprint5-belt-rss-390.png');
      await beltPage.screenshot({ path: beltShot, fullPage: false });
      images.push(beltShot);
      await beltContext.close();
    } finally {
      await browser.close();
    }

    console.log(
      'SPRINT5_UI_RESULT=' +
        JSON.stringify({
          ok: true,
          images: images.map((file) => path.relative(ROOT, file).replaceAll('\\', '/')),
        }),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (sourceId && internalToken) {
      await call(`/rss/sources/${sourceId}`, { method: 'DELETE', token: internalToken }).catch(() => null);
    }
    await prisma.post.deleteMany({ where: { sourceName } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`SPRINT5_UI_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
  process.exitCode = 1;
});
