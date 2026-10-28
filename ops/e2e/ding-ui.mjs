#!/usr/bin/env node
/** DING 接收端全屏强提醒 + 公告 info 形态 定向验证 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'im-ui');
const WEB = 'http://localhost:3100';
const API = 'http://127.0.0.1:3000/api/v1';
fs.mkdirSync(OUT, { recursive: true });
const steps = [];
const ok = (id, pass, detail = {}) => {
  steps.push({ id, ok: pass, ...detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail).slice(0, 240)}`);
};

async function login(handle) {
  const response = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'Dijiang#2026' }),
  });
  const payload = await response.json();
  if (!payload.data) throw new Error(`login ${handle}: ${response.status} ${JSON.stringify(payload.error)}`);
  return payload.data;
}
async function context(browser, session) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: session.accessToken, r: session.refreshToken });
  return ctx;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const senderSession = await login('founder');
  const receiverSession = await login('qiu');
  const senderCtx = await context(browser, senderSession);
  const receiverCtx = await context(browser, receiverSession);
  const sender = await senderCtx.newPage();
  const receiver = await receiverCtx.newPage();

  await receiver.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await receiver.getByText('环塔频道').first().waitFor({ timeout: 40_000 }).catch(() => {});
  await receiver.waitForTimeout(2500);
  await receiver.getByRole('button', { name: /我知道了/ }).click({ timeout: 2000 }).catch(() => {});

  await sender.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await sender.getByText('环塔频道').first().waitFor({ timeout: 40_000 }).catch(() => {});
  await sender.waitForTimeout(2500);
  await sender.getByRole('button', { name: /我知道了/ }).click({ timeout: 2000 }).catch(() => {});

  /* 发送端 DING */
  const dingBtn = sender.getByRole('button', { name: 'DING 强提醒' });
  ok('D1 DING 按钮存在', (await dingBtn.count()) > 0, {});
  await dingBtn.click();
  await sender.waitForTimeout(700);
  const confirm = sender.getByRole('button', { name: /发送|确认|DING/ }).last();
  await confirm.click({ timeout: 5000 }).catch((error) => console.log('confirm-click', error.message));
  await sender.waitForTimeout(2500);
  await sender.screenshot({ path: path.join(OUT, 'ding-sent.png') });

  /* 接收端应出现全屏浮层 */
  const overlay = receiver.locator('.belt-ding-overlay, [class*="ding-overlay"], [role="alertdialog"]');
  const hasOverlay = (await overlay.count()) > 0;
  const bodyText = await receiver.locator('body').innerText();
  ok('D2 接收端全屏强提醒', hasOverlay || /我知道了/.test(bodyText), {
    overlayCount: await overlay.count(),
    snippet: bodyText.slice(-200),
  });
  await receiver.screenshot({ path: path.join(OUT, 'ding-overlay.png') });

  /* info 公告形态 */
  const marquee = await receiver.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[class*="ann"], [class*="marquee"]'));
    return nodes.map((node) => ({ cls: node.className, text: (node.textContent || '').slice(0, 50) })).slice(0, 6);
  });
  ok('D3 info 公告渲染节点', marquee.length > 0, { marquee });

  await senderCtx.close();
  await receiverCtx.close();
} catch (error) {
  steps.push({ id: 'fatal', ok: false, error: String(error?.message ?? error) });
  console.error(error);
} finally {
  fs.writeFileSync(path.join(OUT, 'ding-ui.json'), `${JSON.stringify(steps, null, 2)}\n`, 'utf8');
  const failed = steps.filter((item) => !item.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
  await browser.close();
}
