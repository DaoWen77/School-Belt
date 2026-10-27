#!/usr/bin/env node
/**
 * 入口可达性审计 A：新用户入驻 + 内容消费
 * 只记录"真实点击后看到了什么"，不读源码猜结论。
 * 产物：reports/e2e/audit-a.json + audit-a-*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'audit');
const WEB = 'http://localhost:3100';
const API = 'http://127.0.0.1:3000/api/v1';
const PASSWORD = 'Dijiang#2026';
fs.mkdirSync(OUT, { recursive: true });

const result = { steps: [] };
const step = (id, ok, detail) => {
  result.steps.push({ id, ok, ...detail });
  console.log(`${ok ? 'OK  ' : 'MISS'} ${id}  ${JSON.stringify(detail).slice(0, 240)}`);
};

async function login(handle, password = PASSWORD) {
  const response = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`login ${handle}: ${response.status}`);
  return payload.data;
}

function visible(page, selector, text) {
  return page.evaluate(
    ({ selector, text }) => {
      const nodes = Array.from(document.querySelectorAll(selector || '*')).filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const list = nodes.map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim());
      if (!text) return list.slice(0, 200);
      return list.filter((value) => value.includes(text));
    },
    { selector, text },
  );
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `audit-a-${name}.png`) });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  /* ── 阶段一 · 游客首屏 ─────────────────────────────── */
  const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const g = await guest.newPage();
  await g.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
  await g.waitForTimeout(800);
  await shot(g, '01-guest-first-screen');
  const firstScreen = await pageFacts(g);
  step('A1 游客首屏是否可见注册入口', firstScreen.buttons.some((b) => b.includes('注册')), {
    url: g.url(),
    buttons: firstScreen.buttons,
  });

  /* 点「邀请码注册」看它到底要什么 */
  const inviteBtn = g.getByRole('button', { name: /邀请码注册/ });
  if (await inviteBtn.count()) {
    await inviteBtn.first().click();
    await g.waitForTimeout(600);
    const after = await pageFacts(g);
    step('A2 首屏注册是否要邀请码', after.inputs.some((i) => /invite|邀请/i.test(i)) || after.text.includes('邀请码'), {
      inputs: after.inputs,
      text: after.text.slice(0, 400),
    });
    await shot(g, '02-invite-register');
  } else {
    step('A2 首屏注册是否要邀请码', false, { note: '未找到邀请码注册按钮' });
  }

  /* ── 阶段一 · 环带注册 ─────────────────────────────── */
  await g.goto(`${WEB}/belt/register`, { waitUntil: 'domcontentloaded' });
  await g.waitForTimeout(600);
  const regFacts = await pageFacts(g);
  step('A3 环带注册是否选填邀请码', regFacts.inputs.some((i) => /invite|邀请|邀请码/i.test(i)), {
    inputs: regFacts.inputs,
    buttons: regFacts.buttons,
  });
  await shot(g, '03-belt-register');

  const handle = `audit${Date.now().toString().slice(-6)}`;
  await g.locator('input').nth(0).fill(handle).catch(() => {});
  await g.locator('input').nth(1).fill('审计新兵').catch(() => {});
  await g.locator('input[type=password]').fill('Audit#2026').catch(() => {});
  await g.getByRole('button', { name: /申请接入/ }).first().click().catch(() => {});
  await g.waitForTimeout(2500);
  const afterReg = await pageFacts(g);
  const tokens = await g.evaluate(() => ({
    access: localStorage.getItem('dj.belt.access'),
    refresh: localStorage.getItem('dj.belt.refresh'),
  }));
  step('A4 环带注册后是否直接进入环塔', Boolean(tokens.access), {
    url: g.url(),
    text: afterReg.text.slice(0, 300),
  });
  await shot(g, '04-after-register');

  /* 新用户主页 */
  await g.goto(`${WEB}/belt/profile`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await g.waitForTimeout(1500);
  const newProfile = await pageFacts(g);
  step('A5 新用户主页显示 Lv0', /Lv\s*0|Lv0/.test(newProfile.text), { text: newProfile.text.slice(0, 300) });
  step('A6 新用户主页显示 50 商券', /商券/.test(newProfile.text), { hasCouponWord: /商券/.test(newProfile.text) });
  step('A7 新用户空状态提示', /还没有发布的帖子|暂无/.test(newProfile.text), {
    emptyHint: (newProfile.text.match(/还没有[^\n]*/) ?? [])[0] ?? null,
  });
  await shot(g, '05-new-user-profile');
  await guest.close();

  /* ── 阶段二 · 内容消费（qiu） ───────────────────────── */
  const qiu = await login('qiu');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: qiu.accessToken, r: qiu.refreshToken });
  const page = await ctx.newPage();

  await page.goto(`${WEB}/belt/daily`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const daily = await pageFacts(page);
  const feedTabs = daily.buttons.filter((b) => /动态|校园|日常|墙/.test(b));
  step('B1 三合一信息流 Tab（动态墙/校园墙/干员日常）', feedTabs.length >= 2 && /动态|校园/.test(feedTabs.join(' ')), {
    candidateTabs: feedTabs,
    bodyHasDynamic: daily.text.includes('动态墙'),
    bodyHasCampus: daily.text.includes('校园墙'),
  });
  await shot(page, '06-daily-feed');

  /* 头像/作者是否可点进个人主页 */
  const avatarLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/belt/u/"]')).map((a) => a.getAttribute('href')).slice(0, 5),
  );
  const feedPostAnchor = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/belt/posts/"]')).map((a) => a.getAttribute('href')).slice(0, 3),
  );
  step('B2 信息流作者头像/昵称可进个人主页', avatarLinks.length > 0, { avatarLinks, feedPostAnchor });

  /* 帖子详情互动 */
  if (feedPostAnchor[0]) {
    await page.goto(`${WEB}${feedPostAnchor[0]}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const detail = await pageFacts(page);
    const menus = detail.buttons.filter((b) => /收藏|转发|分享|打赏|举报|更多|⋯/.test(b));
    step('B3 互动常驻区', detail.buttons.some((b) => /认同|点赞/.test(b)) && detail.buttons.some((b) => /转发|分享/.test(b)), {
      buttons: detail.buttons,
    });
    step('B4 收藏/打赏/举报是否可达', /收藏/.test(detail.text) || /打赏/.test(detail.text) || /举报/.test(detail.text), {
      menus,
      textHas: {
        collect: detail.text.includes('收藏'),
        tip: detail.text.includes('打赏'),
        report: detail.text.includes('举报'),
      },
    });
    await shot(page, '07-post-detail');
  }

  /* 发帖面板：匿名开关 */
  await page.goto(`${WEB}/belt/bounty`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const postBtn = page.getByRole('button', { name: /发布新信号/ });
  if (await postBtn.count()) {
    await postBtn.first().click();
    await page.waitForTimeout(800);
    const composer = await pageFacts(page);
    step('B5 发帖面板匿名开关', /匿名/.test(composer.text), {
      text: composer.text.slice(0, 500),
      inputs: composer.inputs,
    });
    await shot(page, '08-composer');
    await page.keyboard.press('Escape').catch(() => {});
  } else {
    step('B5 发帖面板匿名开关', false, { note: '未找到发布按钮' });
  }

  /* 关注链路 */
  await page.goto(`${WEB}/belt/u/creator`, { waitUntil: 'domcontentloaded' });
  await page.getByText('发布的帖子').first().waitFor({ timeout: 15_000 }).catch(() => {});
  const beforeFollow = await pageFacts(page);
  const followBtn = page.getByRole('button', { name: /^关注$/ });
  const hadFollow = (await followBtn.count()) > 0;
  if (hadFollow) {
    await followBtn.first().click();
    await page.waitForTimeout(1200);
  }
  const afterFollow = await pageFacts(page);
  step('B6 关注按钮可见且点击后状态/数字变化', hadFollow && /已关注/.test(afterFollow.text), {
    before: (beforeFollow.text.match(/(\d+)\s*粉丝/) ?? [])[0] ?? null,
    after: (afterFollow.text.match(/(\d+)\s*粉丝/) ?? [])[0] ?? null,
  });
  await shot(page, '09-follow-state');
  await ctx.close();
} catch (error) {
  result.fatal = String(error?.stack ?? error);
  console.error(result.fatal);
} finally {
  fs.writeFileSync(path.join(OUT, 'audit-a.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await browser.close();
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const collect = (selector) =>
      Array.from(document.querySelectorAll(selector))
        .filter(isVisible)
        .map((el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 120);
    return {
      url: location.pathname + location.search,
      buttons: collect('button'),
      inputs: Array.from(document.querySelectorAll('input, textarea'))
        .filter(isVisible)
        .map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute('type') ?? ''}:${el.getAttribute('placeholder') ?? ''}`)
        .slice(0, 20),
      text: document.body.innerText.replace(/\n{2,}/g, '\n'),
    };
  });
}
