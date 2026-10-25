#!/usr/bin/env node
/** 主界面探针：登录后 dump 侧栏/输入框/新建私聊/新建群聊的 DOM 结构 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WEB = process.env.E2E_WEB_BASE ?? 'http://localhost:3100';
const OUT = path.join(ROOT, 'reports', 'e2e', 'ui-probe-main.json');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e)));

const dump = async (tag) => ({
  tag,
  url: page.url(),
  buttons: await page.locator('button, [role="button"]').evaluateAll((nodes) =>
    nodes
      .map((n) => ({ text: n.innerText.trim().slice(0, 50), cls: n.className?.slice?.(0, 60), testid: n.getAttribute('data-testid') }))
      .filter((n) => n.text),
  ),
  links: await page.locator('a[href]').evaluateAll((nodes) =>
    nodes.map((n) => ({ text: n.innerText.trim().slice(0, 40), href: n.getAttribute('href') })).filter((n) => n.text),
  ),
  inputs: await page.locator('input, textarea, [contenteditable="true"]').evaluateAll((nodes) =>
    nodes.map((n) => ({
      tag: n.tagName.toLowerCase(),
      type: n.getAttribute('type'),
      placeholder: n.getAttribute('placeholder'),
      aria: n.getAttribute('aria-label'),
      testid: n.getAttribute('data-testid'),
      cls: n.className?.slice?.(0, 60),
      visible: !!(n.offsetWidth || n.offsetHeight),
    })),
  ),
  testids: await page.locator('[data-testid]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')).slice(0, 150)),
  dialogs: await page.locator('[role="dialog"], .ef-modal, .dj-modal, dialog').evaluateAll((nodes) =>
    nodes.map((n) => ({ cls: n.className?.slice?.(0, 80), text: n.innerText.trim().slice(0, 500) })),
  ),
});

await page.goto(`${WEB}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
await page.locator('input[autocomplete="username"]').fill('founder');
await page.locator('input[type="password"]').fill('Dijiang#2026');
await page.locator('form button[type="submit"]').click();
await page.waitForTimeout(4000);

const out = { errors, main: await dump('main') };
await page.screenshot({ path: path.join(ROOT, 'reports', 'e2e', 'ui-probe-main.png'), fullPage: true });

// 打开“新建私聊”
try {
  await page.getByRole('button', { name: /新建私聊/ }).first().click();
  await page.waitForTimeout(1500);
  out.dmPicker = await dump('dm-picker');
  await page.screenshot({ path: path.join(ROOT, 'reports', 'e2e', 'ui-probe-dm.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
} catch (error) {
  out.dmPickerError = String(error.message ?? error).slice(0, 300);
}

// 打开“新建群聊”
try {
  await page.getByRole('button', { name: /新建群聊/ }).first().click();
  await page.waitForTimeout(1500);
  out.groupPicker = await dump('group-picker');
  await page.screenshot({ path: path.join(ROOT, 'reports', 'e2e', 'ui-probe-group.png'), fullPage: true });
} catch (error) {
  out.groupPickerError = String(error.message ?? error).slice(0, 300);
}

fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(out, null, 2).slice(0, 12000));
await browser.close();
