#!/usr/bin/env node
/**
 * P0 前端闭环验证（真实 API + 真实前端）：
 *   关注 → 发私信跳转 / 帖子 ⋯ 菜单 / 打赏两步确认扣款 / 个人页 EXP+商券 / Feed Tab /
 *   Founder 置顶+推送+公告 / 风纪外壳
 * 产物：reports/e2e/p0-ui/*.png、reports/e2e/p0-ui.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'p0-ui');
const WEB = 'http://localhost:3100';
const API = 'http://127.0.0.1:3000/api/v1';
fs.mkdirSync(OUT, { recursive: true });

const steps = [];
const problems = [];
const step = (id, ok, detail = {}) => {
  steps.push({ id, ok, ...detail });
  console.log(`${ok ? 'OK  ' : 'MISS'} ${id}  ${JSON.stringify(detail).slice(0, 220)}`);
};

async function login(handle, attempt = 0) {
  const response = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'Dijiang#2026' }),
  });
  const payload = await response.json();
  if (response.status === 429 && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    return login(handle, attempt + 1);
  }
  if (!response.ok) throw new Error(`login ${handle}: ${response.status}`);
  return payload.data;
}

async function context(browser, data) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: data.accessToken, r: data.refreshToken });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const qiu = await login('qiu');
  const founder = await login('founder');

  const feed = await fetch(`${API}/belt/posts?feed=all&limit=50`, {
    headers: { authorization: `Bearer ${qiu.accessToken}` },
  }).then((r) => r.json());
  const candidates = feed?.data?.posts ?? [];
  const target = candidates.find((item) => item.author?.handle === 'creator' && item.board !== 'telegraph') ?? candidates[0];
  const postId = target?.id;

  const { ctx, page } = await context(browser, qiu);

  /* 1. 他人主页：私信按钮 + 商券 + 等级 */
  await page.goto(`${WEB}/belt/u/creator`, { waitUntil: 'domcontentloaded' });
  await page.getByText('发布的帖子').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
  const profileText = await page.locator('body').innerText();
  step('U1 他人主页有发私信按钮', (await page.getByRole('button', { name: '发私信' }).count()) > 0, {
    wallet: (profileText.match(/商券\s*[\d.]+\s*券/) ?? [])[0] ?? null,
    level: (profileText.match(/Lv\s*\d+/) ?? [])[0] ?? null,
    exp: (profileText.match(/EXP[^\n]*/) ?? [])[0] ?? null,
  });
  await shot(page, 'p0-01-profile-dm');

  /* 2. 点击发私信 → 跳转私聊 */
  await page.getByRole('button', { name: '发私信' }).first().click();
  await page.waitForURL(/\/belt\/direct\//, { timeout: 15_000 }).catch(() => {});
  step('U2 发私信跳转到私聊', /\/belt\/direct\//.test(page.url()), { url: page.url() });
  await page.waitForTimeout(1200);
  await shot(page, 'p0-02-dm');

  /* 3. 帖子详情 ⋯ 菜单 */
  await page.goto(`${WEB}/belt/posts/${postId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '帖子更多操作' }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
  const headerWalletBefore = (await page.locator('body').innerText()).match(/商券\s*([\d.]+)/)?.[1] ?? null;
  await page.getByRole('button', { name: '帖子更多操作' }).click();
  await page.waitForTimeout(400);
  const menuItems = await page.getByRole('menuitem').allInnerTexts();
  step('U3 帖子 ⋯ 菜单含 收藏/打赏/举报', ['收藏', '打赏', '举报'].every((label) => menuItems.some((text) => text.includes(label))), {
    menuItems,
  });
  await shot(page, 'p0-03-post-menu');

  /* 4. 打赏两步确认 */
  await page.getByRole('menuitem', { name: '打赏' }).click();
  await page.getByLabel('打赏金额（券）').waitFor({ timeout: 5000 });
  await page.getByLabel('打赏金额（券）').fill('1');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.waitForTimeout(400);
  const confirmText = await page.locator('body').innerText();
  const hasConfirm = /确认打赏/.test(confirmText);
  await shot(page, 'p0-04-tip-confirm');
  await page.getByRole('button', { name: '确认打赏' }).click();
  await page.waitForTimeout(1800);
  const afterTip = await page.locator('body').innerText();
  const headerWalletAfter = afterTip.match(/商券\s*([\d.]+)/)?.[1] ?? null;
  step('U4 打赏二次确认并扣款', hasConfirm && headerWalletBefore !== headerWalletAfter, {
    before: headerWalletBefore,
    after: headerWalletAfter,
    notice: (afterTip.match(/已打赏[^\n]*/) ?? [])[0] ?? null,
  });
  await shot(page, 'p0-05-tip-done');

  /* 5. 个人页 EXP + 商券 */
  await page.goto(`${WEB}/belt/profile`, { waitUntil: 'domcontentloaded' });
  await page.getByText('发布的帖子').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(900);
  const selfText = await page.locator('body').innerText();
  step('U5 个人页 EXP 进度条 + 商券', /EXP\s*\d+\s*\/\s*\d+|MAX/.test(selfText) && /商券\s*[\d.]+\s*券/.test(selfText), {
    exp: (selfText.match(/EXP[^\n]*/) ?? [])[0] ?? null,
    wallet: (selfText.match(/商券\s*[\d.]+\s*券/) ?? [])[0] ?? null,
    level: (selfText.match(/Lv\s*\d+/) ?? [])[0] ?? null,
  });
  await shot(page, 'p0-06-self-profile');

  /* 6. Feed Tab */
  await page.goto(`${WEB}/belt/daily`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const tabs = await page.getByRole('tab').allInnerTexts().catch(() => []);
  const feedText = await page.locator('body').innerText();
  step('U6 三合一 Feed Tab（全部/动态/校园/日常）', ['全部', '动态', '校园', '日常'].every((label) => tabs.join(' ').includes(label) || feedText.includes(label)), {
    tabs,
  });
  await shot(page, 'p0-07-feed-tabs');
  if (await page.getByRole('tab', { name: '校园' }).count()) {
    await page.getByRole('tab', { name: '校园' }).first().click();
    await page.waitForTimeout(900);
    await shot(page, 'p0-08-feed-campus');
  }

  /* 7. 风纪外壳（非委员可见） */
  await page.goto(`${WEB}/belt/moderation`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  const modText = await page.locator('body').innerText();
  step('U7 非委员可见风纪外壳与资格', /风纪委员会|资格|申请/.test(modText) && !/DENIED/.test(modText), {
    snippet: modText.replace(/\n+/g, ' | ').slice(0, 240),
  });
  await shot(page, 'p0-09-moderation-shell');
  await ctx.close();

  /* 8. Founder：帖子 ⋯ 特权 + 公告入口 */
  const f = await context(browser, founder);
  await f.page.goto(`${WEB}/belt/posts/${postId}`, { waitUntil: 'domcontentloaded' });
  await f.page.getByRole('button', { name: '帖子更多操作' }).waitFor({ timeout: 20_000 });
  await f.page.getByRole('button', { name: '帖子更多操作' }).click();
  await f.page.waitForTimeout(400);
  const founderMenu = await f.page.getByRole('menuitem').allInnerTexts();
  step('U8 Founder 菜单含 置顶/推送到新闻', founderMenu.some((t) => t.includes('置顶')) && founderMenu.some((t) => t.includes('推送')), {
    menuItems: founderMenu,
  });
  await shot(f.page, 'p0-10-founder-post-menu');

  await f.page.goto(`${WEB}/belt/daily`, { waitUntil: 'domcontentloaded' });
  await f.page.waitForTimeout(1500);
  const announceBtn = f.page.getByRole('button', { name: /公告/ });
  const hasAnnounce = (await announceBtn.count()) > 0;
  if (hasAnnounce) {
    await announceBtn.first().click();
    await f.page.waitForTimeout(700);
    await shot(f.page, 'p0-11-founder-announcement');
  }
  step('U9 Founder 环塔内公告入口', hasAnnounce, { buttons: (await f.page.locator('header button').allInnerTexts()).slice(0, 10) });
  await f.ctx.close();
} catch (error) {
  problems.push(`fatal: ${error?.message ?? error}`);
  console.error(error);
} finally {
  fs.writeFileSync(path.join(OUT, '..', 'p0-ui.json'), `${JSON.stringify({ steps, problems, at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} UI 断言通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  if (problems.length) console.log('问题：', problems.slice(0, 5));
  process.exitCode = failed.length || problems.some((p) => p.startsWith('fatal')) ? 1 : 0;
  await browser.close();
}
