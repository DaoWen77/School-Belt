/**
 * 多 Bot 前端截图：owner 管理、[BOT] 加人、@Bot、/bot、/clear、/summarize、/translate、/roll。
 * 真实 API + mock provider 4010；只跑本功能截图。
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), 'ops', 'e2e', 'node_modules', 'playwright-core'));

const OUT = path.join(process.cwd(), 'reports', 'frontend');
const BASE = 'http://localhost:3100';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const report = { shots: {}, checks: {}, errors: [], pageErrors: [], failedRequests: [] };

page.on('console', (message) => message.type() === 'error' && report.errors.push(message.text().slice(0, 400)));
page.on('pageerror', (error) => report.pageErrors.push(String(error).slice(0, 400)));
page.on('response', (response) => {
  if (response.status() >= 400) report.failedRequests.push({ status: response.status(), url: response.url().slice(0, 220) });
});

async function shot(name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  report.shots[name] = file;
  console.log('SHOT', name);
}
async function latest() {
  const button = page.locator('button:has-text("回到最新")');
  if (await button.count()) await button.click().catch(() => {});
  await page.waitForTimeout(600);
}

try {
  const envAccess = process.env.MULTIBOT_ACCESS ?? '';
  const envRefresh = process.env.MULTIBOT_REFRESH ?? '';
  let accessToken = envAccess;
  let refreshToken = envRefresh;
  if (!accessToken) {
    const loginResponse = await fetch('http://127.0.0.1:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'founder', password: 'Dijiang#2026' }),
    });
    const loginJson = await loginResponse.json();
    if (!loginResponse.ok || !loginJson?.data?.accessToken) throw new Error(`LOGIN_FAILED ${loginResponse.status} ${JSON.stringify(loginJson)}`);
    accessToken = loginJson.data.accessToken;
    refreshToken = loginJson.data.refreshToken;
  }
  await context.addInitScript((tokens) => {
    window.localStorage.setItem('dj.access', tokens.access);
    window.localStorage.setItem('dj.refresh', tokens.refresh);
  }, { access: accessToken, refresh: refreshToken });
  await page.goto(BASE);
  await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 25000 });
  await page.waitForTimeout(2200);

  /* Bot 管理（owner） */
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('text=Bots / Bot 管理', { timeout: 15000 });
  await page.waitForTimeout(1000);
  report.checks.botPanel = await page.evaluate(() => ({
    visible: document.body.innerText.includes('Bots / Bot 管理'),
    entries: [...document.querySelectorAll('li')].filter((node) => node.textContent?.includes('[BOT]')).length,
  }));
  await page.fill('input[aria-label="Bot 名称"]', '观测者');
  await page.fill('input[aria-label="Bot 模型"]', 'mock-gpt');
  await page.fill('textarea[aria-label="Bot System Prompt"]', '你是观测者，负责观察频道态势。');
  if (!(await page.evaluate(() => document.body.innerText.includes('观测者')))) {
    await page.click('button:has-text("创建 Bot")');
    await page.waitForTimeout(1800);
  }
  report.checks.botCreated = await page.evaluate(() => ({
    visible: document.body.innerText.includes('观测者'),
    entries: [...document.querySelectorAll('li')].filter((node) => node.textContent?.includes('[BOT]')).length,
  }));
  await shot('multibot-admin-1440.png');

  /* 详情抽屉加入列表 [BOT] */
  await page.goto(BASE);
  await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 25000 });
  await page.waitForTimeout(2200);
  await page.click('header button:has-text("详情")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("加人")');
  await page.waitForTimeout(900);
  report.checks.memberList = await page.evaluate(() => ({
    botVisible: document.body.innerText.includes('[BOT]'),
    drawerText: [...document.querySelectorAll('div')].map((node) => node.textContent ?? '').find((text) => text.includes('观测者'))?.slice(0, 160) ?? null,
  }));
  await shot('multibot-members-1440.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const cancelAdd = page.locator('button:has-text("取消")');
  if (await cancelAdd.count()) await cancelAdd.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  const closeDetail = page.locator('button[aria-label="关闭详情"]');
  if (await closeDetail.count()) await closeDetail.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);

  /* @Bot 自定义头像/名称流式 */
  await page.fill('textarea[aria-label="输入信号"]', '@帝江号·协议官 请给出今日行动建议');
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(6000);
  report.checks.botChat = await page.evaluate(() => ({
    botBubbles: document.querySelectorAll('[data-bot="true"]').length,
    text: document.body.innerText.slice(-600),
  }));
  await latest();
  await shot('multibot-bot-reply-1440.png');

  /* /bot 面板 */
  await page.fill('textarea[aria-label="输入信号"]', '/bot');
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(600);
  report.checks.botPicker = await page.evaluate(() => ({
    open: Boolean(document.querySelector('[aria-label="频道 Bot 列表"]')),
    hasBot: document.body.innerText.includes('帝江号·协议官'),
  }));
  await shot('multibot-bot-panel-1440.png');
  const botOption = page.locator('[aria-label="频道 Bot 列表"] button').filter({ hasText: '帝江号·协议官' }).last();
  if (await botOption.count()) await botOption.click();
  await page.waitForTimeout(300);
  report.checks.botInsert = await page.evaluate(() => document.querySelector('textarea[aria-label="输入信号"]')?.value ?? '');
  await page.fill('textarea[aria-label="输入信号"]', '');

  /* /clear */
  const beforeClear = await page.evaluate(() => document.querySelectorAll('[data-message-id]').length);
  await page.fill('textarea[aria-label="输入信号"]', '/clear');
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(1800);
  report.checks.clear = await page.evaluate((before) => ({
    text: document.body.innerText.includes('已清理本地缓存记录'),
    before,
    after: document.querySelectorAll('[data-message-id]').length,
  }), beforeClear);
  await latest();
  await shot('multibot-clear-1440.png');

  /* /summarize */
  await page.fill('textarea[aria-label="输入信号"]', '/summarize');
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(6000);
  report.checks.summarize = await page.evaluate(() => ({
    text: document.body.innerText.includes('频道摘要'),
    bots: document.querySelectorAll('[data-bot="true"]').length,
  }));
  await latest();
  await shot('multibot-summarize-1440.png');

  /* /roll */
  await page.fill('textarea[aria-label="输入信号"]', '/roll 1d100');
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(800);
  report.checks.roll = await page.evaluate(() => ({ text: /ROLL 1d100 = \d+/.exec(document.body.innerText)?.[0] ?? null }));
  await latest();
  await shot('multibot-roll-1440.png');

  /* /translate：用 Composer 的「引用最近一条」 */
  const beforeQuote = await page.evaluate(() => document.querySelectorAll('[data-message-id]').length);
  const quoteButton = page.locator('button[aria-label="引用最近一条消息"]');
  report.checks.quoteCandidates = await quoteButton.count();
  if (await quoteButton.count()) await quoteButton.click();
  await page.waitForTimeout(600);
  report.checks.quoteBar = await page.evaluate(() => Boolean(document.querySelector('button[aria-label="取消引用"]')));
  await page.fill('textarea[aria-label="输入信号"]', '/translate');
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(6000);
  report.checks.translate = await page.evaluate((before) => ({
    text: document.body.innerText.includes('译文'),
    before,
    after: document.querySelectorAll('[data-message-id]').length,
  }), beforeQuote);
  await latest();
  await shot('multibot-translate-1440.png');

  (await import('node:fs')).writeFileSync(path.join(OUT, 'multibot-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error('MULTIBOT_FAILED', error);
  await page.screenshot({ path: path.join(OUT, 'multibot-failure.png') }).catch(() => {});
  (await import('node:fs')).writeFileSync(path.join(OUT, 'multibot-report.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2), 'utf8');
  await browser.close().catch(() => {});
  process.exit(1);
}
