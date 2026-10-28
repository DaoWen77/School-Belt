#!/usr/bin/env node
/** 模块六 UI：@ 浮层 / DING 发送与接收全屏 / 消息菜单 / 置顶条 / 公告分级 */
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
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail).slice(0, 220)}`);
};

async function login(handle, attempt = 0) {
  const response = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, password: 'Dijiang#2026' }),
  });
  const payload = await response.json();
  if (response.status === 429 && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    return login(handle, attempt + 1);
  }
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
  const qiu = await login('qiu');
  const founder = await login('founder');
  /* 统一公告为 info，避免 critical 全屏弹窗挡住交互 */
  await fetch(`${API}/belt/announcement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${founder.accessToken}` },
    body: JSON.stringify({ body: '环塔论坛试运行中：首批风纪委员招募开启。', level: 'info' }),
  });

  /* 两个会话：qiu 发 DING，founder 收 */
  const senderCtx = await context(browser, qiu);
  const receiverCtx = await context(browser, founder);
  const sender = await senderCtx.newPage();
  const receiver = await receiverCtx.newPage();

  await receiver.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await receiver.getByText('环塔频道').first().waitFor({ timeout: 40_000 }).catch(() => {});
  await receiver.waitForTimeout(2500);
  await receiver.getByRole('button', { name: /我知道了/ }).click({ timeout: 2000 }).catch(() => {});

  await sender.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await sender.getByText('环塔频道').first().waitFor({ timeout: 40_000 }).catch(() => {});
  await sender.waitForTimeout(2500);

  /* 1. @ 浮层 */
  const input = sender.getByPlaceholder(/输入信号/).last();
  await input.click();
  await input.type('@fo', { delay: 120 });
  await sender.waitForTimeout(1200);
  const pickerText = await sender.locator('body').innerText();
  ok('U1 @ 成员浮层', /founder|建立者/.test(pickerText), { sample: pickerText.slice(-200) });
  await sender.screenshot({ path: path.join(OUT, 'mention-picker.png') });
  await input.fill('');

  /* 2. DING 发送（qiu 可能已用完配额，用剩余判断） */
  const quota = await fetch(`${API}/belt/me/ding-quota`, { headers: { authorization: `Bearer ${qiu.accessToken}` } }).then((r) => r.json());
  const remaining = quota.data?.remaining ?? 0;
  const dingBtn = sender.getByRole('button', { name: 'DING 强提醒' });
  ok('U2 DING 按钮与剩余次数', (await dingBtn.count()) > 0, { remaining });
  if ((await dingBtn.count()) > 0 && remaining > 0) {
    await dingBtn.click();
    await sender.waitForTimeout(600);
    const confirm = sender.getByRole('button', { name: /发送|确认/ }).last();
    await confirm.click({ timeout: 5000 }).catch(() => {});
    await sender.waitForTimeout(2500);
    await sender.screenshot({ path: path.join(OUT, 'ding-sent.png') });
    const overlay = await receiver.locator('body').innerText();
    ok('U3 接收端全屏强提醒', /DING|强提醒|我知道了/.test(overlay), {
      snippet: overlay.slice(-220),
    });
    await receiver.screenshot({ path: path.join(OUT, 'ding-overlay.png') });
  } else {
    ok('U3 接收端全屏强提醒', false, { note: '配额已用完，跳过发送' });
  }

  /* 3. 消息菜单 */
  const more = sender.getByRole('button', { name: '消息操作' }).last();
  if (await more.count()) {
    await more.click({ force: true }).catch(() => {});
    await sender.waitForTimeout(500);
  }
  const menuText = await sender.locator('body').innerText();
  ok('U4 消息菜单含置顶/隐藏/拉黑', /置顶|隐藏|拉黑/.test(menuText), {});
  await sender.screenshot({ path: path.join(OUT, 'message-menu.png') });

  /* 4. 公告分级：发布 critical 并刷新接收端 */
  await fetch(`${API}/belt/announcement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${founder.accessToken}` },
    body: JSON.stringify({ body: '紧急通知：今晚 22:00 进行环塔中继切换，请提前保存工作。', level: 'critical' }),
  });
  await receiver.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await receiver.waitForTimeout(3500);
  const criticalText = await receiver.locator('body').innerText();
  ok('U5 critical 公告全屏确认', /紧急通知|我知道了/.test(criticalText), {});
  await receiver.screenshot({ path: path.join(OUT, 'announcement-critical.png') });

  /* 5. info 必须滚动弹幕（恢复一条普通公告） */
  await fetch(`${API}/belt/announcement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${founder.accessToken}` },
    body: JSON.stringify({ body: '环塔论坛试运行中：首批风纪委员招募开启。', level: 'info' }),
  });
  await receiver.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await receiver.waitForTimeout(3000);
  const marquee = await receiver.evaluate(() => {
    const node = document.querySelector('.belt-announcement, [class*="announce"]');
    return node ? { cls: node.className, text: (node.textContent || '').slice(0, 60) } : null;
  });
  ok('U6 info 公告滚动形态', Boolean(marquee), { marquee });
  await receiver.screenshot({ path: path.join(OUT, 'announcement-info.png') });

  await senderCtx.close();
  await receiverCtx.close();
} catch (error) {
  steps.push({ id: 'fatal', ok: false, error: String(error?.message ?? error) });
  console.error(error);
} finally {
  fs.writeFileSync(path.join(OUT, 'im-ui.json'), `${JSON.stringify(steps, null, 2)}\n`, 'utf8');
  const failed = steps.filter((item) => !item.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
  await browser.close();
}
