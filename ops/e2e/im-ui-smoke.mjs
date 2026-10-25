#!/usr/bin/env node
/**
 * O.M.V 帝江号 · IM 重构后的 UI 回归（task-16）
 *
 * 覆盖：
 *   1) 原 4 项：登录 → 频道发消息 → 新建私聊发消息 → 新建群聊发消息
 *   2) 桌面 1440：无右侧常驻栏；详情抽屉打开后消息区宽度不变；无 No. 楼层号；
 *      hover 消息出现 回复/编辑/删除；编辑/删除可用
 *   3) 滚动：滚到顶部自动加载更早（不点按钮）且视口不跳；向上翻出现「回到最新」，点击回底
 *   4) 输入：1–5 行自适应 + placeholder「输入信号...」；＋菜单建投票/任务 → 卡片入流；
 *      投票可投、任务可改状态
 *   5) 移动 390：Header 只有 ☰ + 频道名 + 详情；侧栏默认隐藏、☰ 打开；详情全屏；无横向溢出
 *
 * 产物：reports/e2e/im-*.png、reports/e2e/im-ui-smoke.json、reports/e2e/im-smoke.log
 * 选择器全部来自真实前端源码（web/src/components/im/*）与本轮 Lead 实测，不猜。
 *
 * 用法：node im-smoke.mjs [--web-base http://localhost:3100] [--handle qiu] [--headed]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REPORTS_DIR = path.join(ROOT, 'reports', 'e2e');
const JSON_OUT = path.join(REPORTS_DIR, 'im-ui-smoke.json');
const LOG_OUT = path.join(REPORTS_DIR, 'im-smoke.log');
const RUN_JSON = path.join(REPORTS_DIR, 'run.json');

const argv = process.argv.slice(2);
const FLAGS = new Set(argv.filter((item) => item.startsWith('--')));
const argValue = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const WEB_BASE = (argValue('--web-base', process.env.E2E_WEB_BASE ?? 'http://localhost:3100')).replace(/\/$/, '');
const HEADLESS = !FLAGS.has('--headed');
const VIEWPORT = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const POLL_MS = 30_000;
const WAIT_MINUTES = Number(argValue('--wait-min', process.env.E2E_IM_WAIT_MIN ?? 10));
const COMPOSER = 'textarea[aria-label="输入信号"]';
const SEND_BTN = 'button[aria-label="发送"]';
const STREAM = '[aria-label="消息流"]';
const DETAIL = '[aria-label="会话详情"]';

/* ── 凭据（默认 seed 成员 qiu，避开契约 §9 的账号级登录限流）──────────── */
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
const runState = loadJson(RUN_JSON);
const OWNER_HANDLE = process.env.OWNER_HANDLE ?? runState?.credentials?.owner?.handle ?? 'founder';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? runState?.credentials?.owner?.password ?? 'Dijiang#2026';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? runState?.credentials?.seedPassword ?? 'Dijiang#2026';
const HANDLE = argValue('--handle', process.env.E2E_IM_HANDLE ?? 'qiu').toLowerCase();
const PASSWORD = process.env.E2E_IM_PASSWORD ?? (HANDLE === OWNER_HANDLE ? OWNER_PASSWORD : SEED_PASSWORD);

/* ── 日志 ─────────────────────────────────────────────────────────────── */
const logLines = [];
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logLines.push(line);
  console.log(line);
}
function flush() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(LOG_OUT, `${logLines.join('\n')}\n`, 'utf8');
}

