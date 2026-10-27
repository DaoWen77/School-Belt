#!/usr/bin/env node
/**
 * 入口可达性审计 B：IM / 关系 / 交易 / 娱乐 / 治理
 * 每条结论都来自真实点击与可见文本，不读源码代替验证。
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
  console.log(`${ok ? 'OK  ' : 'MISS'} ${id}  ${JSON.stringify(detail).slice(0, 260)}`);
};

async function login(handle) {
  const response = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: PASSWORD }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`login ${handle}: ${response.status}`);
  return payload.data;
}

async function context(browser, data, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: data.accessToken, r: data.refreshToken });
  return ctx;
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
      inputs: Array.from(document.querySelectorAll('input, textarea'))
        .filter(visible)
        .map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute('type') ?? ''}:${el.getAttribute('placeholder') ?? ''}`),
      text: document.body.innerText.replace(/\n{2,}/g, '\n'),
    };
  });

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `audit-b-${name}.png`) });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  /* ── 阶段三 · IM（chen 有 1 条私聊） ───────────────── */
  const chen = await login('chen');
  const cctx = await context(browser, chen);
  const page = await cctx.newPage();
  await page.goto(`${WEB}/belt/direct`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot(page, '01-direct-empty');

  /* 点击侧栏私聊链路 */
  const dmLink = page.locator('a[href*="/belt/direct/"]').first();
  const hasDm = (await dmLink.count()) > 0;
  if (hasDm) {
    await dmLink.click();
    await page.waitForTimeout(1800);
  }
  const dm = await facts(page);
  step('C0 私聊链路可进入', hasDm && /belt\/direct\//.test(dm.url), { url: dm.url, links: dm.links.filter((l) => l.includes('私聊')).slice(0, 3) });
  await shot(page, '02-direct-chat');

  /* 消息 ⋯ 菜单 */
  const more = page.getByRole('button', { name: '消息操作' });
  const hasMore = (await more.count()) > 0;
  if (hasMore) {
    await more.first().click();
    await page.waitForTimeout(500);
  }
  const withMenu = await facts(page);
  const menuItems = withMenu.buttons.filter((b) => /撤回|置顶|隐藏|拉黑|举报|DING|提醒|@|转发/.test(b));
  step('C1 消息长按/⋯ 菜单项', hasMore, { menuItems });
  await shot(page, '03-message-menu');

  /* @ 提及 */
  const composer = page.getByLabel('私聊消息');
  if (await composer.count()) {
    await composer.fill('@');
    await page.waitForTimeout(700);
    const mention = await facts(page);
    const picker = mention.buttons.concat(mention.links).filter((b) => /lin|陈工|成员|提及/.test(b));
    step('C2 输入 @ 是否有成员选择器', picker.length > 0, { picker: picker.slice(0, 6) });
    await composer.fill('@lin 审计测试：请忽略');
    await page.getByRole('button', { name: '发送' }).click().catch(() => {});
    await page.waitForTimeout(1200);
    const sent = await facts(page);
    step('C3 @ 文本是否呈现为提及样式', /@lin/.test(sent.text), {
      bubble: (sent.text.match(/@lin[^\n]{0,30}/) ?? [])[0] ?? null,
    });
    await shot(page, '04-mention-sent');
  } else {
    step('C2 输入 @ 是否有成员选择器', false, { note: '未找到私聊输入框' });
  }

  /* DING 图标 */
  const ding = dm.buttons.concat(dm.inputs).filter((b) => /DING|警报|提醒|强提醒/.test(b));
  step('C4 DING 强提醒入口', ding.length > 0, { found: ding });

  /* 关系绑定 / 续火花 */
  await page.goto(`${WEB}/belt/profile`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '更多操作' }).click().catch(() => {});
  await page.waitForTimeout(400);
  const prof = await facts(page);
  step(
    'C5 关系绑定入口（死党/搭子）是否存在',
    /死党|搭子|羁绊|绑定/.test(prof.text) || prof.buttons.some((b) => /死党|搭子|羁绊/.test(b)),
    { menu: prof.buttons.slice(-8) },
  );
  await shot(page, '05-profile-menu');

  const allPages = {};
  for (const route of ['/belt/channel', '/belt/daily', '/belt/direct', '/belt/bounty', '/belt/organizations']) {
    await page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    allPages[route] = (await facts(page)).text;
  }
  const sparkHits = Object.entries(allPages)
    .filter(([, text]) => /续火花|火花|延续羁绊/.test(text))
    .map(([route]) => route);
  step('C6 续火花入口是否出现在任何主页面', sparkHits.length > 0, { hits: sparkHits });
  await cctx.close();

  /* ── 阶段五 · 治理（Lv5 非风纪） ─────────────────── */
  const creator = await login('creator');
  const lctx = await context(browser, creator);
  const lp = await lctx.newPage();
  await lp.goto(`${WEB}/belt/profile`, { waitUntil: 'domcontentloaded' });
  await lp.waitForTimeout(1600);
  const lv5 = await facts(lp);
  step('E1 Lv5 非风纪委是否出现风纪入口', /风纪工位|风纪委员会/.test(lv5.links.join(' ') + lv5.text), {
    levelBadge: (lv5.text.match(/Lv\s*\d+/) ?? [])[0] ?? null,
    sidebarTribunal: /风纪工位/.test(lv5.text),
  });
  await shot(lp, '06-lv5-no-entry');
  await lp.goto(`${WEB}/belt/moderation`, { waitUntil: 'domcontentloaded' });
  await lp.waitForTimeout(1200);
  const denied = await facts(lp);
  step('E2 直接访问风纪页是否被拒', /权限|拒绝|ERR_|风纪/.test(denied.text) && !/待审/.test(denied.text), {
    body: denied.text.slice(-320),
  });
  await shot(lp, '07-moderation-denied');
  await lctx.close();

  /* ── 阶段五 · Founder 特权 ──────────────────────── */
  const founder = await login('founder');
  const fctx = await context(browser, founder);
  const fp = await fctx.newPage();
  const list = await fetch(`${API}/belt/posts?board=daily&limit=3`, {
    headers: { authorization: `Bearer ${founder.accessToken}` },
  }).then((r) => r.json());
  const postId = list?.data?.items?.[0]?.id;
  if (postId) {
    await fp.goto(`${WEB}/belt/posts/${postId}`, { waitUntil: 'domcontentloaded' });
    await fp.waitForTimeout(1500);
    const fd = await facts(fp);
    step('E3 Founder 帖子菜单 置顶/推送到新闻', /置顶|新闻榜|推送/.test(fd.text), {
      buttons: fd.buttons.filter((b) => /置顶|新闻|推送|删除|编辑|更多/.test(b)),
    });
    await shot(fp, '08-founder-post');
  }

  await fp.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await fp.waitForTimeout(1500);
  const fch = await facts(fp);
  step('E4 环塔内是否有一键发布全服公告入口', /发布公告|公告管理|全服公告.*编辑/.test(fch.text), {
    headerButtons: fch.buttons.slice(0, 10),
  });
  await shot(fp, '09-founder-channel');
  await fctx.close();

  /* ── 阶段四 · 交易 / B站 / 升级反馈 ──────────────── */
  const qiu = await login('qiu');
  const qctx = await context(browser, qiu);
  const qp = await qctx.newPage();
  await qp.goto(`${WEB}/belt/bounty`, { waitUntil: 'domcontentloaded' });
  await qp.waitForTimeout(1400);
  const bounty = await facts(qp);
  step('D1 悬赏发布入口与手续费提示', bounty.buttons.some((b) => /发布新信号/.test(b)), {
    feeHint: /5%|手续费|服务费/.test(bounty.text),
  });
  step(
    'D2 接单/验收/打款入口',
    /接单|验收|打款|申请接单/.test(bounty.text),
    { hits: (bounty.text.match(/接单|验收|打款|申请接单/g) ?? []).slice(0, 5) },
  );
  const videoRoutes = ['/belt/video', '/belt/videos', '/belt/bilibili'];
  const videoStatus = {};
  for (const route of videoRoutes) {
    const response = await qp.request.get(`${WEB}${route}`, { failOnStatusCode: false });
    videoStatus[route] = response.status();
  }
  const navHasVideo = /视频|VIDEO|B站/.test(bounty.links.join(' ') + bounty.text);
  step('D3 B站视频 Tab', navHasVideo || Object.values(videoStatus).some((s) => s === 200), { videoStatus, navHasVideo });
  await qp.goto(`${WEB}/belt/profile`, { waitUntil: 'domcontentloaded' });
  await qp.waitForTimeout(1500);
  const prof2 = await facts(qp);
  step('D4 EXP 进度/飘字反馈', /EXP|经验/.test(prof2.text), {
    expText: (prof2.text.match(/[^\n]*EXP[^\n]*/g) ?? []).slice(0, 3),
    levelBadge: (prof2.text.match(/Lv\s*\d+/) ?? [])[0] ?? null,
  });
  await shot(qp, '10-exp-feedback');
  await qctx.close();
} catch (error) {
  result.fatal = String(error?.stack ?? error);
  console.error(result.fatal);
} finally {
  fs.writeFileSync(path.join(OUT, 'audit-b.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await browser.close();
}
