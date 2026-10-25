/**
 * Sprint2 截图/冒烟（真实 API；不做无关回归）
 * 只验证：代码块、音乐卡、图表卡、贴纸、我的任务、Cmd+K，并收集 console error。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), 'ops', 'e2e', 'node_modules', 'playwright-core'));

const OUT = path.join(process.cwd(), 'reports', 'frontend');
const BASE = 'http://localhost:3100';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HANDLE = process.env.SEED_HANDLE || 'lin';
const PASSWORD = process.env.SEED_PASSWORD || 'Dijiang#2026';
const DISPLAY_NAME = process.env.SEED_DISPLAY_NAME || '林测绘';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', (message) => message.type() === 'error' && errors.push(message.text().slice(0, 400)));
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 400)));
page.on('response', (response) => {
  if (response.status() >= 400) failedRequests.push({ status: response.status(), url: response.url().slice(0, 200) });
});
const report = { shots: {}, checks: {}, errors, pageErrors, failedRequests };
const shot = async (name, target = page) => {
  const file = path.join(OUT, name);
  await target.screenshot({ path: file });
  report.shots[name] = file;
  console.log('SHOT', name);
};

try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[autocomplete="username"]', HANDLE);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await page.waitForTimeout(2200);

  /* 代码块：发送 Markdown 代码块 → 语言标签 + 复制 */
  const code = '```ts\nconst signal = "帝江";\nconsole.log(signal);\n```';
  await page.fill('textarea[aria-label="输入信号"]', code);
  await page.click('button[aria-label="发送"]');
  await page.waitForTimeout(1800);
  report.checks.code = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.md-code')];
    const last = blocks.at(-1);
    return {
      blocks: blocks.length,
      language: last?.querySelector('.md-code-head span')?.textContent ?? null,
      hasCopy: Boolean(last?.querySelector('.md-code-copy')),
      highlighted: Boolean(last?.querySelector('.hljs-keyword, .hljs-string, .hljs-title')),
      text: last?.textContent?.replace(/\n/g, ' | ').slice(0, 120) ?? null,
    };
  });
  const copy = page.locator('.md-code-copy').last();
  if (await copy.count()) {
    await copy.click();
    await page.waitForTimeout(300);
    report.checks.code.copyLabel = await copy.textContent();
  }
  await shot('sprint2-code-1440.png');

  /* 音乐卡 */
  await page.click('button[aria-label="添加内容"]');
  await page.click('button[role="menuitem"]:has-text("音乐")');
  const music = page.locator('[role="dialog"][aria-label="音乐卡片"]');
  await music.waitFor({ timeout: 5000 });
  await music.locator('label', { hasText: '链接' }).locator('input').fill('https://music.163.com/#/song?id=347230');
  await music.locator('label', { hasText: '标题' }).locator('input').fill('Sprint2 测试音乐');
  await music.locator('label', { hasText: '艺人' }).locator('input').fill('帝江号');
  await music.locator('button', { hasText: '创建音乐卡' }).click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('main .im-scroll')].sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(500);
  report.checks.music = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-message-id]')];
    const text = cards.map((card) => card.innerText).filter((value) => value.includes('Sprint2 测试音乐')).at(-1) ?? null;
    return { found: Boolean(text), cardText: text?.replace(/\n/g, ' | ').slice(0, 200) ?? null, iframes: document.querySelectorAll('iframe').length, playerButton: [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('播放音乐')) };
  });
  await shot('sprint2-music-1440.png');

  /* 图表卡 */
  await page.click('button[aria-label="添加内容"]');
  await page.click('button[role="menuitem"]:has-text("图表")');
  const chart = page.locator('[role="dialog"][aria-label="图表卡片"]');
  await chart.waitFor({ timeout: 5000 });
  await chart.locator('button:has-text("柱状")').click();
  await chart.locator('textarea[aria-label="图表 JSON 数据"]').fill('[{"name":"周一","value":12},{"name":"周二","value":18},{"name":"周三","value":9}]');
  await chart.locator('button', { hasText: '创建图表卡' }).click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('main .im-scroll')].sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(700);
  report.checks.chart = await page.evaluate(() => {
    const data = [...document.querySelectorAll('[data-message-id]')].map((node) => node.innerText).join('\n');
    return { found: data.includes('图表'), rechartsSvg: document.querySelectorAll('.recharts-wrapper svg, .recharts-surface').length };
  });
  await shot('sprint2-chart-1440.png');

  /* 贴纸：上传 + 发送 */
  await page.click('button[aria-label="添加内容"]');
  await page.click('button[role="menuitem"]:has-text("贴纸")');
  const panel = page.locator('[role="dialog"][aria-label="贴纸面板"]');
  await panel.waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  const stickerSource = path.join(OUT, 'sprint1-avatar-source.png');
  if (fs.existsSync(stickerSource)) {
    await panel.locator('input[type="file"]').setInputFiles(stickerSource);
    await page.waitForTimeout(5000);
  }
  report.checks.stickers = await page.evaluate(() => ({
    count: document.querySelectorAll('[role="dialog"][aria-label="贴纸面板"] button[aria-label^="发送贴纸"]').length,
    panelText: document.querySelector('[role="dialog"][aria-label="贴纸面板"]')?.innerText.replace(/\n/g, ' | ').slice(0, 300) ?? null,
  }));
  await shot('sprint2-stickers-1440.png');
  const stickerButton = panel.locator('button[aria-label^="发送贴纸"]').first();
  if (await stickerButton.count()) {
    await stickerButton.click();
    await page.waitForTimeout(1600);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('main .im-scroll')].sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);
  }
  report.checks.stickerMessage = await page.evaluate(() => {
    const images = [...document.querySelectorAll('.dj-attach-img.is-sticker img')];
    return { count: images.length, widths: images.map((image) => image.getBoundingClientRect().width) };
  });
  await shot('sprint2-sticker-msg-1440.png');

  /* 我的任务：创建一条指派给自己的任务 */
  await page.click('button[aria-label="添加内容"]');
  await page.click('button[role="menuitem"]:has-text("任务")');
  const task = page.locator('[role="dialog"][aria-label="新建任务"]');
  await task.waitFor({ timeout: 5000 });
  await task.locator('input').first().fill('Sprint2 我的任务');
  const selfLabel = task.locator('label').filter({ hasText: DISPLAY_NAME }).first();
  if (await selfLabel.count()) {
    const checkbox = selfLabel.locator('input[type="checkbox"]');
    await checkbox.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
  }
  await task.locator('button', { hasText: '创建任务' }).click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('main .im-scroll')].sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(500);
  report.checks.tasks = await page.evaluate((title) => {
    const aside = document.querySelector('aside')?.innerText ?? '';
    return { hasTitle: aside.includes(title), section: aside.split('\n').filter((line) => line.includes('我的任务') || line.includes(title)).slice(0, 8) };
  }, 'Sprint2 我的任务');
  await shot('sprint2-tasks-1440.png');
  await shot('sprint2-mytasks-1440.png');

  /* Cmd+K */
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  const palette = page.locator('[role="dialog"][aria-label="命令面板"]');
  await palette.waitFor({ timeout: 5000 });
  await palette.locator('input[aria-label="命令面板输入"]').fill('e2e');
  await page.waitForTimeout(1200);
  report.checks.command = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="命令面板"]');
    return { visible: Boolean(dialog), text: dialog?.innerText.replace(/\n/g, ' | ').slice(0, 500) ?? null };
  });
  await shot('sprint2-command-1440.png');
  await shot('sprint2-cmdk-1440.png');
  await palette.locator('input[aria-label="命令面板输入"]').fill('/goto 素材工坊');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  report.checks.commandGoto = await page.evaluate(() => document.querySelector('header h1')?.textContent ?? null);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  const paletteTasks = page.locator('[role="dialog"][aria-label="命令面板"]');
  await paletteTasks.locator('input[aria-label="命令面板输入"]').fill('/tasks');
  await page.waitForTimeout(900);
  report.checks.commandTasks = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="命令面板"]');
    return { text: dialog?.innerText.replace(/\n/g, ' | ').slice(0, 300) ?? null, hasTask: (dialog?.innerText ?? '').includes('我的任务') };
  });
  await shot('sprint2-cmdk-tasks-1440.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  report.checks.commandEsc = await page.evaluate(() => !document.querySelector('[role="dialog"][aria-label="命令面板"]'));

  /* 390 移动端 */
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const mobile = await mobileContext.newPage();
  mobile.on('console', (message) => message.type() === 'error' && errors.push(`[mobile] ${message.text().slice(0, 300)}`));
  await mobile.goto(BASE);
  await mobile.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await mobile.waitForTimeout(2000);
  await mobile.click('button[aria-label="添加内容"]');
  await mobile.waitForTimeout(300);
  await shot('sprint2-mobile-menu-390.png', mobile);
  report.checks.mobile = await mobile.evaluate(() => ({
    innerWidth: window.innerWidth,
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    menuItems: [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => item.textContent?.trim()),
  }));

  fs.writeFileSync(path.join(OUT, 'sprint2-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await mobileContext.close();
  await context.close();
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error('SPRINT2_FAILED', error);
  await page.screenshot({ path: path.join(OUT, 'sprint2-failure.png') }).catch(() => {});
  fs.writeFileSync(path.join(OUT, 'sprint2-report.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2), 'utf8');
  await browser.close().catch(() => {});
  process.exit(1);
}
