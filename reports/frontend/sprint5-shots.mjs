/**
 * Sprint5 截图/冒烟：邀请成员 UI（owner）+ 普通成员不可见 + /task 指令拦截。
 * 只跑本 Sprint 截图；指令解析另由 sprint5-commands-check.mjs 断言。
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), 'ops', 'e2e', 'node_modules', 'playwright-core'));

const OUT = path.join(process.cwd(), 'reports', 'frontend');
const BASE = 'http://localhost:3100';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OWNER = { handle: 'founder', password: 'Dijiang#2026' };
const MEMBER = { handle: 'yue', password: 'Dijiang#2026' };

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

async function login(target, credentials) {
  await target.goto(`${BASE}/login`);
  await target.fill('input[autocomplete="username"]', credentials.handle);
  await target.fill('input[type="password"]', credentials.password);
  await target.click('button[type="submit"]');
  await target.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await target.waitForTimeout(1500);
}
const shot = async (name, target = page) => {
  const file = path.join(OUT, name);
  await target.screenshot({ path: file });
  report.shots[name] = file;
  console.log('SHOT', name);
};

try {
  await login(page, OWNER);

  /* 邀请成员（owner） */
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('text=Invites / 邀请成员', { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.selectOption('select[aria-label="邀请角色"]', 'admin');
  await page.fill('input[aria-label="邀请最大使用次数"]', '2');
  await page.fill('input[aria-label="邀请有效期天数"]', '7');
  await page.click('button:has-text("生成邀请码")');
  await page.waitForTimeout(1600);
  report.checks.inviteCreated = await page.evaluate(() => {
    const code = document.querySelector('code.bg-ink')?.textContent?.trim() ?? null;
    const body = document.body.innerText;
    const storage = Object.keys(window.localStorage).map((key) => window.localStorage.getItem(key) ?? '').join('\n');
    return {
      hasSection: body.includes('邀请成员'),
      codeVisible: Boolean(code),
      code,
      codeInLocalStorage: Boolean(code && storage.includes(code)),
      listHasPrefix: body.includes('…'),
      statusActive: body.includes('active'),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'sprint5-invite-1440.png') });
  report.shots['sprint5-invite-1440.png'] = path.join(OUT, 'sprint5-invite-1440.png');
  console.log('SHOT sprint5-invite-1440.png');

  /* 普通成员不可见 */
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const memberPage = await memberContext.newPage();
  watch(memberPage);
  await login(memberPage, MEMBER);
  await memberPage.goto(`${BASE}/settings`);
  await memberPage.waitForSelector('text=Profile / 个人资料', { timeout: 15000 });
  await memberPage.waitForTimeout(800);
  report.checks.member = await memberPage.evaluate(() => ({
    hasInviteSection: document.body.innerText.includes('邀请成员'),
    hasAiSection: document.body.innerText.includes('AI / 智能体配置'),
  }));
  await memberPage.screenshot({ path: path.join(OUT, 'sprint5-invite-member-1440.png') });
  report.shots['sprint5-invite-member-1440.png'] = path.join(OUT, 'sprint5-invite-member-1440.png');
  console.log('SHOT sprint5-invite-member-1440.png');

  /* /task 拦截：弹窗、输入框清空、不产生消息 */
  await page.goto(BASE);
  await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => document.querySelectorAll('[data-message-id]').length);
  await page.fill('textarea[aria-label="输入信号"]', '/task');
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(800);
  report.checks.commands = await page.evaluate(() => ({
    dialogOpen: Boolean(document.querySelector('[role="dialog"][aria-label="新建任务"]')),
    draft: document.querySelector('textarea[aria-label="输入信号"]')?.value ?? null,
    messages: document.querySelectorAll('[data-message-id]').length,
  }));
  report.checks.commands.beforeMessages = before;
  await page.screenshot({ path: path.join(OUT, 'sprint5-commands-1440.png') });
  report.shots['sprint5-commands-1440.png'] = path.join(OUT, 'sprint5-commands-1440.png');
  console.log('SHOT sprint5-commands-1440.png');

  (await import('node:fs')).writeFileSync(path.join(OUT, 'sprint5-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await memberContext.close();
  await context.close();
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error('SPRINT5_FAILED', error);
  await page.screenshot({ path: path.join(OUT, 'sprint5-failure.png') }).catch(() => {});
  (await import('node:fs')).writeFileSync(path.join(OUT, 'sprint5-report.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2), 'utf8');
  await browser.close().catch(() => {});
  process.exit(1);
}