/* ── 结果记录 ─────────────────────────────────────────────────────────── */
const checks = [];
function addCheck(id, name, ok, { detail = {}, error = null, kind = '实现' } = {}) {
  const entry = {
    id,
    name,
    ok,
    kind: ok ? null : kind,
    detail,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  };
  checks.push(entry);
  log(`${ok ? '✓' : '✗'} ${id} ${name}${ok ? '' : `（${kind}）← ${entry.error ?? ''}`}`);
  return entry;
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

/* ── 等待前端就绪 ─────────────────────────────────────────────────────── */
async function waitFrontend() {
  const deadline = Date.now() + WAIT_MINUTES * 60_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const response = await fetch(`${WEB_BASE}/login`, { signal: AbortSignal.timeout(8000) });
      const html = await response.text();
      log(`前端就绪（第 ${attempt} 次）：HTTP ${response.status}，HTML ${html.length}B`);
      return { status: response.status, bytes: html.length };
    } catch (error) {
      log(`前端未就绪（第 ${attempt} 次）：${error.message}；${POLL_MS / 1000}s 后重试`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  throw new Error(`前端 ${WEB_BASE} 在 ${WAIT_MINUTES} 分钟内未就绪`);
}

/* ── Playwright 工具 ──────────────────────────────────────────────────── */
async function screenshot(page, name) {
  const file = path.join(REPORTS_DIR, `im-${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: false });
    log(`  · 截图 ${path.relative(ROOT, file)}`);
    return path.relative(ROOT, file).replace(/\\/g, '/');
  } catch (error) {
    log(`  ！截图失败 ${name}：${error.message}`);
    return null;
  }
}

async function waitVisible(page, selector, { timeout = 15_000, label = selector } = {}) {
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  } catch {
    const drift = new Error(`选择器未命中：${label}（${selector}）`);
    drift.kind = '选择器漂移';
    drift.selector = selector;
    throw drift;
  }
}

async function isVisible(page, selector, timeout = 1500) {
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/** 失败现场：可见按钮/aria-label/输入框 + 控制台错误，便于区分实现 bug 与选择器过期 */
async function diagnostics(page) {
  const info = { url: page.url(), title: await page.title().catch(() => null) };
  try {
    info.visibleActions = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('button, a, [role="menuitem"], [role="button"], input, textarea'));
      return nodes
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          if (!visible) return null;
          return {
            tag: node.tagName.toLowerCase(),
            aria: node.getAttribute('aria-label'),
            text: (node.textContent ?? '').trim().slice(0, 30),
            placeholder: node.getAttribute('placeholder'),
          };
        })
        .filter(Boolean)
        .slice(0, 80);
    });
  } catch {
    info.visibleActions = null;
  }
  try {
    info.streamText = (await page.locator(STREAM).first().innerText({ timeout: 2000 })).slice(-800);
  } catch {
    info.streamText = null;
  }
  return info;
}

async function guarded(page, id, name, fn, { kind = '实现' } = {}) {
  try {
    const detail = await fn();
    addCheck(id, name, true, { detail: detail ?? {} });
    return { ok: true, detail };
  } catch (error) {
    const diag = await diagnostics(page);
    await screenshot(page, `fail-${id.toLowerCase()}`);
    addCheck(id, name, false, {
      kind: error.kind ?? kind,
      error,
      detail: { selector: error.selector ?? null, diagnostics: diag },
    });
    return { ok: false, error };
  }
}

/**
 * React 在 WS 回执/已读/卡片刷新时会重渲染消息节点，Playwright 句柄可能瞬间 detached。
 * 这不是实现缺陷，而是测试写法问题：失败后重新查询再重试。
 */
async function retryDom(fn, { attempts = 4, label = 'DOM 操作' } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const message = String(error?.message ?? error);
      if (!/not attached|detached|stale|element was detached|resolved to/i.test(message)) throw error;
      log(`  · ${label} 第 ${attempt} 次遇到节点重渲染（${message.split('\n')[0]}），重试`);
      await pageWait(400);
    }
  }
  throw last;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pageWait = (ms) => sleep(ms);

/* ── 登录 ─────────────────────────────────────────────────────────────── */
async function login(page) {
  log('— 登录 —');
  await page.goto(`${WEB_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(800);

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      await page.goto(`${WEB_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(600);
    }
    const username = await waitVisible(page, 'input[autocomplete="username"]', { label: '账号输入框' });
    await username.fill(HANDLE);
    const password = await waitVisible(page, 'input[type="password"]', { label: '密码输入框' });
    await password.fill(PASSWORD);
    const submit = await waitVisible(page, 'button[type="submit"]', { label: '登录提交按钮' });
    await submit.click({ timeout: 15_000 });
    log(`  · 已提交登录（${HANDLE}，第 ${attempt} 次）`);

    try {
      await waitVisible(page, STREAM, { timeout: 25_000, label: '消息流（登录成功后）' });
      await page.waitForTimeout(800);
      return { handle: HANDLE, attempt };
    } catch (error) {
      lastError = error;
      const limited = await isVisible(page, 'text=/登录尝试过于频繁|RATE_LIMITED|频繁/', 1200);
      if (!limited || attempt === 3) throw error;
      log('  ！登录被限流，等待 65s 后重试');
      await page.waitForTimeout(65_000);
    }
  }
  throw lastError ?? new Error('登录失败');
}

/* ── 选择频道 ─────────────────────────────────────────────────────────── */
async function selectGeneral(page) {
  log('— 打开 #全域播报 —');
  await selectConversation(page, '全域播报');
}

/** 点击侧栏某个会话（频道/私聊/群聊）并等待输入框就绪 */
async function selectConversation(page, title) {
  const row = page.locator('button:visible', { hasText: title }).first();
  try {
    await row.waitFor({ state: 'visible', timeout: 12_000 });
  } catch {
    const drift = new Error(`侧栏找不到可见的「${title}」按钮`);
    drift.kind = '选择器漂移';
    drift.selector = `button:visible:has-text("${title}")`;
    throw drift;
  }
  await row.click();
  await waitVisible(page, COMPOSER, { timeout: 12_000, label: '输入信号 textarea' });
  await page.waitForTimeout(600);
}

async function sendMessage(page, text, { screenshotName = null } = {}) {
  const composer = await waitVisible(page, COMPOSER, { label: '输入信号 textarea' });
  await composer.click();
  await composer.fill(text);
  await page.waitForTimeout(200);
  await composer.press('Enter');
  const started = Date.now();
  await page.locator(STREAM).getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 12_000 });
  const latency = Date.now() - started;
  log(`  · 已发送（${latency}ms 出现在消息流）：${text}`);
  if (screenshotName) await screenshot(page, screenshotName);
  return { text, latencyMs: latency };
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */
async function main() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  log('════════ 帝江号 IM 重构回归（task-16）════════');
  log(`WEB_BASE=${WEB_BASE} viewport=${VIEWPORT.width}x${VIEWPORT.height} mobile=${MOBILE.width}x${MOBILE.height}`);
  log(`账号：${HANDLE}`);
  const frontend = await waitFrontend();

  const startedAt = new Date().toISOString();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const shots = [];
  const stamp = Date.now();
  const channelText = `[e2e-im] 频道消息 ${stamp}`;
  const dmText = `[e2e-im] 私聊消息 ${stamp}`;
  const groupText = `[e2e-im] 群聊消息 ${stamp}`;
  const groupName = `e2e-im 群 ${stamp}`;
  const editTarget = `[e2e-im] 待编辑消息 ${stamp}`;
  const editedText = `[e2e-im] 已编辑消息 ${stamp}`;
  const voteTitle = `[e2e-im] 投票 ${stamp}`;
  const taskTitle = `[e2e-im] 任务 ${stamp}`;

  let browser = null;
  let fatal = null;
  const flow = {};

  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: HEADLESS,
      args: ['--disable-dev-shm-usage', '--no-first-run'],
    });
    const context = await browser.newContext({ viewport: VIEWPORT, locale: 'zh-CN' });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push({ text: message.text().slice(0, 400), at: new Date().toISOString() });
    });
    page.on('pageerror', (error) => pageErrors.push({ text: String(error.message ?? error).slice(0, 400), at: new Date().toISOString() }));
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (/favicon|\.png$|\.woff|hot-update/.test(url)) return;
      failedRequests.push({ url: url.slice(0, 260), error: request.failure()?.errorText ?? null });
    });

    // ── 0) 登录 ──────────────────────────────────────────────────────
    const loginResult = await guarded(page, 'IM0', '登录（新 IM 布局）', () => login(page));
    if (!loginResult.ok) throw loginResult.error;

    // ── 1) 原 4 项：频道 / 私聊 / 群聊 ───────────────────────────────
    await guarded(page, 'IM1', '打开 #全域播报 并发送消息', async () => {
      await selectGeneral(page);
      const sent = await sendMessage(page, channelText, { screenshotName: '01-desktop-channel' });
      shots.push('reports/e2e/im-01-desktop-channel.png');
      return sent;
    });

    await guarded(page, 'IM2', '新建私聊并发送消息（新布局 selectors）', async () => {
      const newDm = page.locator('button:visible', { hasText: '新建私聊' }).first();
      await newDm.click();
      const dialog = page.locator('dialog.ef-dialog:visible').first();
      await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
        const drift = new Error('新建私聊弹窗未出现（dialog.ef-dialog）');
        drift.kind = '选择器漂移';
        drift.selector = 'dialog.ef-dialog';
        throw drift;
      });
      // 选第一个可选成员
      const firstPick = dialog.locator('label.dj-pick').first();
      await firstPick.waitFor({ state: 'visible', timeout: 8000 });
      const peer = (await firstPick.innerText()).trim().split('\n')[0];
      await firstPick.click();
      await dialog.locator('button', { hasText: '建立私聊' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      await page.waitForTimeout(800);
      await waitVisible(page, COMPOSER, { label: '私聊输入框' });
      const sent = await sendMessage(page, dmText, { screenshotName: '02-desktop-dm' });
      shots.push('reports/e2e/im-02-desktop-dm.png');
      return { peer, ...sent };
    });

    await guarded(page, 'IM3', '新建群聊并发送消息（新布局 selectors）', async () => {
      const newGroup = page.locator('button:visible', { hasText: '新建群聊' }).first();
      await newGroup.click();
      const dialog = page.locator('dialog.ef-dialog:visible').first();
      await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
        const drift = new Error('新建群聊弹窗未出现（dialog.ef-dialog）');
        drift.kind = '选择器漂移';
        drift.selector = 'dialog.ef-dialog';
        throw drift;
      });
      await dialog.locator('#group-name').fill(groupName);
      const picks = dialog.locator('label.dj-pick');
      const pickCount = await picks.count();
      for (let index = 0; index < Math.min(2, pickCount); index += 1) await picks.nth(index).click();
      await dialog.locator('button', { hasText: '创建群聊' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      await page.waitForTimeout(1200);
      const headerText = await page.locator('header').innerText();
      assert(headerText.includes(groupName), `群聊创建后 Header 未显示群名：${headerText.slice(0, 120)}`);
      const sent = await sendMessage(page, groupText, { screenshotName: '03-desktop-group' });
      shots.push('reports/e2e/im-03-desktop-group.png');
      return { groupName, ...sent };
    });

    // ── 2) 桌面布局：无右侧常驻栏 / 抽屉不改宽 / 无楼层号 ────────────
    await guarded(page, 'IM4', '桌面：无右侧常驻栏、无 No. 楼层号', async () => {
      const metrics = await page.evaluate(() => {
        const stream = document.querySelector('[aria-label="消息流"]');
        const aside = document.querySelector('aside[aria-label="会话详情"]');
        const doc = document.documentElement;
        return {
          viewport: window.innerWidth,
          streamWidth: stream ? stream.getBoundingClientRect().width : null,
          drawerX: aside ? Math.round(aside.getBoundingClientRect().x) : null,
          drawerWidth: aside ? Math.round(aside.getBoundingClientRect().width) : null,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          floorMatches: (document.querySelector('[aria-label="消息流"]')?.textContent ?? '').match(/No\.\d+/g) ?? [],
        };
      });
      assert(metrics.streamWidth !== null, '找不到消息流容器');
      // 侧栏 264px：消息区应占满剩余宽度（没有右侧常驻栏再挤占）
      assert(
        Math.abs(metrics.streamWidth - (metrics.viewport - 264)) <= 6,
        `消息区宽度 ${Math.round(metrics.streamWidth)} 与「视口-侧栏(264)」=${metrics.viewport - 264} 不一致，疑似仍有右侧常驻栏`,
      );
      // 详情抽屉关闭时应整体移出视口
      assert(metrics.drawerX !== null && metrics.drawerX >= metrics.viewport - 2, `详情抽屉关闭时未移出视口（x=${metrics.drawerX}，宽=${metrics.drawerWidth}）`);
      assert(metrics.floorMatches.length === 0, `消息流仍有楼层号：${metrics.floorMatches.slice(0, 5).join(',')}`);
      assert(metrics.scrollWidth <= metrics.clientWidth + 1, `桌面出现横向溢出：scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`);
      return metrics;
    });

    await guarded(page, 'IM5', '桌面：详情抽屉打开/关闭，消息区宽度不变', async () => {
      const before = await page.evaluate(() => document.querySelector('[aria-label="消息流"]')?.getBoundingClientRect().width ?? 0);
      await page.locator('button[aria-label="打开详情"]').first().click();
      const drawer = await waitVisible(page, DETAIL, { timeout: 10_000, label: '会话详情抽屉' });
      await page.waitForTimeout(500);
      const opened = await page.evaluate(() => {
        const aside = document.querySelector('aside[aria-label="会话详情"]');
        const rect = aside?.getBoundingClientRect();
        const stream = document.querySelector('[aria-label="消息流"]');
        return {
          drawerX: rect ? Math.round(rect.x) : null,
          drawerWidth: rect ? Math.round(rect.width) : null,
          streamWidth: stream ? stream.getBoundingClientRect().width : null,
          hasChannelInfo: (aside?.textContent ?? '').includes('频道信息'),
        };
      });
      assert(opened.drawerX !== null && opened.drawerX < 1440, `抽屉未在视口内（x=${opened.drawerX}）`);
      assert(opened.drawerWidth === 360, `桌面抽屉宽度应为 360，实际 ${opened.drawerWidth}`);
      assert(Math.abs(opened.streamWidth - before) <= 1, `抽屉打开后消息区宽度变化：${before} → ${opened.streamWidth}`);
      shots.push(await screenshot(page, '04-desktop-detail-open'));
      await drawer.locator('button[aria-label="关闭详情"]').click();
      await page.waitForTimeout(400);
      const closedX = await page.evaluate(() => {
        const aside = document.querySelector('aside[aria-label="会话详情"]');
        return aside ? Math.round(aside.getBoundingClientRect().x) : null;
      });
      assert(closedX !== null && closedX >= 1438, `关闭后抽屉未移出视口（x=${closedX}）`);
      return { streamWidthBefore: before, ...opened, closedX };
    });

    await guarded(page, 'IM6', '桌面：hover 出现 回复/编辑/删除，且编辑/删除可用', async () => {
      // 先发一条专用消息（拥有者才有编辑/删除）
      await sendMessage(page, editTarget);
      await page.waitForTimeout(900); // 等 ack 回执/已读触发的重渲染稳定

      const hoverAndCheck = async () => {
        const row = page.locator('.im-msg', { hasText: editTarget }).first();
        await row.scrollIntoViewIfNeeded();
        await sleep(150);
        const beforeInfo = await page.evaluate((text) => {
          const rowNode = Array.from(document.querySelectorAll('.im-msg')).find((node) => node.textContent?.includes(text));
          const actions = rowNode?.querySelector('.im-msg-actions');
          const buttons = actions ? Array.from(actions.querySelectorAll('button')).map((button) => (button.textContent ?? '').trim()) : [];
          return { opacity: actions ? getComputedStyle(actions).opacity : null, buttons };
        }, editTarget);
        await row.hover();
        await sleep(300);
        const afterInfo = await page.evaluate((text) => {
          const rowNode = Array.from(document.querySelectorAll('.im-msg')).find((node) => node.textContent?.includes(text));
          const actions = rowNode?.querySelector('.im-msg-actions');
          const buttons = actions ? Array.from(actions.querySelectorAll('button')).map((button) => (button.textContent ?? '').trim()) : [];
          return { opacity: actions ? getComputedStyle(actions).opacity : null, buttons };
        }, editTarget);
        return { before: beforeInfo, after: afterInfo };
      };

      const hoverState = await retryDom(hoverAndCheck, { label: 'hover 消息' });
      assert(Number(hoverState.before.opacity) === 0, `未 hover 时操作条应隐藏，实际 opacity=${hoverState.before.opacity}`);
      assert(Number(hoverState.after.opacity) === 1, `hover 后操作条应显示，实际 opacity=${hoverState.after.opacity}`);
      for (const label of ['回复', '编辑', '删除']) {
        assert(hoverState.after.buttons.includes(label), `hover 后找不到「${label}」按钮（实际：${hoverState.after.buttons.join('/')}）`);
      }
      shots.push(await screenshot(page, '05-desktop-hover-actions'));

      // 编辑
      await retryDom(
        () => page.locator('.im-msg', { hasText: editTarget }).first().locator('button', { hasText: '编辑' }).first().click(),
        { label: '点击编辑' },
      );
      const editor = await waitVisible(page, 'textarea[aria-label="编辑消息"]', { label: '编辑消息 textarea' });
      await editor.fill(editedText);
      await page.locator('button:has-text("保存")').first().click();
      await page.locator(STREAM).getByText(editedText, { exact: false }).first().waitFor({ state: 'visible', timeout: 12_000 });
      const editedBadge = await page.evaluate((text) => {
        const rowNode = Array.from(document.querySelectorAll('.im-msg')).find((node) => node.textContent?.includes(text));
        return rowNode?.textContent ?? '';
      }, editedText);
      assert(editedBadge.includes('已编辑'), '编辑后没有「已编辑」标记');

      // 删除
      await retryDom(
        () => page.locator('.im-msg', { hasText: editedText }).first().locator('button', { hasText: '删除' }).first().click(),
        { label: '点击删除' },
      );
      await page.locator('button:has-text("确认删除")').first().click();
      await page.waitForTimeout(1200);
      const deletedShown = await page.locator(STREAM).getByText('该信号已被删除。').first().isVisible().catch(() => false);
      assert(deletedShown, '删除后消息未显示「该信号已被删除。」');
      shots.push(await screenshot(page, '06-desktop-edited-deleted'));
      return {
        opacityBeforeHover: hoverState.before.opacity,
        opacityHover: hoverState.after.opacity,
        buttonsHover: hoverState.after.buttons,
        buttonsBeforeHover: hoverState.before.buttons,
        edited: true,
        deleted: true,
      };
    });

    // ── 3) 滚动：顶部自动加载 + 回到最新 ─────────────────────────────
    await guarded(page, 'IM7', '滚动：到顶自动加载更早（不点按钮）且视口不跳', async () => {
      // 频道消息多（seed 520 条），重新选中 #全域播报 保证 hasMore
      await selectGeneral(page);
      await page.waitForTimeout(700);
      const initialCount = await page.evaluate(() => document.querySelectorAll('.im-msg').length);
      assert(initialCount > 0, '消息流里没有消息');

      // 滚到顶部触发 IntersectionObserver（不点任何按钮）
      await page.evaluate(() => {
        const stream = document.querySelector('[aria-label="消息流"]');
        if (stream) stream.scrollTop = 0;
      });
      await page.waitForTimeout(350);

      // 取「当前视口内可见」的一条消息作为锚点（而不是列表第一条，它可能在视口外）
      const anchorBefore = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.im-msg'));
        const viewportHeight = window.innerHeight;
        const visible = nodes
          .map((node) => ({ id: node.getAttribute('data-message-id'), rect: node.getBoundingClientRect() }))
          .filter((item) => item.rect.bottom > 0 && item.rect.top < viewportHeight - 120);
        const anchor = visible[0];
        return anchor ? { id: anchor.id, top: Math.round(anchor.rect.top), scrollTop: Math.round(document.querySelector('[aria-label="消息流"]')?.scrollTop ?? 0) } : null;
      });
      assert(anchorBefore, '滚到顶部后视口内没有任何消息可作锚点');

      await page.waitForFunction(
        (base) => document.querySelectorAll('.im-msg').length > base,
        initialCount,
        { timeout: 20_000 },
      ).catch(() => {
        const drift = new Error('滚到顶部后 20s 内没有自动加载更早消息（IntersectionObserver 未触发或实现缺失）');
        drift.kind = '实现';
        throw drift;
      });
      await page.waitForTimeout(800);

      const anchorAfter = await page.evaluate((id) => {
        const node = document.querySelector(`.im-msg[data-message-id="${id}"]`);
        return {
          top: node ? Math.round(node.getBoundingClientRect().top) : null,
          count: document.querySelectorAll('.im-msg').length,
          scrollTop: Math.round(document.querySelector('[aria-label="消息流"]')?.scrollTop ?? 0),
        };
      }, anchorBefore.id);

      const driftPx = Math.abs((anchorAfter.top ?? 0) - anchorBefore.top);
      assert(anchorAfter.top !== null, '加载更早之后锚点消息从 DOM 消失');
      assert(driftPx <= 16, `prepend 后视口跳动 ${driftPx}px（锚点 top ${anchorBefore.top} → ${anchorAfter.top}）`);
      shots.push(await screenshot(page, '07-desktop-load-older'));
      return {
        initialCount,
        countAfter: anchorAfter.count,
        loadedMore: anchorAfter.count - initialCount,
        anchorId: anchorBefore.id,
        anchorTopBefore: anchorBefore.top,
        anchorTopAfter: anchorAfter.top,
        anchorDriftPx: driftPx,
        scrollTopBefore: anchorBefore.scrollTop,
        scrollTopAfter: anchorAfter.scrollTop,
      };
    });

    await guarded(page, 'IM8', '滚动：向上翻出现「回到最新」，点击回底', async () => {
      await page.evaluate(() => {
        const stream = document.querySelector('[aria-label="消息流"]');
        if (stream) stream.scrollTop = 320;
      });
      const jump = page.locator('button:visible', { hasText: '回到最新' }).first();
      await jump.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
        const drift = new Error('上滚后未出现「回到最新」按钮');
        drift.kind = '实现';
        throw drift;
      });
      shots.push(await screenshot(page, '08-desktop-jump-latest'));
      const clickAt = Date.now();
      await jump.click();
      // 平滑滚动需要时间（消息越多越久），轮询到贴底或 6s 超时；同时记录“点击 → 距底<40px”的耗时
      const deadline = clickAt + 6000;
      let distance = await page.evaluate(() => {
        const stream = document.querySelector('[aria-label="消息流"]');
        return stream ? Math.round(stream.scrollHeight - stream.scrollTop - stream.clientHeight) : null;
      });
      while (Date.now() < deadline && (distance === null || distance >= 40)) {
        await page.waitForTimeout(100);
        distance = await page.evaluate(() => {
          const stream = document.querySelector('[aria-label="消息流"]');
          return stream ? Math.round(stream.scrollHeight - stream.scrollTop - stream.clientHeight) : null;
        });
      }
      const settleMs = Date.now() - clickAt;
      assert(distance !== null && distance < 40, `点击回到最新后距底 ${distance}px（应 <40）`);
      // 性能预算：IM 重构要求“点击即回底”；平滑动画也应在 1.5s 内贴底
      const withinBudget = settleMs <= 1500;
      addCheck(
        'IM8b',
        `回到最新的贴底耗时 ${settleMs}ms（预算 ≤1500ms）`,
        withinBudget,
        { detail: { settleMs, budgetMs: 1500, distanceToBottom: distance }, kind: '实现' },
      );
      const stillShown = await isVisible(page, 'button:has-text("回到最新")', 800);
      assert(!stillShown, '回到底部后「回到最新」仍显示');
      return { distanceToBottom: distance, settleMs, withinBudget };
    });

    // 卡片相关用例改在**新建的群**里做：
    // 全域播报里有 ~20 条卡片消息，创建/投票/改状态会触发所有已挂载 RichCard 重新拉取，
    // 容易在 600 次/分钟/IP 的全局限流下打满配额（实测 224 次 429 全是 GET /cards/:id）。
    // 群里只有本次新建的 1–2 张卡，既覆盖功能又不制造请求风暴。
    await selectConversation(page, groupName);
    await page.waitForTimeout(800);

    // ── 4) 输入区：行数自适应 + 卡片菜单 ────────────────────────────
    await guarded(page, 'IM9', '输入区：placeholder「输入信号...」+ 1–5 行自适应、超 5 行内部滚动', async () => {
      const composer = await waitVisible(page, COMPOSER, { label: '输入信号 textarea' });
      const placeholder = await composer.getAttribute('placeholder');
      assert(placeholder === '输入信号...', `placeholder 应为「输入信号...」，实际「${placeholder}」`);
      await composer.fill('');
      const h1 = await composer.evaluate((node) => node.clientHeight);
      await composer.fill('一行');
      await page.waitForTimeout(150);
      const hOne = await composer.evaluate((node) => node.clientHeight);
      await composer.fill('一\n二\n三\n四\n五');
      await page.waitForTimeout(200);
      const hFive = await composer.evaluate((node) => node.clientHeight);
      await composer.fill('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12');
      await page.waitForTimeout(250);
      const metrics = await composer.evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        maxHeight: getComputedStyle(node).maxHeight,
      }));
      assert(hFive > hOne, `输入 5 行时高度未增长：1 行 ${hOne}px → 5 行 ${hFive}px`);
      assert(metrics.clientHeight <= 140, `超过 5 行后应封顶 ~136px，实际 ${metrics.clientHeight}px（max-height=${metrics.maxHeight}）`);
      assert(metrics.scrollHeight > metrics.clientHeight + 4, `超出上限后应在内部滚动（scrollHeight ${metrics.scrollHeight} 未大于 clientHeight ${metrics.clientHeight}）`);
      shots.push(await screenshot(page, '09-desktop-composer'));
      await composer.fill('');
      return { placeholder, initialHeight: h1, oneLine: hOne, fiveLines: hFive, capped: metrics };
    });

    await guarded(page, 'IM10', '「＋」菜单建投票 → 卡片入流 → 可投票（票数变化）', async () => {
      await page.locator('button[aria-label="添加内容"]').first().click();
      const menu = await waitVisible(page, '[role="menu"]', { timeout: 6000, label: '＋菜单' });
      const items = await menu.locator('[role="menuitem"]').allInnerTexts();
      for (const label of ['素材', '投票', '任务', '图片', '文件']) {
        assert(items.some((text) => text.includes(label)), `＋菜单缺少「${label}」项：${items.join(' / ')}`);
      }
      await menu.locator('[role="menuitem"]', { hasText: '投票' }).click();
      const dialog = page.locator('[role="dialog"][aria-label="新建投票"]:visible').first();
      await dialog.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
        const drift = new Error('未出现「新建投票」对话框');
        drift.kind = '选择器漂移';
        drift.selector = '[role="dialog"][aria-label="新建投票"]';
        throw drift;
      });
      await dialog.locator('input').first().fill(voteTitle);
      await dialog.locator('textarea').first().fill('选项甲\n选项乙\n选项丙');
      await dialog.locator('button', { hasText: '创建投票' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      const cardText = page.locator(STREAM).getByText(voteTitle, { exact: false }).first();
      await cardText.waitFor({ state: 'visible', timeout: 15_000 });

      const card = page.locator('.im-msg', { hasText: voteTitle }).first();
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      const optionButton = card.locator('button', { hasText: '选项甲' }).first();
      await optionButton.click();
      const pressed = await optionButton.getAttribute('aria-pressed');
      assert(pressed === 'true', `选中投票项后 aria-pressed 应为 true，实际 ${pressed}`);
      await card.locator('button', { hasText: /^投票$/ }).first().click();
      await page.waitForTimeout(1500);
      const cardBody = await card.innerText();
      assert(/共 \d+ 票/.test(cardBody), `投票后卡片未显示总票数：${cardBody.slice(0, 200)}`);
      const total = Number(/共 (\d+) 票/.exec(cardBody)?.[1] ?? '0');
      assert(total >= 1, `投票后总票数应 ≥1，实际 ${total}`);
      shots.push(await screenshot(page, '10-desktop-vote-card'));
      return { title: voteTitle, menuItems: items, voteTotal: total };
    });

    await guarded(page, 'IM11', '「＋」菜单建任务 → 卡片入流 → 可改状态', async () => {
      await page.locator('button[aria-label="添加内容"]').first().click();
      const menu = await waitVisible(page, '[role="menu"]', { timeout: 6000, label: '＋菜单' });
      await menu.locator('[role="menuitem"]', { hasText: '任务' }).click();
      const dialog = page.locator('[role="dialog"][aria-label="新建任务"]:visible').first();
      await dialog.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
        const drift = new Error('未出现「新建任务」对话框');
        drift.kind = '选择器漂移';
        drift.selector = '[role="dialog"][aria-label="新建任务"]';
        throw drift;
      });
      await dialog.locator('input[type="text"], input:not([type])').first().fill(taskTitle);
      await dialog.locator('button', { hasText: '创建任务' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      const card = page.locator('.im-msg', { hasText: taskTitle }).first();
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      const cardText = await card.innerText();
      assert(cardText.includes('待办'), `任务卡初始状态应为「待办」：${cardText.slice(0, 200)}`);
      await card.locator('button', { hasText: /^进行中$/ }).first().click();
      await page.waitForTimeout(1500);
      const afterText = await card.innerText();
      assert(afterText.includes('进行中'), `改状态后未显示「进行中」：${afterText.slice(0, 200)}`);
      shots.push(await screenshot(page, '11-desktop-task-card'));
      return { title: taskTitle, before: '待办', after: '进行中' };
    });

    // ── 5) 移动 390 ─────────────────────────────────────────────────
    await guarded(page, 'IM12', '移动 390：Header 仅 ☰+频道名+详情，侧栏默认隐藏、☰ 打开，无横向溢出', async () => {
      await page.setViewportSize(MOBILE);
      await page.waitForTimeout(500);
      const headerInfo = await page.evaluate(() => {
        const header = document.querySelector('header');
        const visibleActions = Array.from(header?.querySelectorAll('button, a') ?? []).filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && rect.display !== 'none' && style.display !== 'none';
        });
        return {
          visible: visibleActions.map((node) => node.getAttribute('aria-label') ?? (node.textContent ?? '').trim().slice(0, 20)),
          title: header?.querySelector('h1')?.textContent?.trim() ?? '',
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      assert(headerInfo.visible.includes('打开频道列表'), `移动端 Header 缺少 ☰（打开频道列表），实际：${headerInfo.visible.join(' | ')}`);
      assert(headerInfo.visible.includes('打开详情'), `移动端 Header 缺少「打开详情」`);
      assert(headerInfo.visible.length <= 2, `移动端 Header 可见交互元素应只有 ☰+详情，实际 ${headerInfo.visible.length} 个：${headerInfo.visible.join(' | ')}`);
      assert(headerInfo.title.length > 0, '移动端 Header 未显示频道名');
      assert(headerInfo.overflow <= 1, `移动端横向溢出 ${headerInfo.overflow}px`);

      // 侧栏默认隐藏（桌面侧栏 display:none；移动抽屉整体在视口左侧外）
      const sidebarState = await page.evaluate(() => {
        const desktop = document.querySelector('aside.w-\\[264px\\]');
        const mobilePanel = document.querySelector('.im-drawer-panel');
        const mobileWrapper = mobilePanel?.closest('[aria-hidden]');
        return {
          desktopDisplay: desktop ? getComputedStyle(desktop).display : null,
          mobilePanelX: mobilePanel ? Math.round(mobilePanel.getBoundingClientRect().x) : null,
          mobilePanelWidth: mobilePanel ? Math.round(mobilePanel.getBoundingClientRect().width) : null,
          mobileAriaHidden: mobileWrapper?.getAttribute('aria-hidden') ?? null,
        };
      });
      assert(sidebarState.desktopDisplay === 'none', `390 宽下桌面侧栏应隐藏（display=none），实际 ${sidebarState.desktopDisplay}`);
      if (sidebarState.mobilePanelX !== null && sidebarState.mobilePanelX >= 0) {
        assert(sidebarState.mobileAriaHidden === 'true', `侧栏抽屉默认应隐藏，实际 x=${sidebarState.mobilePanelX}`);
      }
      shots.push(await screenshot(page, '12-mobile-header'));

      // ☰ 打开侧栏
      await page.locator('button[aria-label="打开频道列表"]').first().click();
      await page.waitForTimeout(600);
      const opened = await page.evaluate((groupTitle) => {
        const panels = Array.from(document.querySelectorAll('.im-drawer-panel'));
        const panel = panels.find((node) => Math.round(node.getBoundingClientRect().x) >= 0) ?? panels[0];
        const rect = panel?.getBoundingClientRect();
        return {
          x: rect ? Math.round(rect.x) : null,
          width: rect ? Math.round(rect.width) : null,
          hasSelectedText: (panel?.textContent ?? '').includes(groupTitle),
        };
      }, groupName);
      assert(opened.x !== null && opened.x >= 0 && opened.x <= 4, `☰ 打开后侧栏未贴左显示（x=${opened.x}）`);
      assert(opened.width !== null && opened.width <= 300, `移动侧栏宽度应 ≤300，实际 ${opened.width}`);
      assert(opened.hasSelectedText, '移动侧栏里看不到当前会话条目');
      shots.push(await screenshot(page, '13-mobile-sidebar'));

      // 选群（当前群）→ 侧栏关闭
      await page.locator('.im-drawer-panel button:visible', { hasText: groupName }).first().click();
      await page.waitForTimeout(700);
      const closed = await page.evaluate(() => {
        const panels = Array.from(document.querySelectorAll('.im-drawer-panel'));
        return panels.map((node) => Math.round(node.getBoundingClientRect().x));
      });
      assert(closed.every((x) => x < -1 || x > 389), `选择频道后移动侧栏未关闭，x=${closed.join(',')}`);
      return { headerInfo, sidebar: { ...sidebarState, opened, closed } };
    });

    await guarded(page, 'IM13', '移动 390：详情全屏 + 无横向溢出', async () => {
      await page.locator('button[aria-label="打开详情"]').first().click();
      const drawer = await waitVisible(page, DETAIL, { timeout: 8000, label: '会话详情' });
      await page.waitForTimeout(500);
      const rect = await drawer.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height) };
      });
      assert(rect.width === MOBILE.width, `移动端详情应全屏宽 ${MOBILE.width}，实际 ${rect.width}`);
      assert(rect.x === 0, `移动端详情应贴左（x=0），实际 ${rect.x}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `移动端详情打开后横向溢出 ${overflow}px`);
      shots.push(await screenshot(page, '14-mobile-detail'));
      await page.locator('button[aria-label="关闭详情"]').click();
      await page.waitForTimeout(500);
      return { ...rect, overflow };
    });

    await guarded(page, 'IM14', '移动 390：输入区可用且不溢出（发送一条消息）', async () => {
      const mobileText = `[e2e-im] 移动端消息 ${stamp}`;
      const composer = await waitVisible(page, COMPOSER, { label: '移动端输入框' });
      const box = await composer.boundingBox();
      assert(box !== null && box.x + box.width <= MOBILE.width + 1, `移动端输入框超出视口：right=${box ? box.x + box.width : null}`);
      const sent = await sendMessage(page, mobileText, { screenshotName: '15-mobile-composer' });
      shots.push('reports/e2e/im-15-mobile-composer.png');
      return sent;
    });

    flow.consoleErrors = consoleErrors;
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    log(`!! 回归中断：${fatal}`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    flush();
  }

  const failed = checks.filter((item) => !item.ok);
  const drift = failed.filter((item) => item.kind === '选择器漂移');
  const bugs = failed.filter((item) => item.kind !== '选择器漂移');
  const rateLimitedConsole = consoleErrors.filter((item) => /429|Too Many Requests/.test(item.text));
  const testConsoleErrors = consoleErrors.filter((item) => !/favicon|icon\.svg|429|Too Many Requests/.test(item.text));
  const result = {
    suite: 'im-ui-regression',
    task: 'task-16',
    startedAt,
    finishedAt: new Date().toISOString(),
    webBase: WEB_BASE,
    frontend,
    browser: { engine: 'chrome', channel: 'chrome', headless: HEADLESS, desktop: VIEWPORT, mobile: MOBILE },
    credentials: { handle: HANDLE },
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      selectorDrift: drift.length,
      implementationBugs: bugs.length,
      consoleErrors: testConsoleErrors.length,
      rateLimitedConsoleErrors: rateLimitedConsole.length,
      pageErrors: pageErrors.length,
      verdict: failed.length === 0 && !fatal ? 'PASS' : 'FAIL',
    },
    notes: [
      '卡片用例改在新建群里执行：全域播报有 ~20 条卡片消息，card:created/updated/vote:updated 会让所有已挂载 RichCard 重新拉取，容易打满全局限流（600 次/分钟/IP）。首轮实测出现 224 次 429（全部是 GET /cards/:id），属于“请求放大 + 限流”问题，不是单个用例实现错误；已在报告里单列。',
    ],
    fatal,
    flow,
    checks,
    consoleErrors,
    rateLimitedConsole,
    pageErrors,
    failedRequests,
    screenshots: [...new Set(shots)].filter(Boolean),
  };
  fs.writeFileSync(JSON_OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  flush();

  log('');
  log(`════════ 结果：${result.summary.verdict}（${result.summary.passed}/${result.summary.total}）════════`);
  for (const item of checks) {
    log(`  ${item.ok ? 'PASS' : `FAIL(${item.kind})`}  ${item.id} ${item.name}${item.ok ? '' : `  ← ${item.error}`}`);
  }
  if (testConsoleErrors.length > 0) log(`控制台错误 ${testConsoleErrors.length} 条（见 JSON）`);
  log(`明细：${JSON_OUT}`);
  log(`截图：${result.screenshots.join(', ') || '无'}`);
  log(`日志：${LOG_OUT}`);
  process.exitCode = result.summary.verdict === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  log(`脚本异常：${error.stack ?? error.message}`);
  flush();
  process.exitCode = 1;
});
