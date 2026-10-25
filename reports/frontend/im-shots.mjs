/**
 * IM 布局验收：Playwright + 本机 Chrome，1440 与 390 截图 + 回归。
 * 前置：web 3100（next start）、API 3000、S3 9100 运行且已 seed。
 * 运行：node reports/frontend/im-shots.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), 'ops', 'e2e', 'node_modules', 'playwright-core'));

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'reports', 'frontend');
const BASE = 'http://localhost:3100';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HANDLE = process.env.SEED_HANDLE || 'founder';
const PASSWORD = process.env.SEED_PASSWORD || 'Dijiang#2026';
const UPLOAD = path.join(OUT, 'upload-test.png');
const stamp = Date.now();

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
});
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

const report = { shots: {}, checks: {}, consoleErrors, pageErrors };
const shot = async (name, target = page) => {
  const file = path.join(OUT, name);
  await target.screenshot({ path: file });
  report.shots[name] = file;
  console.log('SHOT', name);
};
const step = (name) => console.log('STEP', name);

try {
  /* 1. 登录 */
  step('login');
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await shot('im-login-1440.png');
  await page.fill('input[autocomplete="username"]', HANDLE);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 15000 });
  await page.waitForTimeout(1800);
  report.checks.desktop = await page.evaluate(() => ({
    path: location.pathname,
    title: (document.querySelector('header h1') || {}).textContent || '',
    messages: document.querySelectorAll('[role="listitem"]').length,
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    hasNoFloor: !/No\.\d+/.test(document.body.innerText),
    composer: Boolean(document.querySelector('textarea[aria-label="输入信号"]')),
  }));
  await shot('im-desktop-1440.png');

  /* 2. 详情抽屉 */
  step('detail drawer');
  await page.click('button[aria-label="打开详情"]');
  await page.waitForSelector('aside[aria-label="会话详情"]', { timeout: 5000 });
  await page.waitForTimeout(400);
  report.checks.detail = await page.evaluate(() => ({
    open: Boolean(document.querySelector('aside[aria-label="会话详情"]')),
    members: document.querySelectorAll('aside[aria-label="会话详情"] li').length,
  }));
  await shot('im-detail-1440.png');
  await page.click('button[aria-label="关闭详情"]');
  await page.waitForTimeout(300);

  /* 3. ＋ 菜单 */
  step('plus menu');
  await page.click('button[aria-label="添加内容"]');
  await page.waitForTimeout(300);
  report.checks.plusMenu = await page.evaluate(() => ({
    open: Boolean(document.querySelector('[role="menu"]')),
    items: [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim()),
  }));
  await shot('im-plus-menu-1440.png');
  await page.keyboard.press('Escape');
  await page.click('button[aria-label="添加内容"]').catch(() => {});
  await page.waitForTimeout(200);

  /* 4. 新建投票 + 直接投票 */
  step('vote create + vote');
  await page.click('button[aria-label="添加内容"]');
  await page.getByRole('menuitem', { name: /投票/ }).click();
  await page.waitForSelector('h2:has-text("新建投票")', { timeout: 5000 });
  const voteTitle = `IM 验收投票 ${stamp}`;
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByLabel('标题').fill(voteTitle);
  await dialog.locator('textarea').fill('方案 A\n方案 B\n方案 C');
  await dialog.getByRole('button', { name: '创建投票' }).click();
  await page.waitForSelector(`text=${voteTitle}`, { timeout: 10000 });
  await page.waitForTimeout(1000);
  const voteCard = page.locator('[role="listitem"]', { hasText: voteTitle }).last();
  await voteCard.locator('button[aria-pressed]').first().click();
  await voteCard.getByRole('button', { name: '投票' }).click();
  await page.waitForTimeout(1500);
  report.checks.vote = {
    title: voteTitle,
    resultText: await voteCard.innerText(),
    voted: (await voteCard.innerText()).includes('共 1 票'),
  };
  await voteCard.scrollIntoViewIfNeeded();
  await shot('im-vote-card-1440.png');

  /* 5. 新建任务 + 状态流转 */
  step('task create + status');
  await page.click('button[aria-label="添加内容"]');
  await page.getByRole('menuitem', { name: /任务/ }).click();
  await page.waitForSelector('h2:has-text("新建任务")', { timeout: 5000 });
  const taskTitle = `IM 验收任务 ${stamp}`;
  const taskDialog = page.locator('[role="dialog"]');
  await taskDialog.getByLabel('标题').fill(taskTitle);
  await taskDialog.getByRole('button', { name: '创建任务' }).click();
  await page.waitForSelector(`text=${taskTitle}`, { timeout: 10000 });
  await page.waitForTimeout(1000);
  const taskCard = page.locator('[role="listitem"]', { hasText: taskTitle }).last();
  await taskCard.getByRole('button', { name: '进行中' }).click();
  await page.waitForTimeout(1200);
  report.checks.task = {
    title: taskTitle,
    text: await taskCard.innerText(),
    moved: (await taskCard.innerText()).includes('进行中'),
  };
  await taskCard.scrollIntoViewIfNeeded();
  await shot('im-task-card-1440.png');

  /* 6. 素材上传（＋ → 素材） */
  step('material upload');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.click('button[aria-label="添加内容"]');
  await page.getByRole('menuitem', { name: /素材/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(UPLOAD);
  await page.waitForTimeout(1500);
  await page.waitForSelector('text=已上传', { timeout: 30000 });
  await page.waitForTimeout(2000);
  report.checks.material = {
    upload: await page.evaluate(() => document.body.innerText.includes('已上传')),
    cardMessages: await page.evaluate(() => document.querySelectorAll('[role="listitem"]').length),
  };
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="listitem"]')];
    const target = items.reverse().find((el) => el.innerText.includes('upload-test.png'));
    target?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
  await shot('im-material-card-1440.png');

  /* 7. 发送文字（回归） */
  step('send message');
  const sendText = `IM 布局验收消息 ${stamp}`;
  await page.fill('textarea[aria-label="输入信号"]', sendText);
  await page.press('textarea[aria-label="输入信号"]', 'Enter');
  await page.waitForSelector(`text=${sendText}`, { timeout: 10000 });
  await page.waitForTimeout(800);
  report.checks.send = await page.evaluate((text) => {
    const item = [...document.querySelectorAll('[role="listitem"]')].find((el) => el.innerText.includes(text));
    return { found: Boolean(item), pending: item ? item.className.includes('opacity-60') : null };
  }, sendText);
  await shot('im-send-1440.png');

  /* 8. DM / 群聊切换（回归） */
  step('dm/group switch');
  const pickRow = async (label) => {
    const section = page.locator('aside section').filter({ hasText: label }).first();
    const row = section.locator('button').filter({ hasNotText: '新建' }).first();
    await row.click();
    await page.waitForTimeout(1200);
  };
  await pickRow('私聊');
  report.checks.dm = { title: await page.locator('header h1').innerText() };
  await shot('im-dm-1440.png');
  await page.keyboard.press('Escape');
  await pickRow('群聊');
  report.checks.group = { title: await page.locator('header h1').innerText() };
  await shot('im-group-1440.png');
  await page.keyboard.press('Escape');
  await pickRow('频道');
  await page.waitForTimeout(800);

  /* 9. 移动端 390 */
  step('mobile 390');
  const storage = await context.storageState();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: storage,
  });
  const mobilePage = await mobile.newPage();
  const mobileErrors = [];
  mobilePage.on('console', (message) => {
    if (message.type() === 'error') mobileErrors.push(message.text().slice(0, 300));
  });
  mobilePage.on('pageerror', (error) => mobileErrors.push(String(error).slice(0, 300)));
  await mobilePage.goto(`${BASE}/`, { waitUntil: 'load' });
  await mobilePage.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 15000 });
  await mobilePage.waitForTimeout(1500);
  report.checks.mobile = await mobilePage.evaluate(() => ({
    innerWidth: window.innerWidth,
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    composer: Boolean(document.querySelector('textarea[aria-label="输入信号"]')),
    sidebarHidden: !document.querySelector('aside button[aria-label="关闭侧栏"]')?.offsetParent,
  }));
  report.checks.mobileHeader = await mobilePage.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return null;
    return {
      text: header.innerText.replace(/\n/g, ' | '),
      visibleButtons: [...header.querySelectorAll('button')].filter((button) => button.offsetParent).map((button) => button.getAttribute('aria-label')),
    };
  });
  await mobilePage.screenshot({ path: path.join(OUT, 'im-mobile-header-390.png'), clip: { x: 0, y: 0, width: 390, height: 120 } });
  console.log('SHOT im-mobile-header-390.png');
  report.shots['im-mobile-header-390.png'] = path.join(OUT, 'im-mobile-header-390.png');
  await shot('im-mobile-390.png', mobilePage);
  await mobilePage.click('button[aria-label="打开频道列表"]');
  await mobilePage.waitForTimeout(500);
  await shot('im-mobile-sidebar-390.png', mobilePage);
  await mobilePage.locator('button[aria-label="关闭侧栏"]').last().click();
  await mobilePage.waitForTimeout(300);
  await mobilePage.click('button[aria-label="打开详情"]');
  await mobilePage.waitForTimeout(500);
  await shot('im-mobile-detail-390.png', mobilePage);

  report.consoleErrors = consoleErrors;
  report.pageErrors = pageErrors;
  report.mobileErrors = mobileErrors;
  fs.writeFileSync(path.join(OUT, 'im-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await mobile.close();
  await context.close();
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error('IM_SHOTS_FAILED', error);
  await page.screenshot({ path: path.join(OUT, 'im-failure-1440.png') }).catch(() => {});
  fs.writeFileSync(
    path.join(OUT, 'im-report.json'),
    JSON.stringify({ ...report, failure: String(error), consoleErrors, pageErrors }, null, 2),
    'utf8',
  );
  await browser.close().catch(() => {});
  process.exit(1);
}
