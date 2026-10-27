#!/usr/bin/env node
/**
 * 模块一/二 UI 截图 + 布局回归（真实 API + 真实前端，无 mock）
 *
 * 覆盖：
 *   - 他人个人主页（粉丝/关注/获赞 + 3 Tab + 关注按钮 + ⋯ 收纳）
 *   - ⋯ 菜单展开（Founder 额外「认证管理」）、认证管理弹窗
 *   - 风纪工位：工单池首屏、⋯ 菜单、Founder 审批弹窗
 *   - 本人个人中心
 *   - 移动端 390×844：三 Tab 等分、无横向溢出
 *
 * 产物：reports/e2e/module12-*.png、reports/e2e/module12-ui.json
 * 用法：node module12-ui-shot.mjs [--web http://127.0.0.1:3100] [--api http://127.0.0.1:3000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e');
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const WEB = arg('--web', 'http://localhost:3100').replace(/\/$/, '');
const API = arg('--api', 'http://127.0.0.1:3000').replace(/\/$/, '');
const PASSWORD = process.env.SEED_PASSWORD ?? 'Dijiang#2026';

const shots = [];
const problems = [];
fs.mkdirSync(OUT, { recursive: true });

async function login(handle, attempt = 0) {
  const response = await fetch(`${API}/api/v1/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: PASSWORD }),
  });
  const payload = await response.json();
  if (response.status === 429 && attempt < 3) {
    const wait = Math.min(65_000, Number(payload?.error?.retryAfterMs ?? 60_000) + 500);
    console.log(`… 登录限流，等待 ${wait}ms`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return login(handle, attempt + 1);
  }
  if (!response.ok) throw new Error(`login ${handle}: ${response.status} ${JSON.stringify(payload?.error)}`);
  return payload.data;
}

async function shot(page, name, label) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  if (size.scrollWidth > size.innerWidth + 1) {
    problems.push(`${name}: 横向溢出 ${size.scrollWidth} > ${size.innerWidth}`);
  }
  const file = path.join(OUT, `module12-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push({ name, label, file: path.relative(ROOT, file), ...size });
  console.log(`· ${name}  ${label}`);
}

async function newPage(browser, tokens, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(({ access, refresh }) => {
    try {
      localStorage.setItem('dj.belt.access', access);
      localStorage.setItem('dj.belt.refresh', refresh);
    } catch {
      /* 忽略隐私模式下的写入失败 */
    }
  }, tokens);
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return { context, page };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const founder = await login('founder');

  /* 桌面：他人主页 */
  const desktop = { width: 1440, height: 900 };
  const { context, page } = await newPage(browser, { access: founder.accessToken, refresh: founder.refreshToken }, desktop);

  await page.goto(`${WEB}/belt/u/creator`, { waitUntil: 'domcontentloaded' });
  await page.getByText('发布的帖子').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
  await shot(page, '01-profile-other', '他人主页 · 三计数 + 三 Tab');

  await page.getByRole('tab', { name: '发布的委托' }).click();
  await page.waitForTimeout(500);
  await shot(page, '02-profile-commissions', 'Tab 2 · 发布的委托');

  await page.getByRole('tab', { name: '提供的服务' }).click();
  await page.waitForTimeout(500);
  await shot(page, '03-profile-services', 'Tab 3 · 提供的服务');

  await page.locator('button[aria-label="更多操作"]').click();
  await page.getByRole('menuitem', { name: '认证管理' }).waitFor({ timeout: 5000 });
  await shot(page, '04-profile-menu', '⋯ 菜单：复制呼号 / 认证管理（Founder 专属）');

  await page.getByRole('menuitem', { name: '认证管理' }).click();
  await page.locator('section[aria-label="认证管理"]').waitFor({ timeout: 5000 });
  await shot(page, '05-cert-modal', '认证管理弹窗：4 个认证标签');

  /* 桌面：风纪工位 */
  await page.goto(`${WEB}/belt/moderation`, { waitUntil: 'domcontentloaded' });
  await page.locator('.belt-mod').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
  await shot(page, '06-moderation-pool', '风纪工位 · 工单池');

  await page.locator('button[aria-label="风纪操作"]').click();
  await page.getByRole('menuitem', { name: '风纪委员申请审批' }).waitFor({ timeout: 5000 });
  await shot(page, '07-moderation-menu', '风纪 ⋯ 菜单：申请 / Founder 审批');

  await page.getByRole('menuitem', { name: '风纪委员申请审批' }).click();
  await page.locator('section[aria-label="风纪委员申请审批"]').waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  await shot(page, '08-approvals-modal', 'Founder 审批弹窗：Lv4 候选申请');

  /* 桌面：本人个人中心 */
  await page.goto(`${WEB}/belt/profile`, { waitUntil: 'domcontentloaded' });
  await page.getByText('发布的帖子').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shot(page, '09-profile-self', '本人个人中心');
  await context.close();

  /* 移动端 */
  const mobile = { width: 390, height: 844 };
  const mobilePage = await newPage(browser, { access: founder.accessToken, refresh: founder.refreshToken }, mobile);
  await mobilePage.page.goto(`${WEB}/belt/u/clerk1`, { waitUntil: 'domcontentloaded' });
  await mobilePage.page.getByText('发布的帖子').first().waitFor({ timeout: 20_000 });
  await mobilePage.page.waitForTimeout(900);
  await shot(mobilePage.page, '10-mobile-profile', '移动端 390 · 三 Tab 等分');
  await mobilePage.context.close();

  fs.writeFileSync(
    path.join(OUT, 'module12-ui.json'),
    `${JSON.stringify({ web: WEB, api: API, shots, problems, at: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
  console.log(`\n${shots.length} 张截图，问题 ${problems.length} 个`);
  if (problems.length) {
    for (const problem of problems) console.error(`! ${problem}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  fs.writeFileSync(path.join(OUT, 'module12-ui.json'), `${JSON.stringify({ shots, problems, fatal: String(error?.stack ?? error) }, null, 2)}\n`, 'utf8');
  process.exitCode = 1;
} finally {
  await browser.close();
}
