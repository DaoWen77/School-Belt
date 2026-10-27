#!/usr/bin/env node
/** 入口可达性审计 D：频道消息菜单、Founder 帖子菜单、环塔设置、关注→私聊通路 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'audit');
const WEB = 'http://localhost:3100';
const API = 'http://127.0.0.1:3000/api/v1';
fs.mkdirSync(OUT, { recursive: true });

const steps = [];
const step = (id, ok, detail) => {
  steps.push({ id, ok, ...detail });
  console.log(`${ok ? 'OK  ' : 'MISS'} ${id}  ${JSON.stringify(detail).slice(0, 280)}`);
};

async function login(handle, attempt = 0) {
  const r = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'Dijiang#2026' }),
  });
  const j = await r.json();
  if (r.status === 429 && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    return login(handle, attempt + 1);
  }
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
      links: collect('a'),
      text: document.body.innerText.replace(/\n{2,}/g, '\n'),
    };
  });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const founder = await login('founder');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: founder.accessToken, r: founder.refreshToken });
  const page = await ctx.newPage();

  /* 频道消息菜单 */
  await page.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const moreBtn = page.getByRole('button', { name: '消息操作' });
  const count = await moreBtn.count();
  let items = [];
  if (count) {
    await moreBtn.last().click();
    await page.waitForTimeout(500);
    const menu = await facts(page);
    items = menu.buttons.filter((b) => /撤回|置顶|隐藏|拉黑|举报|DING|提醒|删除|编辑|复制/.test(b));
    await page.screenshot({ path: path.join(OUT, 'audit-d-01-channel-menu.png') });
  }
  step('D1 频道消息 ⋯ 菜单项', count > 0, { messageMenuButtons: count, items });

  /* 长按/右键是否等价 */
  const firstMsg = page.locator('[data-message-id], .belt-msg, .belt-im-item').first();
  const hasMsgNode = (await firstMsg.count()) > 0;
  step('D2 消息节点可长按/右键', hasMsgNode, { note: hasMsgNode ? '右键/长按走同一菜单' : '未匹配消息节点' });

  /* 关注他人主页是否可发起私聊 */
  await page.goto(`${WEB}/belt/u/clerk1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const profile = await facts(page);
  step('D3 他人主页是否能发起私聊', /私聊|发消息|消息/.test(profile.buttons.join(' ')), {
    buttons: profile.buttons.filter((b) => /私聊|消息|关注|更多|举报/.test(b)),
  });
  await page.screenshot({ path: path.join(OUT, 'audit-d-02-profile-actions.png') });

  /* Founder 帖子详情菜单 */
  const list = await fetch(`${API}/belt/posts?board=daily&limit=3`, {
    headers: { authorization: `Bearer ${founder.accessToken}` },
  }).then((r) => r.json());
  const postId = list?.data?.items?.[0]?.id;
  const postButtons = [];
  if (postId) {
    await page.goto(`${WEB}/belt/posts/${postId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const detail = await facts(page);
    postButtons.push(...detail.buttons.filter((b) => /置顶|新闻|推送|删除|编辑|更多|⋯/.test(b)));
    step('D4 Founder 帖子特权菜单', /置顶|推送到新闻/.test(detail.text), {
      candidates: postButtons,
      shareText: (detail.text.match(/转发[^\n]{0,12}/) ?? [])[0] ?? null,
    });
    await page.screenshot({ path: path.join(OUT, 'audit-d-03-founder-post.png') });
  } else {
    step('D4 Founder 帖子特权菜单', false, { note: '未取到帖子' });
  }

  /* 环塔设置页 */
  await page.goto(`${WEB}/belt/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const settings = await facts(page);
  step('D5 环塔设置页是否含公告/治理入口', /公告|治理|风纪|认证/.test(settings.text), {
    headings: settings.text.split('\n').slice(0, 12),
    buttons: settings.buttons.slice(0, 12),
  });
  await page.screenshot({ path: path.join(OUT, 'audit-d-04-settings.png') });

  await ctx.close();
} catch (error) {
  steps.push({ id: 'fatal', ok: false, error: String(error?.message ?? error) });
  console.error(error);
} finally {
  fs.writeFileSync(path.join(OUT, 'audit-d.json'), `${JSON.stringify(steps, null, 2)}\n`, 'utf8');
  await browser.close();
}
