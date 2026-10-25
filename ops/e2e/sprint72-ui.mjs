#!/usr/bin/env node
/** Sprint 7.2 UI 截图与冒烟：环带聊天头像/图片、分享 Sheet、ZZZ 日常。 */
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
const imagePath = path.join(ROOT, 'reports', 'frontend', 'test-avatar-7-1.png');
const dailyIds = [];
let channelMessageId = null;
let uploadedFileId = null;

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
  const login = await call('/auth/login', { method: 'POST', body: { handle: 'founder', password: 'Dijiang#2026' } });
  const internal = login.accessToken;
  const handoff = await call('/access/belt/handoff', { method: 'POST', token: internal, body: { next: '/belt/daily' } });
  const belt = await call('/belt/auth/handoff/exchange', { method: 'POST', body: { code: handoff.code } });

  const bulletin = await call('/belt/posts?board=bulletin&limit=1', { token: belt.accessToken });
  const post = bulletin.posts[0];
  if (!post) throw new Error('missing bulletin post');

  for (let index = 0; index < 3; index += 1) {
    const created = await call('/belt/posts', {
      method: 'POST',
      token: belt.accessToken,
      body: {
        board: 'daily',
        title: ['夜航日志', '耳机里的城市', '凌晨三点的霓虹'][index] + ` ${stamp}`,
        body: [
          '今天也没睡。把窗外的雨声录成一段信号，明天再剪。',
          '在地铁末班车上听完了整张 OST，城市像一条缓慢发光的电路。',
          '绳网又刷新了一轮。有人约早八，有人约午夜。',
        ][index],
      },
    });
    dailyIds.push(created.post.id);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
  const page = await context.newPage();
  await page.addInitScript(({ access, refresh }) => {
    localStorage.setItem('dj.belt.access', access);
    localStorage.setItem('dj.belt.refresh', refresh);
  }, { access: belt.accessToken, refresh: belt.refreshToken });

  // 1. 环带频道：发送图片，检查头像与媒体卡片
  await page.goto(`${WEB}/belt/channel`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.locator('input[type=file]').setInputFiles(imagePath);
  await page.waitForTimeout(300);
  await page.locator('.belt-attachment-chip').waitFor({ timeout: 8000 });
  console.log('ATTACHMENT_READY', (await page.locator('.belt-attachment-chip').count()) > 0);
  await page.getByLabel('环带频道消息').fill(`附图信号 ${stamp}`);
  await page.getByRole('button', { name: 'TRANSMIT', exact: true }).click();
  await page.waitForTimeout(900);
  const chatText = await page.locator('body').innerText();
  console.log('MESSAGE_VISIBLE', chatText.includes(`附图信号 ${stamp}`));
  console.log('MEDIA_VISIBLE', (await page.locator('.belt-message-media img').count()) > 0);
  console.log('AVATAR_VISIBLE', (await page.locator('.belt-message .belt-avatar img').count()) > 0);
  await page.screenshot({ path: path.join(ROOT, 'reports', 'frontend', 'sprint72-chat-390.png'), fullPage: false });

  // 2. 新闻详情分享 ActionSheet
  await page.goto(`${WEB}/belt/posts/${post.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '转发 / SHARE', exact: true }).click();
  await page.waitForTimeout(300);
  const sheetText = await page.locator('body').innerText();
  console.log('SHARE_SHEET', ['复制链接', '发送到频道', '发送给好友'].every((label) => sheetText.includes(label)));
  await page.screenshot({ path: path.join(ROOT, 'reports', 'frontend', 'sprint72-share-sheet-390.png'), fullPage: false });
  await page.getByRole('button', { name: /复制链接/ }).click();
  await page.waitForTimeout(250);
  console.log('COPY_NOTICE', (await page.locator('body').innerText()).includes('链路已复制'));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(200);

  // 3. 干员日常 ZZZ
  await page.goto(`${WEB}/belt/daily`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const dailyText = await page.locator('body').innerText();
  console.log('DAILY_HERO', dailyText.includes('干员') && dailyText.includes('日常'));
  console.log('DAILY_CARDS', await page.locator('.belt-daily-card').count());
  console.log('DAILY_FAB', await page.getByRole('button', { name: '发布干员日常' }).count());
  await page.screenshot({ path: path.join(ROOT, 'reports', 'frontend', 'sprint72-daily-390.png'), fullPage: false });

  const beltChannel = await prisma.channel.findFirst({
    where: { surface: 'belt', slug: 'belt-channel' },
    select: { id: true },
  });
  const messages = beltChannel
    ? await prisma.message.findMany({
        where: { channelId: beltChannel.id, body: { contains: `附图信号 ${stamp}` } },
        select: { id: true },
      })
    : [];
  channelMessageId = messages[0]?.id ?? null;
  if (channelMessageId) {
    const attachments = await prisma.attachment.findMany({ where: { messageId: channelMessageId }, select: { fileId: true } });
    uploadedFileId = attachments[0]?.fileId ?? null;
  }
  console.log('RESULT=' + JSON.stringify({ ok: true, dailyIds, channelMessageId: channelMessageId?.toString() ?? null, uploadedFileId }));
  await context.close();
  await browser.close();
}

main()
  .catch((error) => {
    console.error('RESULT=' + JSON.stringify({ ok: false, error: String(error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (channelMessageId) {
      const attachments = await prisma.attachment.findMany({ where: { messageId: channelMessageId }, select: { fileId: true } });
      await prisma.attachment.deleteMany({ where: { messageId: channelMessageId } }).catch(() => null);
      await prisma.message.delete({ where: { id: channelMessageId } }).catch(() => null);
      for (const row of attachments) await prisma.file.delete({ where: { id: row.fileId } }).catch(() => null);
    }
    if (dailyIds.length) await prisma.post.deleteMany({ where: { id: { in: dailyIds } } }).catch(() => null);
    await prisma.$disconnect();
  });
