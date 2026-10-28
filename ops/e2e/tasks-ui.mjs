#!/usr/bin/env node
/** 委托大厅 UI 截图与断言 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'tasks-ui');
const WEB = 'http://localhost:3100';
const API = 'http://127.0.0.1:3000/api/v1';
fs.mkdirSync(OUT, { recursive: true });
const steps = [];
const ok = (id, pass, detail = {}) => {
  steps.push({ id, ok: pass, ...detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail).slice(0, 220)}`);
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
  return payload.data;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const creator = await login('creator');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: creator.accessToken, r: creator.refreshToken });
  const page = await ctx.newPage();

  await page.goto(`${WEB}/belt/bounty`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const text = await page.locator('body').innerText();
  ok('U1 委托大厅可达', /委托/.test(text) && /我发布的|全部/.test(text), { url: page.url() });
  ok('U2 列表有委托卡片且显示金额', /外环测绘原片批量校色|环塔导览图排版/.test(text) && /券/.test(text), {});
  await page.screenshot({ path: path.join(OUT, 'tasks-hall.png') });

  /* 发布弹窗 */
  const publish = page.getByRole('button', { name: /发布委托/ }).first();
  const hasPublish = (await publish.count()) > 0;
  if (hasPublish) {
    await publish.click();
    await page.waitForTimeout(700);
    const modal = await page.locator('body').innerText();
    ok('U3 发布弹窗含 5% 服务费提示', /5%|服务费/.test(modal) && /标题|说明|价格|券/.test(modal), {});
    await page.screenshot({ path: path.join(OUT, 'publish-modal.png') });
    await page.locator('.belt-modal-backdrop').first().click({ position: { x: 8, y: 8 } }).catch(() => {});
    await page.waitForTimeout(500);
  } else {
    ok('U3 发布弹窗含 5% 服务费提示', false, { note: '未找到发布按钮' });
  }

  /* Tab 切换 */
  const posted = page.getByRole('tab', { name: /我发布的/ });
  if (await posted.count()) {
    await posted.click();
    await page.waitForTimeout(1200);
    const postedText = await page.locator('body').innerText();
    ok('U4 我发布的 Tab 过滤', /外环测绘原片批量校色/.test(postedText), {});
    await page.screenshot({ path: path.join(OUT, 'tasks-posted.png') });
  } else {
    ok('U4 我发布的 Tab 过滤', false, { note: '未找到 tab' });
  }
  await ctx.close();
} catch (error) {
  steps.push({ id: 'fatal', ok: false, error: String(error?.message ?? error) });
  console.error(error);
} finally {
  fs.writeFileSync(path.join(OUT, 'tasks-ui.json'), `${JSON.stringify(steps, null, 2)}\n`, 'utf8');
  const failed = steps.filter((item) => !item.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
  await browser.close();
}
