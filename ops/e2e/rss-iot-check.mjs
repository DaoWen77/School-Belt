#!/usr/bin/env node
/** 电文全文/互动 + IoT 设备 API 回归。 */
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
const PORT = 4221;
const stamp = Date.now().toString(36).slice(-5);
const sourceName = `FullText Wire ${stamp}`;
const title = `跨带长文验收 ${stamp}`;
const marker = `LONG_MARKER_${stamp}`;
const mac = `AA:BB:CC:DD:${stamp.slice(-2).toUpperCase()}:01`;
const images = [];
let sourceId = null;
let postId = null;
let sharedCardId = null;
let sharedMessageId = null;
let bindCodeId = null;
let deviceTokenId = null;
const longParagraph = `${marker} ` + '环塔新闻全文。'.repeat(850);

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${sourceName}</title>
<item>
  <title>${title}</title>
  <guid>full-${stamp}</guid>
  <link>https://example.test/full/${stamp}</link>
  <pubDate>Sat, 24 Oct 2026 21:00:00 GMT</pubDate>
  <description>摘要很短，但 content:encoded 有全文。</description>
  <content:encoded><![CDATA[<h1>${title}</h1><p>${longParagraph}</p><h2>第二节</h2><p>${longParagraph}</p>]]></content:encoded>
