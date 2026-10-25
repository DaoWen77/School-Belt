#!/usr/bin/env node
/** Sprint 7.1：外网个人中心 + 组织中心验证。 */
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
const stamp = Date.now().toString(36).slice(-5);
const ownerHandle = `s71_owner_${stamp}`;
const memberHandle = `s71_member_${stamp}`;
const password = 'Sprint71#2026';
const orgName = `星环社${stamp}`;
const images = [];
let orgId = null;

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

function pngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    'base64',
  );
}

async function main() {
  const ownerReg = await call('/belt/auth/register', {
    method: 'POST',
    body: { handle: ownerHandle, displayName: `星环社长${stamp}`, password },
  });
  const memberReg = await call('/belt/auth/register', {
    method: 'POST',
    body: { handle: memberHandle, displayName: `星环成员${stamp}`, password },
  });
  const owner = { token: ownerReg.accessToken, refresh: ownerReg.refreshToken };
  const member = { token: memberReg.accessToken, refresh: memberReg.refreshToken };

  const applied = await call('/belt/organizations', {
    method: 'POST',
    token: owner.token,
    body: { name: orgName, summary: '面向环带学生的跨校兴趣组织。' },
  });
  orgId = applied.organization.id;
  console.log('APPLIED', orgId, applied.organization.status);

  const founderLogin = await call('/auth/login', {
    method: 'POST',
    body: { handle: 'founder', password: 'Dijiang#2026' },
  });
  const review = await call(`/organizations/${orgId}/review`, {
    method: 'PATCH',
    token: founderLogin.accessToken,
    body: { action: 'approve' },
  });
  console.log('APPROVED', review.organization.status, review.organization.surface);

  const joined = await call(`/belt/organizations/${orgId}/join`, {
    method: 'POST',
    token: member.token,
    body: { note: '我想加入星环社参与校园电文编辑。' },
  });
  console.log('JOIN_REQUESTED', joined.organization.myStatus);

  const ownerMine = await call('/belt/organizations/mine', { token: owner.token });
  console.log(
    'OWNER_MINE',
    JSON.stringify({
      organizations: ownerMine.organizations.map((org) => ({
        name: org.name,
        role: org.myRole,
        channels: org.channels?.length,
        pending: org.pendingRequests?.length,
      })),
    }),
  );
  if (ownerMine.organizations[0]?.pendingRequests?.length !== 1) throw new Error('missing pending member');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.addInitScript(({ access, refresh }) => {
      localStorage.setItem('dj.belt.access', access);
      localStorage.setItem('dj.belt.refresh', refresh);
    }, { access: owner.token, refresh: owner.refresh });

    // 个人中心：真实 S3 头像上传 + 昵称保存
    await ownerPage.goto(`${WEB}/belt/profile`, { waitUntil: 'networkidle' });
    await ownerPage.waitForTimeout(600);
    await ownerPage.locator('input[type=file]').setInputFiles(
      path.join(ROOT, 'reports', 'frontend', 'test-avatar-7-1.png'),
    );
    await ownerPage.waitForTimeout(1200);
    console.log('AVATAR_NOTICE', (await ownerPage.locator('body').innerText()).includes('头像已上传'));
    await ownerPage.getByRole('button', { name: '保存资料', exact: true }).click();
    await ownerPage.waitForLoadState('networkidle');
    await ownerPage.waitForTimeout(800);
    console.log('AVATAR_IMG', await ownerPage.locator('.belt-profile-avatar img').count());
    const profileShot = path.join(ROOT, 'reports', 'frontend', 'sprint71-belt-profile-390.png');
    await ownerPage.screenshot({ path: profileShot, fullPage: false });
    images.push(profileShot);

    // 组织中心：Owner 审批 + 创建私有频道
    await ownerPage.goto(`${WEB}/belt/organizations`, { waitUntil: 'networkidle' });
    await ownerPage.waitForTimeout(700);
    const textBefore = await ownerPage.locator('body').innerText();
    console.log('OWNER_PANEL', textBefore.includes('JOIN REQUESTS'), textBefore.includes('NEW PRIVATE CHANNEL'));
    console.log('PENDING_VISIBLE', textBefore.includes(memberReg.user.displayName));
    const orgShot = path.join(ROOT, 'reports', 'frontend', 'sprint71-belt-organizations-390.png');
    await ownerPage.screenshot({ path: orgShot, fullPage: false });
    images.push(orgShot);

    await ownerPage.getByRole('button', { name: '通过', exact: true }).first().click();
    await ownerPage.waitForTimeout(800);
    await ownerPage.getByLabel('私有频道名').fill(`星环编辑室${stamp}`);
    await ownerPage.getByLabel('私有频道主题').fill('校园电文与选题');
    await ownerPage.getByRole('button', { name: '创建', exact: true }).click();
    await ownerPage.waitForTimeout(900);
    const textAfter = await ownerPage.locator('body').innerText();
    console.log('CHANNEL_CREATED', textAfter.includes(`星环编辑室${stamp}`));
    console.log('REQUEST_CLEARED', !textAfter.includes(memberReg.user.displayName));
    const afterShot = path.join(ROOT, 'reports', 'frontend', 'sprint71-belt-organizations-after-390.png');
    await ownerPage.screenshot({ path: afterShot, fullPage: false });
    images.push(afterShot);
    await ownerContext.close();

    const mineAfter = await call('/belt/organizations/mine', { token: owner.token });
    const channels = mineAfter.organizations[0]?.channels ?? [];
    console.log('ORG_CHANNELS', JSON.stringify(channels.map((channel) => channel.name)));
    const memberChannels = await call('/belt/channels', { token: member.token });
    console.log(
      'MEMBER_CHANNEL_VISIBLE',
      memberChannels.channels.some((channel) => channel.name.includes('星环编辑室')),
    );
  } finally {
    await browser.close();
  }

  console.log(
    'SPRINT71_RESULT=' +
      JSON.stringify({
        ok: true,
        orgId,
        ownerHandle,
        memberHandle,
        images: images.map((file) => path.relative(ROOT, file).replaceAll('\\', '/')),
      }),
  );
}

main()
  .catch((error) => {
    console.error(`SPRINT71_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => null);
    await prisma.user.deleteMany({ where: { handle: { in: [ownerHandle, memberHandle] } } }).catch(() => null);
    await prisma.$disconnect();
  });
