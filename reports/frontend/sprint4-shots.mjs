/**
 * Sprint4 截图/冒烟：朋友圈、常驻播放器、档案室 Scramble、活动雷达、/ping、sudo 彩蛋。
 * 真实 API 3000；只跑本 Sprint 截图，不跑全量。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), 'ops', 'e2e', 'node_modules', 'playwright-core'));

const OUT = path.join(process.cwd(), 'reports', 'frontend');
const BASE = 'http://localhost:3100';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HANDLE = process.env.SEED_HANDLE || 'lin';
const PASSWORD = process.env.SEED_PASSWORD || 'Dijiang#2026';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const report = { shots: {}, checks: {}, errors: [], pageErrors: [], failedRequests: [] };

function watch(target) {
  target.on('console', (message) => message.type() === 'error' && report.errors.push(message.text().slice(0, 400)));
  target.on('pageerror', (error) => report.pageErrors.push(String(error).slice(0, 400)));
  target.on('response', (response) => {
    if (response.status() >= 400) report.failedRequests.push({ status: response.status(), url: response.url().slice(0, 220) });
  });
}
watch(page);

async function login(target) {
  await target.goto(`${BASE}/login`);
  await target.fill('input[autocomplete="username"]', HANDLE);
  await target.fill('input[type="password"]', PASSWORD);
  await target.click('button[type="submit"]');
  await target.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await target.waitForTimeout(2200);
}
const shot = async (name, target = page) => {
  const file = path.join(OUT, name);
  await target.screenshot({ path: file });
  report.shots[name] = file;
  console.log('SHOT', name);
};

try {
  await login(page);

  /* 雷达 + 播放器 */
  await page.waitForTimeout(2200);
  report.checks.radar = await page.evaluate(() => ({
    hud: document.body.innerText.includes('态势 HUD'),
    radarSvg: document.querySelectorAll('.recharts-wrapper svg, .recharts-surface').length,
    metrics: [...document.querySelectorAll('aside strong')].map((node) => node.textContent?.trim()).slice(0, 5),
  }));
  report.checks.player = await page.evaluate(() => ({
    bar: document.body.innerText.includes('音量') || Boolean(document.querySelector('audio')),
    hasAudio: Boolean(document.querySelector('audio')),
    queueText: [...document.querySelectorAll('p')].map((node) => node.textContent ?? '').find((text) => text.includes('首队列') || text.includes('音乐')) ?? null,
    audioSrc: document.querySelector('audio')?.getAttribute('src') ?? null,
  }));
  await shot('sprint4-player-radar-1440.png');

  /* 朋友圈 */
  await page.click('aside button:text-is("朋友圈")');
  await page.waitForTimeout(1000);
  report.checks.momentsOpen = await page.evaluate(() => ({
    hasComposer: Boolean(document.querySelector('textarea[aria-label="朋友圈正文"]')),
    header: document.querySelector('header h1')?.textContent ?? null,
  }));
  await shot('sprint4-moments-1440.png');

  const postBody = `Sprint4 朋友圈验收 ${Date.now()}`;
  await page.fill('textarea[aria-label="朋友圈正文"]', postBody);
  const imageInput = page.locator('input[type="file"]').first();
  await imageInput.setInputFiles(path.join(OUT, 'sprint1-avatar-source.png'));
  await page.waitForTimeout(3000);
  await page.click('button:text-is("发布")');
  await page.waitForTimeout(2500);
  report.checks.postCreated = await page.evaluate((text) => ({
    found: document.body.innerText.includes(text),
    likes: [...document.querySelectorAll('article button')].map((button) => button.textContent?.trim()).filter(Boolean).slice(0, 8),
  }), postBody);
  const likeButton = page.locator('article button').filter({ hasText: '♡' }).first();
  if (await likeButton.count()) {
    await likeButton.click();
    await page.waitForTimeout(800);
  }
  const article = page.locator('article').filter({ hasText: postBody }).first();
  if (await article.count()) {
    await article.locator('button', { hasText: '评论' }).click();
    await page.waitForTimeout(300);
    await article.locator('input[aria-label="评论输入"]').fill('Sprint4 评论');
    await article.locator('button', { hasText: '发表' }).click();
    await page.waitForTimeout(1200);
  }
  report.checks.postInteractions = await page.evaluate((text) => {
    const article = [...document.querySelectorAll('article')].find((node) => node.textContent?.includes(text));
    return { text: article?.innerText.replace(/\n/g, ' | ').slice(0, 300) ?? null };
  }, postBody);
  await shot('sprint4-post-1440.png');
  await shot('sprint4-moments-1440.png');

  /* 档案室 + Scramble（尽快截图看解码过程） */
  await page.click('aside button:text-is("档案室")');
  await page.waitForTimeout(350);
  report.checks.archive = await page.evaluate(() => ({
    header: document.querySelector('header h1')?.textContent ?? null,
    cards: document.querySelectorAll('button.cut-corner-sm').length,
    text: document.body.innerText.replace(/\n/g, ' | ').slice(0, 400),
  }));
  await shot('sprint4-archive-scramble-1440.png');
  await page.waitForTimeout(1800);
  await shot('sprint4-archive-1440.png');

  /* /ping（本地消息，无后端） */
  await page.click('aside button:text-is("聊天")');
  await page.waitForTimeout(700);
  await page.fill('textarea[aria-label="输入信号"]', '/ping');
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(1200);
  report.checks.ping = await page.evaluate(() => {
    const text = document.body.innerText;
    return { hasPing: text.includes('[PING]'), snippet: text.slice(Math.max(0, text.indexOf('[PING]')), text.indexOf('[PING]') + 120).replace(/\n/g, ' | ') };
  });
  await shot('sprint4-ping-1440.png');

  /* sudo 彩蛋：无网络请求，3s 自动恢复 */
  await page.fill('textarea[aria-label="输入信号"]', 'sudo rm -rf /');
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(250);
  report.checks.sudoActive = await page.evaluate(() => Boolean(document.querySelector('.sudo-prank')));
  await shot('sprint4-sudo-1440.png');
  await page.waitForTimeout(3400);
  report.checks.sudoGone = await page.evaluate(() => !document.querySelector('.sudo-prank'));

  /* 390 移动端朋友圈 */
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const mobile = await mobileContext.newPage();
  watch(mobile);
  await mobile.goto(BASE);
  await mobile.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await mobile.waitForTimeout(1500);
  await mobile.click('button[aria-label="打开频道列表"]');
  await mobile.waitForTimeout(400);
  await mobile.locator('aside button:text-is("朋友圈")').last().click();
  await mobile.waitForTimeout(1200);
  report.checks.mobile = await mobile.evaluate(() => ({
    header: document.querySelector('header h1')?.textContent ?? null,
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    hasComposer: Boolean(document.querySelector('textarea[aria-label="朋友圈正文"]')),
  }));
  await shot('sprint4-mobile-moments-390.png', mobile);

  fs.writeFileSync(path.join(OUT, 'sprint4-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await mobileContext.close();
  await context.close();
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error('SPRINT4_FAILED', error);
  await page.screenshot({ path: path.join(OUT, 'sprint4-failure.png') }).catch(() => {});
  fs.writeFileSync(path.join(OUT, 'sprint4-report.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2), 'utf8');
  await browser.close().catch(() => {});
  process.exit(1);
}
