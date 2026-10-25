/**
 * 修复验收：
 * 1) 登录按钮启用态文字可见（截图 im-login-filled.png）
 * 2) 无限上滚加载更早后视口保持锚定（im-scroll-anchored.png）
 * 3) 「↓ 回到最新」可点并回底（im-scroll-jump.png）
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
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)));
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
const report = { checks: {}, consoleErrors, pageErrors };
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('SHOT', name);
};

try {
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(800);
  await page.fill('input[autocomplete="username"]', 'someone');
  await page.fill('input[type="password"]', 'any-password');
  await page.waitForTimeout(200);
  report.checks.loginButton = await page.evaluate(() => {
    const button = document.querySelector('button[type="submit"]');
    if (!button) return null;
    const style = getComputedStyle(button);
    return { text: button.textContent, color: style.color, background: style.backgroundColor, disabled: button.disabled };
  });
  await shot('im-login-filled.png');

  await page.fill('input[autocomplete="username"]', HANDLE);
  await page.fill('input[autocomplete="username"]', HANDLE);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 15000 });
  await page.waitForTimeout(2500);

  const scrollInfo = () =>
    page.evaluate(() => {
      const el = document.querySelector('.im-scroll[role="log"]');
      const items = [...document.querySelectorAll('.im-scroll[role="log"] [data-message-id]')];
      const jump = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('回到最新'));
      return {
        scrollTop: el?.scrollTop ?? null,
        scrollHeight: el?.scrollHeight ?? null,
        clientHeight: el?.clientHeight ?? null,
        distance: el ? el.scrollHeight - el.scrollTop - el.clientHeight : null,
        count: items.length,
        firstText: items[0]?.innerText.replace(/\n/g, ' | ').slice(0, 80) ?? '',
        jumpVisible: jump ? Boolean(jump.offsetParent) : false,
      };
    });

  const before = await scrollInfo();
  await page.evaluate(() => {
    const el = document.querySelector('.im-scroll[role="log"]');
    if (el) el.scrollTop = 0;
  });
  await page.waitForTimeout(3000);
  const after = await scrollInfo();
  report.checks.scroll = { before, after };
  report.checks.anchored = Boolean(
    after.count > before.count && after.distance !== null && after.distance > 240 && after.scrollTop !== null && after.scrollTop > 500,
  );
  await shot('im-scroll-anchored.png');

  const jump = page.locator('button', { hasText: '回到最新' });
  report.checks.jumpVisible = await jump.isVisible().catch(() => false);
  if (report.checks.jumpVisible) {
    await jump.click();
    await page.waitForTimeout(120);
  }
  const immediate = await scrollInfo();
  report.checks.jumpImmediate = immediate;
  await page.waitForTimeout(700);
  const bottom = await scrollInfo();
  report.checks.afterJump = bottom;
  report.checks.backToBottom = bottom.distance !== null && bottom.distance < 40;
  report.checks.jumpLatest = {
    distanceImmediate: immediate.distance,
    distanceAfter700ms: bottom.distance,
    jumpVisibleAfter: bottom.jumpVisible,
    screenshot: 'reports/frontend/im-jump-latest.png',
  };
  await shot('im-jump-latest.png');
  await shot('im-scroll-jump.png');

  // 把点击后距底数值并入 im-report.json，供 e2e 读取
  const reportPath = path.join(OUT, 'im-report.json');
  let baseReport = {};
  try {
    baseReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    baseReport = {};
  }
  baseReport.checks = { ...(baseReport.checks || {}), jumpLatest: report.checks.jumpLatest };
  fs.writeFileSync(reportPath, JSON.stringify(baseReport, null, 2), 'utf8');

  fs.writeFileSync(path.join(OUT, 'im-scroll-check.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error('SCROLL_CHECK_FAILED', error);
  await page.screenshot({ path: path.join(OUT, 'im-scroll-failure.png') }).catch(() => {});
  fs.writeFileSync(path.join(OUT, 'im-scroll-check.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2), 'utf8');
  await browser.close().catch(() => {});
  process.exit(1);
}
