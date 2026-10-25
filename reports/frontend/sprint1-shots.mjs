/**
 * Sprint1 真实验收：长按 ActionSheet / Virtuoso / 资料+头像+状态前缀 / 群公告+危险区+踢人确认 / 侧栏置顶
 * 真实 API 3000、Web 3100。只写 reports/frontend/**。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), 'ops', 'e2e', 'node_modules', 'playwright-core'));

const OUT = path.join(process.cwd(), 'reports', 'frontend');
const BASE = 'http://localhost:3100';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HANDLE = process.env.SEED_HANDLE || 'founder';
const PASSWORD = process.env.SEED_PASSWORD || 'Dijiang#2026';
const stamp = Date.now();
const GROUP_NAME = `Sprint1 临时群 ${stamp}`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const pageErrors = [];
page.on('console', (message) => message.type() === 'error' && errors.push(message.text().slice(0, 400)));
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 400)));

const report = { shots: {}, checks: {}, errors, pageErrors };
const shot = async (name, target = page, options = {}) => {
  const file = path.join(OUT, name);
  await target.screenshot({ path: file, ...options });
  report.shots[name] = file;
  console.log('SHOT', name);
};

const scrollerInfo = (target = page) =>
  target.evaluate(() => {
    const scrollers = [...document.querySelectorAll('main .im-scroll')];
    const scroller = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    return {
      scrollTop: scroller?.scrollTop ?? null,
      scrollHeight: scroller?.scrollHeight ?? null,
      clientHeight: scroller?.clientHeight ?? null,
      distance: scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : null,
      rendered: document.querySelectorAll('[data-message-id]').length,
      jumpVisible: [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('回到最新') && button.offsetParent),
    };
  });

const scrollTop = async (target = page) => {
  await target.evaluate(() => {
    const scrollers = [...document.querySelectorAll('main .im-scroll')];
    const scroller = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (scroller) scroller.scrollTop = 0;
  });
};

async function login(target = page) {
  await target.goto(`${BASE}/login`);
  await target.fill('input[autocomplete="username"]', HANDLE);
  await target.fill('input[type="password"]', PASSWORD);
  await target.click('button[type="submit"]');
  await target.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await target.waitForTimeout(2200);
}

try {
  console.log('STEP login');
  await login();
  report.checks.initial = await scrollerInfo();
  await shot('sprint1-desktop-1440.png');

  /* ── Virtuoso：上滚加载更早，DOM 节点数应远小于已加载条数 ── */
  console.log('STEP virtuoso');
  const beforeLoad = await scrollerInfo();
  let pagesLoaded = 0;
  let lastHeight = beforeLoad.scrollHeight ?? 0;
  for (let index = 0; index < 7; index += 1) {
    await scrollTop();
    await page.waitForTimeout(1200);
    const info = await scrollerInfo();
    if ((info.scrollHeight ?? 0) > lastHeight + 100) {
      pagesLoaded += 1;
      lastHeight = info.scrollHeight ?? lastHeight;
    } else {
      break;
    }
    if (info.rendered > 80) break;
  }
  const loaded = await scrollerInfo();
  report.checks.virtuoso = {
    pagesLoaded,
    loadedHeight: loaded.scrollHeight,
    renderedNodes: loaded.rendered,
    scrollTop: loaded.scrollTop,
    jumpVisible: loaded.jumpVisible,
  };
  await shot('sprint1-virtuoso-1440.png');
  if (loaded.jumpVisible) {
    await page.locator('button', { hasText: '回到最新' }).click();
    await page.waitForTimeout(1000);
  }
  report.checks.afterJump = await scrollerInfo();

  /* ── 侧栏置顶：点击图钉 → 顺序 + localStorage → 刷新后保持 ── */
  console.log('STEP pins');
  const pinButton = page.locator('button[aria-label="置顶 素材工坊"]');
  if (await pinButton.count()) {
    await pinButton.first().click();
    await page.waitForTimeout(300);
    report.checks.pinStorage = await page.evaluate(() => {
      const keys = Object.keys(window.localStorage).filter((key) => key.startsWith('dj-pins:'));
      return Object.fromEntries(keys.map((key) => [key, window.localStorage.getItem(key)]));
    });
    const channelOrder = await page.evaluate(() => {
      const firstSection = [...document.querySelectorAll('aside section')].find((section) => section.textContent?.includes('Channels'));
      const rows = [...(firstSection?.querySelectorAll('div.group\\/row') ?? [])];
      return rows.map((row) => ({
        title: row.innerText.split('\n')[0],
        pinned: Boolean(row.querySelector('button[aria-pressed="true"]')),
      }));
    });
    report.checks.channelPins = channelOrder;
    await page.screenshot({ path: path.join(OUT, 'sprint1-pins-1440.png') });
    report.shots['sprint1-pins-1440.png'] = path.join(OUT, 'sprint1-pins-1440.png');
    console.log('SHOT sprint1-pins-1440.png');
    await page.reload();
    await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
    await page.waitForTimeout(1500);
    report.checks.pinAfterReload = await page.evaluate(() => {
      const firstSection = [...document.querySelectorAll('aside section')].find((section) => section.textContent?.includes('Channels'));
      const rows = [...(firstSection?.querySelectorAll('div.group\\/row') ?? [])];
      return {
        first: rows[0]?.innerText?.split('\n')[0] ?? null,
        firstPinned: Boolean(rows[0]?.querySelector('button[aria-pressed="true"]')),
      };
    });
  } else {
    report.checks.pins = 'pin button not found';
  }

  /* ── 设置页：资料 + 状态前缀 + 头像 ── */
  console.log('STEP settings');
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('text=Profile / 个人资料', { timeout: 15000 });
  await page.fill('label:has-text("状态前缀") input', '战术规划中');
  await page.click('button:has-text("保存资料")');
  await page.waitForTimeout(1600);
  report.checks.settingsSaved = await page.evaluate(async () => {
    const token = window.localStorage.getItem('dj.access');
    const response = await fetch('http://localhost:3000/api/v1/me', { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json());
    const user = response?.data?.user ?? response?.user;
    return {
      displayName: user?.displayName ?? null,
      statusPrefix: user?.statusPrefix ?? null,
      avatarFileId: user?.avatarFileId ?? null,
      error: response?.error?.code ?? null,
    };
  });
  await page.reload();
  await page.waitForSelector('text=Profile / 个人资料', { timeout: 15000 });
  await page.waitForTimeout(800);
  report.checks.settingsReload = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    const prefixInput = inputs.find((input) => input.closest('label')?.textContent?.includes('状态前缀'));
    return {
      prefix: prefixInput?.value ?? null,
      hasAvatarInput: Boolean(document.querySelector('input[type="file"]')),
    };
  });

  const avatarFile = path.join(OUT, 'sprint1-avatar-source.png');
  if (fs.existsSync(avatarFile)) {
    await page.setInputFiles('input[type="file"]', avatarFile);
    await page.waitForTimeout(6000);
    report.checks.avatar = await page.evaluate(async () => {
      const token = window.localStorage.getItem('dj.access');
      const response = await fetch('http://localhost:3000/api/v1/me', { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json());
      const user = response?.data?.user ?? response?.user;
      let imageOk = null;
      let host = null;
      if (user?.avatarFileId) {
        const fileResponse = await fetch(`http://localhost:3000/api/v1/files/${user.avatarFileId}/url?variant=preview`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((res) => res.json());
        const signed = fileResponse?.data?.url ?? fileResponse?.url;
        if (signed) {
          host = new URL(signed).origin;
          imageOk = await new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => resolve(false);
            image.src = signed;
          });
        }
      }
      return {
        avatarFileId: user?.avatarFileId ?? null,
        imageOk,
        signedHost: host,
        removeButton: [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('移除头像')),
        visibleAvatarImages: [...document.querySelectorAll('main img')].map((img) => ({ alt: img.getAttribute('alt'), naturalWidth: img.naturalWidth })),
      };
    });
  }
  await shot('sprint1-settings-1440.png');

  /* ── 回主界面：状态前缀 + 头像出现在 Header/消息 ── */
  await page.goto(BASE);
  await page.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await page.waitForTimeout(2200);
  report.checks.prefixInUi = await page.evaluate(() => {
    const header = document.querySelector('header')?.innerText ?? '';
    const sidebar = document.querySelector('aside')?.innerText ?? '';
    return {
      headerHasPrefix: header.includes('[战术规划中]'),
      sidebarHasPrefix: sidebar.includes('[战术规划中]'),
      header: header.replace(/\n/g, ' | ').slice(0, 200),
      avatarImages: [...document.querySelectorAll('header img, aside img')].map((img) => ({ alt: img.getAttribute('alt'), naturalWidth: img.naturalWidth })),
      avatarFallbacks: [...document.querySelectorAll('header span[aria-hidden], aside span[aria-hidden]')].filter((span) => span.textContent?.trim()).slice(0, 6).map((span) => span.textContent?.trim()),
    };
  });
  await shot('sprint1-prefix-1440.png');

  /* ── 群管理：创建临时群 → 公告 Markdown → 踢人确认 → 危险区 → 解散 ── */
  console.log('STEP group management');
  const createGroup = async () => {
    await page.locator('aside button', { hasText: '新建群聊' }).first().click();
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor({ timeout: 5000 });
    await dialog.locator('input#group-name').fill(GROUP_NAME);
    const firstCheckbox = dialog.locator('input[type="checkbox"]').first();
    if (await firstCheckbox.count()) {
      await firstCheckbox.focus();
      await page.keyboard.press('Space');
      await page.waitForTimeout(150);
    }
    await dialog.locator('button', { hasText: '创建群聊' }).click();
    await page.waitForTimeout(1800);
  };
  await createGroup();
  report.checks.groupCreated = await page.evaluate((name) => document.body.innerText.includes(name), GROUP_NAME);
  if (!report.checks.groupCreated) {
    const groupButton = page.locator('aside button', { hasText: GROUP_NAME }).first();
    if (await groupButton.count()) {
      await groupButton.click();
      await page.waitForTimeout(1200);
    }
  }
  await page.locator('button[aria-label="打开详情"]').click();
  const drawer = page.locator('aside[aria-label="会话详情"]');
  await drawer.waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  report.checks.drawer = {
    text: (await drawer.innerText()).replace(/\n/g, ' | ').slice(0, 500),
    hasAnnouncement: (await drawer.innerText()).toLowerCase().includes('announcement / 群公告'),
    hasDanger: (await drawer.innerText()).toLowerCase().includes('danger zone / 危险区'),
  };

  const announcementSection = drawer.locator('section').filter({ hasText: 'Announcement / 群公告' });
  if (await announcementSection.count()) {
    await announcementSection.locator('button', { hasText: '编辑' }).first().click();
    const markdown = `# 夜班公告\n\n- 22:00 集合\n- **频道守则**：先听后发\n\n<script>window.__sprintXss = 1</script>\n\n<img src=x onerror="window.__sprintXss = 2">`;
    await drawer.locator('textarea[aria-label="群公告 Markdown"]').fill(markdown);
    await drawer.locator('button', { hasText: '保存公告' }).click();
    await page.waitForTimeout(1500);
    report.checks.announcement = await page.evaluate(() => {
      const markdown = document.querySelector('.im-markdown');
      return {
        rendered: Boolean(markdown),
        h1: markdown?.querySelector('h1')?.textContent ?? null,
        listItems: markdown?.querySelectorAll('li').length ?? 0,
        rawImg: Boolean(markdown?.querySelector('img')),
        rawScript: Boolean(markdown?.querySelector('script')),
        xss: window.__sprintXss ?? null,
        text: markdown?.textContent?.replace(/\n/g, ' | ').slice(0, 200) ?? null,
      };
    });
    await shot('sprint1-announcement-1440.png');
  } else {
    report.checks.announcement = 'section not found (not moderator?)';
  }

  const removeButton = drawer.locator('button', { hasText: '移除' }).first();
  if (await removeButton.count()) {
    await removeButton.click();
    await page.waitForTimeout(300);
    report.checks.kickConfirm = await page.evaluate(() => document.querySelector('aside[aria-label="会话详情"]')?.innerText.includes('确认把') ?? false);
    await shot('sprint1-kick-confirm-1440.png');
    await drawer.locator('button', { hasText: '取消' }).last().click();
  } else {
    report.checks.kickConfirm = 'remove button not found';
  }

  const dangerInput = drawer.locator('input[aria-label="输入群名以确认解散"]');
  if (await dangerInput.count()) {
    report.checks.danger = { visible: true, disabledBefore: await drawer.locator('button', { hasText: '解散群聊' }).isDisabled() };
    await dangerInput.fill(GROUP_NAME);
    await page.waitForTimeout(200);
    report.checks.danger.disabledAfterExactName = await drawer.locator('button', { hasText: '解散群聊' }).isDisabled();
    await shot('sprint1-danger-1440.png');
    await drawer.locator('button', { hasText: '解散群聊' }).click();
    await page.waitForTimeout(1800);
    report.checks.dissolved = await page.evaluate((name) => {
      const drawer = document.querySelector('aside[aria-label="会话详情"]');
      const rect = drawer?.getBoundingClientRect();
      return {
        drawerClosed: !drawer || !rect || rect.left >= window.innerWidth - 1,
        groupGone: !document.body.innerText.includes(name),
        selectedChannel: document.querySelector('header h1')?.textContent ?? null,
      };
    }, GROUP_NAME);
    await shot('sprint1-dissolved-1440.png');
  } else {
    report.checks.danger = 'danger zone not found';
  }

  /* ── 移动端长按 ActionSheet ── */
  console.log('STEP mobile long-press');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: await context.storageState(),
  });
  const mobile = await mobileContext.newPage();
  mobile.on('console', (message) => message.type() === 'error' && errors.push(`[mobile] ${message.text().slice(0, 300)}`));
  mobile.on('pageerror', (error) => pageErrors.push(`[mobile] ${String(error).slice(0, 300)}`));
  await mobile.goto(BASE);
  await mobile.waitForSelector('textarea[aria-label="输入信号"]', { timeout: 20000 });
  await mobile.waitForTimeout(2200);
  await shot('sprint1-mobile-390.png', mobile);

  const longPress = await mobile.evaluate(async () => {
    const rows = [...document.querySelectorAll('[data-message-id]')];
    const row = rows.at(-2) ?? rows.at(-1);
    if (!row) return { ok: false, reason: 'no message row' };
    const rect = row.getBoundingClientRect();
    const touch = new Touch({ identifier: 1, target: row, clientX: rect.left + 40, clientY: rect.top + 20 });
    row.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 700));
    return { ok: true, text: row.innerText.slice(0, 100) };
  });
  await mobile.waitForTimeout(400);
  report.checks.longPress = {
    ...longPress,
    sheet: await mobile.evaluate(() => {
      const sheet = document.querySelector('[role="dialog"][aria-label^="消息操作"]');
      const rect = sheet?.getBoundingClientRect();
      return sheet
        ? {
            visible: Boolean(rect && rect.height > 0 && rect.top < window.innerHeight),
            labels: [...sheet.querySelectorAll('button')].map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })),
          }
        : null;
    }),
  };
  await shot('sprint1-actionsheet-390.png', mobile);
  const cancel = mobile.locator('[role="dialog"] button', { hasText: '取消' }).first();
  if (await cancel.count()) await cancel.click();
  await mobile.waitForTimeout(300);

  report.checks.mobile = await mobile.evaluate(() => ({
    innerWidth: window.innerWidth,
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    headerButtons: [...(document.querySelector('header')?.querySelectorAll('button') ?? [])].filter((button) => button.offsetParent).length,
  }));

  fs.writeFileSync(path.join(OUT, 'sprint1-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  await mobileContext.close();
  await context.close();
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error('SPRINT1_FAILED', error);
  await page.screenshot({ path: path.join(OUT, 'sprint1-failure.png') }).catch(() => {});
  fs.writeFileSync(path.join(OUT, 'sprint1-report.json'), JSON.stringify({ ...report, failure: String(error) }, null, 2), 'utf8');
  await browser.close().catch(() => {});
  process.exit(1);
}
