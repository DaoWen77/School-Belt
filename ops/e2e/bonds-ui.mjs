#!/usr/bin/env node
/** 模块三 UI 验证：我的羁绊页（active/待处理/等待对方/已解除）+ 个人主页「发起羁绊」弹窗 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'bonds-ui');
const WEB = 'http://localhost:3100';
const API = 'http://127.0.0.1:3000/api/v1';
fs.mkdirSync(OUT, { recursive: true });
const steps = [];
const ok = (id, pass, detail = {}) => {
  steps.push({ id, ok: pass, ...detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail).slice(0, 220)}`);
};

async function login(handle) {
  const response = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'Dijiang#2026' }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`login ${handle}: ${response.status}`);
  return payload.data;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  /* 预置：founder 给 qiu 发一张 mentor 邀请（页面「待我处理」） */
  const founder = await login('founder');
  const qiu = await login('qiu');
  const existing = await fetch(`${API}/belt/bonds`, { headers: { authorization: `Bearer ${founder.accessToken}` } }).then((r) => r.json());
  const hasMentorPending = (existing.data?.outgoing ?? []).some((item) => item.type === 'mentor');
  if (!hasMentorPending) {
    await fetch(`${API}/belt/bonds/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${founder.accessToken}` },
      body: JSON.stringify({ handle: 'qiu', type: 'mentor' }),
    });
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: qiu.accessToken, r: qiu.refreshToken });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => steps.push({ id: 'pageerror', ok: false, error: error.message }));

  await page.goto(`${WEB}/belt/bonds`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const text = await page.locator('body').innerText();
  ok('U1 羁绊页可达', /我的羁绊/.test(text), { url: page.url() });
  ok('U2 当前羁绊卡片', /死党|大佬|搭档|搭子/.test(text) && /亲密度|延续羁绊/.test(text), {});
  ok('U3 待我处理（收到的邀请）', /待我处理/.test(text) && /同意|婉拒/.test(text), {});
  await page.screenshot({ path: path.join(OUT, 'bonds-page.png'), fullPage: false });

  /* 延续按钮点击 */
  const renewBtn = page.getByRole('button', { name: /延续羁绊|今日已延续|双方已完成/ }).first();
  const hasRenew = (await renewBtn.count()) > 0;
  ok('U4 延续羁绊按钮存在', hasRenew, { label: hasRenew ? await renewBtn.innerText() : null });

  /* 他人主页发起羁绊弹窗 */
  await page.goto(`${WEB}/belt/u/creator`, { waitUntil: 'domcontentloaded' });
  await page.getByText('发布的帖子').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.locator('button[aria-label="更多操作"]').click();
  await page.waitForTimeout(300);
  const inviteItem = page.getByRole('menuitem', { name: '发起羁绊' });
  const hasInvite = (await inviteItem.count()) > 0;
  if (hasInvite) {
    await inviteItem.click();
    await page.waitForTimeout(600);
    const modal = await page.locator('body').innerText();
    ok('U5 发起羁绊弹窗四种关系', /死党/.test(modal) && /大佬/.test(modal) && /搭档/.test(modal) && /搭子/.test(modal), {});
    await page.screenshot({ path: path.join(OUT, 'invite-modal.png') });
  } else {
    ok('U5 发起羁绊弹窗四种关系', false, { note: '菜单无发起羁绊' });
  }
  await ctx.close();
} catch (error) {
  steps.push({ id: 'fatal', ok: false, error: String(error?.message ?? error) });
  console.error(error);
} finally {
  fs.writeFileSync(path.join(OUT, 'bonds-ui.json'), `${JSON.stringify(steps, null, 2)}\n`, 'utf8');
  const failed = steps.filter((item) => !item.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
  await browser.close();
}
