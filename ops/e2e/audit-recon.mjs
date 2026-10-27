#!/usr/bin/env node
/** 入口可达性审计 · 侦察：抓取各关键页面的可见控件文本（不形成结论，只收集事实） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'audit-recon');
const WEB = 'http://localhost:3100';
const API = 'http://127.0.0.1:3000/api/v1';
fs.mkdirSync(OUT, { recursive: true });

async function login(handle) {
  const response = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'Dijiang#2026' }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`login ${handle}: ${response.status} ${JSON.stringify(payload.error)}`);
  return payload.data;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {};

function collect(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const take = (selector, limit = 80) =>
      Array.from(document.querySelectorAll(selector))
        .filter(visible)
        .slice(0, limit)
        .map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    return {
      title: document.title,
      url: location.pathname + location.search,
      h1: take('h1, h2', 10),
      buttons: take('button', 60),
      links: take('a', 60),
      inputs: Array.from(document.querySelectorAll('input, textarea, select'))
        .filter(visible)
        .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute('type') || el.tagName.toLowerCase()}] placeholder=${el.getAttribute('placeholder') || ''} name=${el.getAttribute('name') || ''}`)
        .slice(0, 20),
      text: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1200),
    };
  });
}

async function visit(page, key, url, waitText) {
  await page.goto(`${WEB}${url}`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  if (waitText) {
    await page.getByText(waitText).first().waitFor({ timeout: 12_000 }).catch(() => {});
  }
  await page.waitForTimeout(700);
  report[key] = await collect(page);
  await page.screenshot({ path: path.join(OUT, `${key}.png`), fullPage: false });
  console.log(`· ${key} ${report[key].url}`);
}

try {
  /* 游客 */
  const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const g = await guest.newPage();
  await visit(g, 'guest-home', '/', null);
  await visit(g, 'guest-belt-login', '/belt/login', null);
  await visit(g, 'guest-belt-register', '/belt/register', null);
  await guest.close();

  /* 普通成员 */
  const qiu = await login('qiu');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: qiu.accessToken, r: qiu.refreshToken });
  const page = await ctx.newPage();
  await visit(page, 'member-daily', '/belt/daily', '干员日常');
  await visit(page, 'member-dispatch', '/belt/dispatch', null);
  await visit(page, 'member-bounty', '/belt/bounty', '悬赏委托');
  await visit(page, 'member-direct', '/belt/direct', null);
  await visit(page, 'member-profile', '/belt/profile', '发布的帖子');

  /* 帖子详情：从会员 token 里拿一个真实 postId */
  const list = await fetch(`${API}/belt/posts?board=daily&limit=5`, {
    headers: { authorization: `Bearer ${qiu.accessToken}` },
  }).then((r) => r.json());
  const postId = list?.data?.items?.[0]?.id ?? list?.data?.posts?.[0]?.id;
  report.postList = { keys: Object.keys(list?.data ?? {}), postId };
  if (postId) await visit(page, 'member-post-detail', `/belt/posts/${postId}`, null);

  /* Founder */
  const founder = await login('founder');
  const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await fctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: founder.accessToken, r: founder.refreshToken });
  const fp = await fctx.newPage();
  await visit(fp, 'founder-channel', '/belt/channel', null);
  if (postId) await visit(fp, 'founder-post-detail', `/belt/posts/${postId}`, null);
  await visit(fp, 'founder-settings', '/settings', null);
  await visit(fp, 'founder-profile', '/belt/profile', '发布的帖子');
  await fctx.close();

  fs.writeFileSync(path.join(OUT, 'recon.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('saved', path.relative(ROOT, path.join(OUT, 'recon.json')));
} catch (error) {
  console.error(error);
  fs.writeFileSync(path.join(OUT, 'recon.json'), `${JSON.stringify({ ...report, fatal: String(error?.stack ?? error) }, null, 2)}\n`, 'utf8');
  process.exitCode = 1;
} finally {
  await browser.close();
}