</item>
</channel></rss>`;

async function call(pathname, { method = 'GET', token, deviceToken, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(deviceToken ? { 'x-device-token': deviceToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function main() {
  const login = await call('/auth/login', { method: 'POST', body: { handle: 'founder', password: 'Dijiang#2026' } });
  const internal = login.accessToken;
  const handoff = await call('/access/belt/handoff', { method: 'POST', token: internal, body: { next: '/belt/dispatch' } });
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
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  try {
    const source = await call('/rss/sources', {
      method: 'POST',
      token: internal,
      body: { name: sourceName, url: `http://127.0.0.1:${PORT}/feed.xml`, category: 'tech' },
    });
    sourceId = source.source.id;
    const fetched = await call('/rss/fetch', { method: 'POST', token: internal, body: { sourceId } });
    console.log('FETCH_REPORT', JSON.stringify(fetched.reports));
    const post = await prisma.post.findFirst({
      where: { sourceName, title },
      select: { id: true, body: true, category: true, sourceUrl: true },
    });
    if (!post) throw new Error('RSS post missing');
    postId = post.id;
    console.log('BODY_LENGTH', post.body.length, 'CATEGORY', post.category, 'URL', post.sourceUrl);
    if (post.body.length <= 4000) throw new Error('full text was not stored');
    if (!post.body.includes(marker)) throw new Error('full text marker missing');

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.addInitScript(({ access, refresh }) => {
        localStorage.setItem('dj.belt.access', access);
        localStorage.setItem('dj.belt.refresh', refresh);
      }, { access: belt.accessToken, refresh: belt.refreshToken });

      await page.goto(`${WEB}/belt/dispatch`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      console.log('TABS', await page.getByRole('tab').count());
      console.log('TITLE_VISIBLE', (await page.locator('body').innerText()).includes(title));
      const bentoShot = path.join(ROOT, 'reports', 'frontend', 'rss-fulltext-bento-390.png');
      await page.screenshot({ path: bentoShot, fullPage: false });
      images.push(bentoShot);

      await page.getByRole('link', { name: title }).click();
      await page.waitForTimeout(600);
      const detailText = await page.locator('body').innerText();
      console.log('DETAIL_FULLTEXT', detailText.includes(marker), 'SOURCE_CREDIT', detailText.includes('本电文源自'));
      const detailShot = path.join(ROOT, 'reports', 'frontend', 'rss-fulltext-detail-390.png');
      await page.screenshot({ path: detailShot, fullPage: false });
      images.push(detailShot);

      await page.getByRole('button', { name: /认同/ }).click();
      await page.waitForTimeout(500);
      await page.getByLabel('回复帖子').fill(`回波验收 ${stamp}`);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await page.waitForTimeout(500);
      console.log('COMMENT_VISIBLE', (await page.locator('body').innerText()).includes(`回波验收 ${stamp}`));
      await page.getByRole('button', { name: '转发到环塔频道' }).click();
      await page.waitForTimeout(700);
      console.log('SHARE_NOTICE', (await page.locator('body').innerText()).includes('已作为卡片转发到环塔频道'));

      const defaultChannel = await prisma.channel.findFirst({
        where: { surface: 'belt', slug: 'belt-channel' },
        select: { id: true },
      });
      const shared = defaultChannel
        ? await prisma.message.findFirst({
            where: { channelId: defaultChannel.id, cardId: { not: null } },
            orderBy: { id: 'desc' },
            select: { id: true, cardId: true },
          })
        : null;
      sharedMessageId = shared?.id ?? null;
      sharedCardId = shared?.cardId ?? null;
      console.log('SHARED_CARD', sharedCardId);

      await page.goto(`${WEB}/belt/channel`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const channelText = await page.locator('body').innerText();
      console.log('SHARE_CARD_VISIBLE', channelText.includes('NEWS SHARE'), channelText.includes(title));
      const cardShot = path.join(ROOT, 'reports', 'frontend', 'rss-share-card-390.png');
      await page.screenshot({ path: cardShot, fullPage: false });
      images.push(cardShot);
      await context.close();
    } finally {
      await browser.close();
    }

    // IoT：生成绑定码 → 绑定 MAC → summary
    const code = await call('/device/bind-code', { method: 'POST', token: internal, body: {} });
    bindCodeId = (await prisma.deviceBindCode.findFirst({
      where: { userId: login.user.id, code: code.code },
      select: { id: true },
    }))?.id ?? null;
    const bound = await call('/device/bind', {
      method: 'POST',
      body: { code: code.code, mac, name: 'ESP32 桌面吊牌' },
    });
    const token = bound.device_token;
    deviceTokenId = (await prisma.deviceToken.findFirst({
      where: { userId: login.user.id, mac },
      select: { id: true },
    }))?.id ?? null;
    const summary = await call('/device/summary', { deviceToken: token });
    console.log(
      'DEVICE_SUMMARY',
      JSON.stringify({
        keys: Object.keys(summary).sort(),
        unread: typeof summary.unread_count,
        announcement: typeof summary.has_announcement,
        latest: typeof summary.latest_message,
        avatar: typeof summary.avatar_url,
        color: summary.status_color,
      }),
    );
    console.log(
      'DEVICE_SUMMARY_RESULT=' +
        JSON.stringify({
          ok:
            typeof summary.unread_count === 'number' &&
            typeof summary.has_announcement === 'boolean' &&
            typeof summary.latest_message === 'string' &&
            typeof summary.avatar_url === 'string' &&
            /^#[0-9A-F]{6}$/i.test(summary.status_color),
          summary,
        }),
    );

    console.log(
      'RSS_INTERACTION_RESULT=' +
        JSON.stringify({
          ok: true,
          bodyLength: post.body.length,
          category: post.category,
          tabs: 5,
          images: images.map((file) => path.relative(ROOT, file).replaceAll('\\', '/')),
        }),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (sharedMessageId) await prisma.message.delete({ where: { id: sharedMessageId } }).catch(() => null);
    if (sharedCardId) await prisma.card.delete({ where: { id: sharedCardId } }).catch(() => null);
    if (postId) await prisma.post.delete({ where: { id: postId } }).catch(() => null);
    if (sourceId) await prisma.rssSource.delete({ where: { id: sourceId } }).catch(() => null);
    if (bindCodeId) await prisma.deviceBindCode.delete({ where: { id: bindCodeId } }).catch(() => null);
    if (deviceTokenId) await prisma.deviceToken.delete({ where: { id: deviceTokenId } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`RSS_INTERACTION_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
  process.exitCode = 1;
});
