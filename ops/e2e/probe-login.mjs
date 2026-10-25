#!/usr/bin/env node
/** 登录表单结构探针：确认提交按钮与表单边界 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WEB = process.env.E2E_WEB_BASE ?? 'http://localhost:3100';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const requests = [];
page.on('request', (r) => {
  if (r.url().includes('/api/')) requests.push({ method: r.method(), url: r.url(), body: r.postData()?.slice(0, 200) });
});
page.on('response', async (r) => {
  if (r.url().includes('/api/')) {
    const existing = requests.find((x) => x.url === r.url() && !x.status);
    const body = await r.text().catch(() => '');
    if (existing) {
      existing.status = r.status();
      existing.response = body.slice(0, 400);
    }
  }
});

await page.goto(`${WEB}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(1500);

const forms = await page.locator('form').evaluateAll((nodes) =>
  nodes.map((n) => ({
    html: n.outerHTML.slice(0, 3000),
    buttons: Array.from(n.querySelectorAll('button')).map((b) => ({ text: b.innerText.trim(), type: b.type })),
  })),
);

// 填表 + 回车提交
await page.locator('input[autocomplete="username"]').fill('founder');
await page.locator('input[type="password"]').fill('Dijiang#2026');
await page.locator('input[type="password"]').press('Enter');
await page.waitForTimeout(4000);

const after = {
  url: page.url(),
  bodyText: (await page.locator('body').innerText()).slice(0, 1500),
  buttons: await page.locator('button').evaluateAll((nodes) => nodes.map((n) => n.innerText.trim()).filter(Boolean)),
  links: await page.locator('a[href]').evaluateAll((nodes) => nodes.map((n) => ({ text: n.innerText.trim().slice(0, 30), href: n.getAttribute('href') }))),
};
await page.screenshot({ path: path.join(ROOT, 'reports', 'e2e', 'ui-probe-after-login.png'), fullPage: true });
const out = { forms: forms.map((f) => ({ buttons: f.buttons, html: f.html.slice(0, 1200) })), requests, after };
fs.writeFileSync(path.join(ROOT, 'reports', 'e2e', 'ui-probe-login.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
await browser.close();
