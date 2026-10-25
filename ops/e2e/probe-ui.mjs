#!/usr/bin/env node
/** 一次性 DOM 探针：登录页/主界面的可操作元素清单，用于把 smoke-ui 的选择器对齐真实前端 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'ui-probe.json');
const WEB = process.env.E2E_WEB_BASE ?? 'http://localhost:3100';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
});

await page.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(2500);

const snapshot = async (tag) => ({
  tag,
  url: page.url(),
  title: await page.title(),
  bodyText: (await page.locator('body').innerText()).slice(0, 3000),
  buttons: await page
    .locator('button, [role="button"], a[href]')
    .evaluateAll((nodes) =>
      nodes
        .map((n) => ({
          tag: n.tagName.toLowerCase(),
          text: (n.innerText || '').trim().slice(0, 60),
          aria: n.getAttribute('aria-label'),
          testid: n.getAttribute('data-testid'),
          href: n.getAttribute('href'),
        }))
        .filter((n) => n.text || n.aria || n.testid),
    ),
  inputs: await page.locator('input, textarea, [contenteditable="true"]').evaluateAll((nodes) =>
    nodes.map((n) => ({
      tag: n.tagName.toLowerCase(),
      type: n.getAttribute('type'),
      name: n.getAttribute('name'),
      placeholder: n.getAttribute('placeholder'),
      aria: n.getAttribute('aria-label'),
      testid: n.getAttribute('data-testid'),
      autocomplete: n.getAttribute('autocomplete'),
    })),
  ),
  testids: await page.locator('[data-testid]').evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute('data-testid')).slice(0, 120),
  ),
});

const result = { web: WEB, step1: await snapshot('landing'), errors };
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
await page.screenshot({ path: path.join(ROOT, 'reports', 'e2e', 'ui-probe-landing.png'), fullPage: true });
console.log(JSON.stringify(result, null, 2).slice(0, 8000));
await browser.close();
