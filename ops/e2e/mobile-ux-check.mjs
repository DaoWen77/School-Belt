#!/usr/bin/env node
/**
 * 390px 移动端回归：档案室封面/详情、指令入口、好友切断、过场、电文 Bento、帖子删除。
 * 前后端不做结构变更；测试数据在 finally 清理。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const requireServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = requireServer('@prisma/client');
const prisma = new PrismaClient();

const API = 'http://127.0.0.1:3000/api/v1';
const WEB = 'http://127.0.0.1:3100';
const images = [];
const createdPostIds = [];
let friendRestore = null;
let covers = 0;
let noPreview = 0;
let commandPanel = 0;
let bento = 0;
let feature = 0;

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'user-agent': 'mobile-ux-check/1.0',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function login(handle) {
  const data = await call('/auth/login', { method: 'POST', body: { handle, password: 'Dijiang#2026' } });
  return { token: data.accessToken, refresh: data.refreshToken };
}

async function beltFromInternal(token) {
  const handoff = await call('/access/belt/handoff', { method: 'POST', token, body: { next: '/belt/dispatch' } });
  const data = await call('/belt/auth/handoff/exchange', { method: 'POST', body: { code: handoff.code } });
  return { token: data.accessToken, refresh: data.refreshToken };
}

async function pageWith(browser, tokens) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(
    ({ access, refresh, beltAccess, beltRefresh }) => {
      if (access) localStorage.setItem('dj.access', access);
      if (refresh) localStorage.setItem('dj.refresh', refresh);
      if (beltAccess) localStorage.setItem('dj.belt.access', beltAccess);
      if (beltRefresh) localStorage.setItem('dj.belt.refresh', beltRefresh);
    },
    {
      access: tokens.internal?.token ?? null,
      refresh: tokens.internal?.refresh ?? null,
      beltAccess: tokens.belt?.token ?? null,
      beltRefresh: tokens.belt?.refresh ?? null,
    },
  );
  return { context, page };
}

async function shot(page, name) {
  const file = path.join(ROOT, 'reports', 'frontend', name);
  await page.screenshot({ path: file, fullPage: false });
  images.push(file);
  console.log('SHOT', path.relative(ROOT, file).replaceAll('\\', '/'));
}

async function seedPosts() {
  const founder = await prisma.user.findUniqueOrThrow({ where: { handle: 'founder' } });
  const now = Date.now();
  const rows = [
    { board: 'bulletin', source: 'official', sourceName: null, title: '第七码头静默窗口解除', body: '中继 07 已恢复全功率。昨夜的低功率窗口属于计划内审计，未发现断带。所有经停船只按新航标通行。', minutes: 8 },
    { board: 'bulletin', source: 'official', sourceName: null, title: '环带通行证审计周开始', body: '所有外环通行证持有者请在任一公共中继完成一次身份回写。未回写者仍可读取，但无法签发新的委托。', minutes: 22 },
    { board: 'telegraph', source: 'rss', sourceName: '36Kr', title: '外环物流网络进入低功耗调度', body: '多家运输节点开始采用夜间低功耗调度，以应对持续的能量配额收紧。', minutes: 35 },
    { board: 'telegraph', source: 'rss', sourceName: 'The Verge', title: '新型中继天线完成首次跨带测试', body: '测试信号在断带边缘保持了十七分钟，超过了此前记录。', minutes: 47 },
    { board: 'telegraph', source: 'rss', sourceName: 'Protocol Daily', title: '协议官发布未登记信标回收指引', body: '指引要求所有单位不得自行拆解未登记信标，需回传坐标由协议官统一登记。', minutes: 58 },
  ];
  for (const row of rows) {
    const post = await prisma.post.create({
      data: {
        surface: 'belt',
        board: row.board,
        authorId: founder.id,
        title: row.title,
        body: row.body,
        source: row.source,
        sourceName: row.sourceName,
        publishedAt: new Date(now - row.minutes * 60_000),
        status: 'published',
      },
      select: { id: true },
    });
    createdPostIds.push(post.id);
  }
}

async function cleanup() {
  if (createdPostIds.length) {
    await prisma.post.deleteMany({ where: { id: { in: createdPostIds } } }).catch(() => null);
  }
  if (friendRestore) {
    await prisma.friendship
      .update({ where: { id: friendRestore.id }, data: { status: 'accepted', respondedAt: new Date() } })
      .catch(() => null);
  }
  await prisma.$disconnect();
}

async function main() {
  const founder = await login('founder');
  const chen = await login('chen');
  const founderBelt = await beltFromInternal(founder.token);
  await seedPosts();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // 1) 档案室：纯 CSS 封面 + 详情抽屉
    const internal = await pageWith(browser, { internal: founder });
    await internal.page.goto(WEB, { waitUntil: 'networkidle' });
    await internal.page.waitForTimeout(500);
    await internal.page.getByRole('button', { name: '打开频道列表' }).click();
    await internal.page.waitForTimeout(250);
    await internal.page.locator('button:visible', { hasText: '档案室' }).first().click();
    await internal.page.waitForTimeout(500);
    covers = await internal.page.locator('.archive-cover').count();
    noPreview = await internal.page.getByText('NO PREVIEW').count();
    console.log('ARCHIVE_CSS_COVERS', covers);
    console.log('ARCHIVE_NO_PREVIEW', noPreview);
    await shot(internal.page, 'phase-mobile-390-archive-grid.png');

    await internal.page.locator('.archive-card').first().click();
    await internal.page.waitForTimeout(350);
    const archiveDrawer = await internal.page.locator('.archive-drawer').count();
    const editButton = await internal.page.getByRole('button', { name: '编辑', exact: true }).count();
    const deleteButton = await internal.page.getByRole('button', { name: '删除', exact: true }).count();
    console.log('ARCHIVE_DRAWER', archiveDrawer, 'EDIT', editButton, 'DELETE', deleteButton);
    await shot(internal.page, 'phase-mobile-390-archive-drawer.png');
    await internal.page.keyboard.press('Escape');
    await internal.page.waitForTimeout(250);

    // 2) 移动端指令入口 / 全屏面板
    const commandButton = internal.page.getByRole('button', { name: '打开指令面板' });
    console.log('COMMAND_BUTTON', await commandButton.count());
    await commandButton.click();
    await internal.page.waitForTimeout(300);
    commandPanel = await internal.page.getByRole('dialog', { name: '命令面板' }).count();
    console.log('COMMAND_PANEL', commandPanel);
    await shot(internal.page, 'phase-mobile-390-command-palette.png');
    await internal.page.keyboard.press('Escape');
    await internal.page.waitForTimeout(200);

    // 3) 接入环带过场：390 视口内完整可见
    await internal.page.getByRole('button', { name: '打开频道列表' }).click();
    await internal.page.waitForTimeout(200);
    await internal.page.getByRole('button', { name: /接入文明环带/ }).click();
    await internal.page.waitForTimeout(1300);
    const entryFrame = await internal.page.locator('.belt-entry-frame').boundingBox();
    const entryViewport = internal.page.viewportSize();
    console.log(
      'ENTRY_FRAME',
      JSON.stringify(entryFrame),
      'VIEWPORT',
      JSON.stringify(entryViewport),
      'WITHIN',
      Boolean(
        entryFrame &&
          entryViewport &&
          entryFrame.y >= 0 &&
          entryFrame.y + entryFrame.height <= entryViewport.height + 1 &&
          entryFrame.x >= 0 &&
          entryFrame.width <= entryViewport.width,
      ),
    );
    await shot(internal.page, 'phase-mobile-390-belt-entry.png');
    await internal.context.close();

    // 4) 合并电文 / Bento 错位拼贴
    const belt = await pageWith(browser, { belt: founderBelt });
    await belt.page.goto(`${WEB}/belt/dispatch`, { waitUntil: 'networkidle' });
    await belt.page.waitForTimeout(700);
    bento = await belt.page.locator('.belt-bento-card').count();
    feature = await belt.page.locator('.belt-bento-card.is-feature').count();
    const official = await belt.page.getByText('OFFICIAL', { exact: true }).count();
    const intercept = await belt.page.getByText(/INTERCEPT \//).count();
    console.log('BENTO', bento, 'FEATURE', feature, 'OFFICIAL_LABEL', official, 'INTERCEPT_LABEL', intercept);
    await shot(belt.page, 'phase-mobile-390-belt-bento.png');

    // 帖子删除：本人/Owner 在卡片上执行删除
    await belt.page.on('dialog', (dialog) => void dialog.accept());
    const before = await belt.page.locator('.belt-bento-card').count();
    await belt.page.locator('.belt-bento-card .belt-delete').first().click();
    await belt.page.waitForTimeout(800);
    const after = await belt.page.locator('.belt-bento-card').count();
    console.log('POST_DELETE', before, '->', after);
    await belt.context.close();

    // 5) 私聊详情：切断好友链路（删除后立即恢复测试关系）
    const friend = await pageWith(browser, { internal: chen });
    const chenUser = await prisma.user.findUniqueOrThrow({ where: { handle: 'chen' }, select: { id: true } });
    const linUser = await prisma.user.findUniqueOrThrow({ where: { handle: 'lin' }, select: { id: true } });
    const link = await prisma.friendship.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: chenUser.id, addresseeId: linUser.id },
          { requesterId: linUser.id, addresseeId: chenUser.id },
        ],
      },
      include: { requester: { select: { handle: true } }, addressee: { select: { handle: true } } },
    });
    if (!link || link.surface !== 'internal') throw new Error('chen accepted internal friendship not found');
    friendRestore = { id: link.id };
    await friend.page.goto(WEB, { waitUntil: 'networkidle' });
    await friend.page.waitForTimeout(500);
    await friend.page.getByRole('button', { name: '打开频道列表' }).click();
    await friend.page.waitForTimeout(200);
    const dmTitle = link.requester.handle === 'chen' ? link.addressee.handle : link.requester.handle;
    const peerName = dmTitle === 'lin' ? '林测绘' : dmTitle;
    await friend.page.locator('button:visible', { hasText: peerName }).first().click();
    await friend.page.waitForTimeout(450);
    await friend.page.getByRole('button', { name: '打开详情' }).click();
    await friend.page.waitForTimeout(300);
    const cutButton = friend.page.getByRole('button', { name: /切断链路/ });
    console.log('FRIEND_CUT_BUTTON', await cutButton.count());
    await shot(friend.page, 'phase-mobile-390-friend-cut-link.png');
    await friend.page.on('dialog', (dialog) => void dialog.accept());
    await cutButton.click();
    await friend.page.waitForTimeout(900);
    const removed = await prisma.friendship.findUnique({ where: { id: link.id }, select: { status: true } });
    console.log('FRIEND_STATUS_AFTER', removed?.status);
    await friend.context.close();
  } finally {
    await browser.close();
  }

  console.log(
    'MOBILE_UX_RESULT=' +
      JSON.stringify({
        ok: true,
        covers,
        noPreview,
        commandPanel,
        bento,
        feature,
        images: images.map((file) => path.relative(ROOT, file).replaceAll('\\', '/')),
      }),
  );
}

main()
  .catch((error) => {
    console.error(`MOBILE_UX_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
