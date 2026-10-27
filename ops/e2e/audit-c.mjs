#!/usr/bin/env node
/** 入口可达性审计 C：IM 细节（直达私聊 URL + 频道消息菜单 + @ + 撤回） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'audit');
const WEB = 'http://localhost:3100';
const API = 'http://127.0.0.1:3000/api/v1';
const DM_ID = '8929d15d-3919-4f59-b2f9-878fd6225238'; // chen <-> lin
fs.mkdirSync(OUT, { recursive: true });

const steps = [];
const step = (id, ok, detail) => {
  steps.push({ id, ok, ...detail });
  console.log(`${ok ? 'OK  ' : 'MISS'} ${id}  ${JSON.stringify(detail).slice(0, 260)}`);
};

async function login(handle) {
  const r = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'Dijiang#2026' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${handle}: ${r.status}`);
  return j.data;
}

const facts = (page) =>
  page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const collect = (selector) =>
      Array.from(document.querySelectorAll(selector))
        .filter(visible)
        .map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 150);
    return {
      url: location.pathname + location.search,
      buttons: collect('button'),
      inputs: Array.from(document.querySelectorAll('input, textarea'))
        .filter(visible)
        .map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute('type') ?? ''}:${el.getAttribute('placeholder') ?? ''}:${el.getAttribute('aria-label') ?? ''}`),
      text: document.body.innerText.replace(/\n{2,}/g, '\n'),
    };
  });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const chen = await login('chen');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: chen.accessToken, r: chen.refreshToken });
  const page = await ctx.newPage();

  /* 直达私聊 URL */
  await page.goto(`${WEB}/belt/direct/${DM_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const dm = await facts(page);
  step('C0b 私聊页可直达并渲染消息', /输入信号|私聊消息/.test(dm.inputs.join(' ') + dm.text), {
    url: dm.url,
    inputs: dm.inputs,
    messages: dm.text.split('\n').slice(-6),
  });
  await page.screenshot({ path: path.join(OUT, 'audit-c-01-dm.png') });

  /* 消息 ⋯ */
  const more = page.getByRole('button', { name: '消息操作' });
  if (await more.count()) {
    await more.first().click();
    await page.waitForTimeout(500);
    const menu = await facts(page);
    step('C1b 私聊消息菜单项', true, { items: menu.buttons.filter((b) => /撤回|置顶|隐藏|拉黑|举报|DING|提醒/.test(b)) });
    await page.screenshot({ path: path.join(OUT, 'audit-c-02-menu.png') });
  } else {
    step('C1b 私聊消息菜单项', false, { note: '消息上没有 ⋯ 按钮' });
  }

  /* @ 选择器 + 发送 */
  const composer = page.getByLabel('私聊消息');
  if (await composer.count()) {
    await composer.click();
    await composer.type('@', { delay: 60 });
    await page.waitForTimeout(800);
    const mention = await facts(page);
    step('C2b @ 成员选择器', /提及|成员|@/.test(mention.buttons.join(' ')), { buttons: mention.buttons.slice(-10) });
    await page.screenshot({ path: path.join(OUT, 'audit-c-03-at.png') });
    await composer.fill('@lin 审计测试消息，请忽略');
    await page.getByRole('button', { name: /发送/ }).first().click();
    await page.waitForTimeout(1500);
    const sent = await facts(page);
    step('C3b 发送后消息上屏', /审计测试消息/.test(sent.text), { tail: sent.text.split('\n').slice(-6) });
  } else {
    step('C2b @ 成员选择器', false, { note: '未找到输入框' });
  }

  /* 频道消息菜单 */
  await page.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const ch = await facts(page);
  step('C7 频道消息菜单项', ch.buttons.some((b) => b === '消息操作'), {
    items: ch.buttons.filter((b) => /撤回|置顶|隐藏|拉黑|举报|DING/.test(b)),
    composerHint: ch.text.includes('长按 / 右键'),
  });
  await page.screenshot({ path: path.join(OUT, 'audit-c-04-channel.png') });

  await ctx.close();
} catch (error) {
  steps.push({ id: 'fatal', ok: false, error: String(error?.message ?? error) });
  console.error(error);
} finally {
  fs.writeFileSync(path.join(OUT, 'audit-c.json'), `${JSON.stringify(steps, null, 2)}\n`, 'utf8');
  await browser.close();
}
