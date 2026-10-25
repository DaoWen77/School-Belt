/**
 * Sprint3 截图/冒烟：AI 设置、连通性、@Bot 流式终端、/report、普通成员不可见 AI 面板。
 * 真实 API 3000 + mock provider 127.0.0.1:4010/v1（仅 mock，不是真实供应商）。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), 'ops', 'e2e', 'node_modules', 'playwright-core'));

const OUT = path.join(process.cwd(), 'reports', 'frontend');
const BASE = 'http://localhost:3100';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OWNER = { handle: 'founder', password: 'Dijiang#2026' };
const MEMBER = { handle: 'yue', password: 'Dijiang#2026' };
const MOCK_BASE = 'http://127.0.0.1:4010/v1';
const MOCK_MODEL = 'mock-gpt';
const MOCK_KEY = 'mock-key-dijiang';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const report = { shots: {}, checks: {}, errors: [], pageErrors: [], failedRequests: [] };

function watch(page) {
  page.on('console', (message) => message.type() === 'error' && report.errors.push(message.text().slice(0, 400)));
  page.on('pageerror', (error) => report.pageErrors.push(String(error).slice(0, 400)));
  page.on('response', (response) => {
    if (response.status() >= 400) report.failedRequests.push({ status: response.status(), url: response.url().slice(0, 220) });
  });
}

async function login(page, credentials) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[autocomplete="username"]', credentials.handle);
  await page.fill('input[type="password"]', credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await page.waitForTimeout(1800);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
watch(page);
const shot = async (name, target = page) => {
  const file = path.join(OUT, name);
  await target.screenshot({ path: file });
  report.shots[name] = file;
  console.log('SHOT', name);
};

try {
  await login(page, OWNER);

  /* AI 设置 */
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('text=AI / 智能体配置', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.fill('input[aria-label="AI API Base"]', MOCK_BASE);
  await page.fill('input[aria-label="AI 模型"]', MOCK_MODEL);
  await page.fill('input[aria-label="AI API Key"]', MOCK_KEY);
  await page.click('button:has-text("保存 AI 配置")');
  await page.waitForTimeout(1600);
  report.checks.config = await page.evaluate(() => ({
    hasPanel: document.body.innerText.includes('AI / 智能体配置'),
    maskedVisible: document.body.innerText.includes('服务端已保存 Key') || document.body.innerText.includes('留空不修改'),
    keyInputValue: document.querySelector('input[aria-label="AI API Key"]')?.value ?? null,
    pageHasPlainKey: document.body.innerText.includes('mock-key-dijiang'),
    saved: document.body.innerText.includes('已保存'),
  }));
  await shot('sprint3-ai-config-1440.png');

  await page.click('button:has-text("测试连通性")');
  await page.waitForTimeout(1800);
  report.checks.test = await page.evaluate(() => {
    const text = document.body.innerText;
    const index = text.indexOf('连通');
    return { text: index >= 0 ? text.slice(index, index + 100).replace(/\n/g, ' | ') : null };
  });
  await shot('sprint3-ai-test-1440.png');

  /* @Bot 流式 */
  await page.goto(BASE);
  await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const botBaseline = await page.evaluate(() => document.querySelectorAll('[data-bot="true"]').length);
  await page.fill('textarea[aria-label="输入信号"]', '@Bot 请给出今日行动建议');
  await page.click('button[aria-label="发送"]');
  await page.waitForFunction((count) => document.querySelectorAll('[data-bot="true"]').length > count, botBaseline, { timeout: 15000 });
  await page.waitForTimeout(80);
  const botMid1 = await page.evaluate(() => {
    const bots = [...document.querySelectorAll('[data-bot="true"]')];
    const last = bots.at(-1);
    return { bodyLength: (last?.querySelector('.im-bot-body')?.textContent ?? '').length, streaming: Boolean(last?.querySelector('.im-bot-live')) };
  });
  await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('main .im-scroll')].sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(30);
  await shot('sprint3-bot-stream-1440.png');
  await page.waitForTimeout(240);
  const botMid2 = await page.evaluate(() => {
    const bots = [...document.querySelectorAll('[data-bot="true"]')];
    const last = bots.at(-1);
    return { bodyLength: (last?.querySelector('.im-bot-body')?.textContent ?? '').length, streaming: Boolean(last?.querySelector('.im-bot-live')) };
  });
  report.checks.botStreaming = await page.evaluate(() => {
    const bots = [...document.querySelectorAll('[data-bot="true"]')];
    const last = bots.at(-1);
    return { count: bots.length, streaming: Boolean(last?.querySelector('.im-bot-live')), body: (last?.innerText ?? '').replace(/\n/g, ' | ').slice(0, 200) };
  });
  report.checks.botDeltas = { first: botMid1, second: botMid2 };
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-bot="true"]')].some((node) => node.textContent?.includes('STREAM')), { timeout: 20000 });
  await page.waitForTimeout(500);
  report.checks.botDone = await page.evaluate(() => {
    const bots = [...document.querySelectorAll('[data-bot="true"]')];
    const last = bots.at(-1);
    return { count: bots.length, body: (last?.innerText ?? '').replace(/\n/g, ' | ').slice(0, 500), hasPrefix: (last?.innerText ?? '').includes('[DIJIANG/OS]') };
  });
  await shot('sprint3-bot-1440.png');

  /* /report 流式 */
  await page.fill('textarea[aria-label="输入信号"]', '/report');
  await page.click('button[aria-label="发送"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-bot="true"]').length >= 2, { timeout: 15000 });
  await page.waitForTimeout(350);
  report.checks.reportStreaming = await page.evaluate(() => {
    const bots = [...document.querySelectorAll('[data-bot="true"]')];
    const last = bots.at(-1);
    return { count: bots.length, body: (last?.innerText ?? '').replace(/\n/g, ' | ').slice(0, 200) };
  });
  await shot('sprint3-report-stream-1440.png');
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-bot="true"]')].slice(-1).some((node) => node.textContent?.includes('STREAM')), { timeout: 20000 });
  await page.waitForTimeout(500);
  report.checks.reportDone = await page.evaluate(() => {
    const bots = [...document.querySelectorAll('[data-bot="true"]')];
    const last = bots.at(-1);
    return {
      count: bots.length,
      hasReport: (last?.innerText ?? '').includes('REPORT'),
      body: (last?.innerText ?? '').replace(/\n/g, ' | ').slice(0, 500),
    };
  });
  await shot('sprint3-report-1440.png');

  /* 普通成员：设置页不渲染 AI 面板 */
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const memberPage = await memberContext.newPage();
  watch(memberPage);
  await login(memberPage, MEMBER);
  await memberPage.goto(`${BASE}/settings`);
  await memberPage.waitForSelector('text=Profile / 个人资料', { timeout: 15000 });
  await memberPage.waitForTimeout(700);
  report.checks.member = await memberPage.evaluate(() => ({
    hasAiPanel: document.body.innerText.includes('AI / 智能体配置'),
    hasOwnerBadge: document.body.innerText.includes('Owner / Admin'),
    text: document.body.innerText.replace(/\n/g, ' | ').slice(0, 300),
  }));
  await memberPage.screenshot({ path: path.join(OUT, 'sprint3-member-no-ai-1440.png') });
  report.shots['sprint3-member-no-ai-1440.png'] = path.join(OUT, 'sprint3-member-no-ai-1440.png');
  console.log('SHOT sprint3-member-no-ai-1440.png');

  fs.writeFileSync(path.join(OUT, 'sprint3-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await memberContext.close();
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error('SPRINT3_FAILED', error);
  await page.screenshot({ path: path.join(OUT, 'sprint3-failure.png') }).catch(() => {});
  fs.writeFileSync(path.join(OUT, 'sprint3-report.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2), 'utf8');
  await browser.close().catch(() => {});
  process.exit(1);
}
