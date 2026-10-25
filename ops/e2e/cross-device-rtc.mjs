import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const ADB = 'C:\\Program Files (x86)\\WOMic\\adb.exe';
const channelUrl = 'http://localhost:3100/belt/channel?channelId=65e8429a-8b04-46a7-ae09-affed9465f2c';
const out = 'E:\\项目\\O.M.V帝江号全域广播\\reports\\frontend';

function adb(args) {
  return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

async function login(page, handle) {
  await page.goto('http://localhost:3100/belt/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  if (page.url().includes('/belt/login')) {
    const inputs = page.locator('input:not([type="file"])');
    await inputs.nth(0).fill(handle);
    await inputs.nth(1).fill('Dijiang#2026');
    await page.getByRole('button', { name: '建立环带链路' }).click();
    await page.waitForURL(/\/belt\/channel/, { timeout: 15000 });
  }
  await page.waitForTimeout(800);
}

const desktopBrowser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const desktopContext = await desktopBrowser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
const desktop = await desktopContext.newPage();
adb(['reverse', 'tcp:3100', 'tcp:3100']);
adb(['reverse', 'tcp:3000', 'tcp:3000']);
adb(['forward', 'tcp:9222', 'localabstract:chrome_devtools_remote']);
const errors = [];
desktop.on('pageerror', (e) => errors.push('desktop: ' + String(e)));
await login(desktop, 'founder');

// 手机端先进入频道，确保能收到 WebSocket 来电卡片
const phoneBrowser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const phoneContext = phoneBrowser.contexts()[0];
try {
  await phoneContext.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:3100' });
} catch (error) {
  console.log('PHONE_PERMISSION_GRANT_FAILED', String(error));
}
const phone = phoneContext.pages().find((p) => p.url().includes('localhost:3100')) ?? phoneContext.pages()[0];
phone.on('pageerror', (e) => errors.push('phone: ' + String(e)));
await login(phone, 'chen');
await phone.goto(channelUrl, { waitUntil: 'domcontentloaded' });
await phone.waitForTimeout(1200);

// 桌面端发起视频通话，只勾选 chen
await desktop.goto(channelUrl, { waitUntil: 'networkidle' });
await desktop.waitForTimeout(800);
await desktop.getByRole('button', { name: '发起视频通讯' }).click();
await desktop.locator('.rtc-invite-row').first().waitFor({ timeout: 10000 });
const chenRow = desktop.locator('.rtc-invite-row').filter({ hasText: '@chen' }).first();
await chenRow.locator('input').check();
await desktop.getByRole('button', { name: '发起通讯' }).click();
await desktop.waitForURL(/\/belt\/rtc/, { timeout: 10000 });
await desktop.waitForTimeout(1800);

// 手机端点击来电
await phone.locator('.belt-incoming-call').waitFor({ timeout: 15000 });
await phone.locator('.belt-incoming-call').click();
await phone.waitForURL(/\/belt\/rtc/, { timeout: 10000 });
await phone.waitForTimeout(8000);

async function inspect(page, label) {
  return page.evaluate((label) => {
    const videos = [...document.querySelectorAll('video')].map((v) => ({
      cls: v.className,
      w: v.videoWidth,
      h: v.videoHeight,
      paused: v.paused,
      tracks: v.srcObject ? v.srcObject.getTracks().map((t) => `${t.kind}:${t.readyState}`) : [],
    }));
    const audio = document.querySelector('audio');
    return {
      label,
      url: location.href,
      secure: window.isSecureContext,
      link: document.querySelector('.rtc2-ice')?.textContent,
      status: document.querySelector('.rtc2-header-meta')?.textContent,
      name: document.querySelector('.rtc2-speaker-name')?.textContent,
      avatars: [...document.querySelectorAll('.rtc2-avatar')].map((el) => el.innerText.replace(/\n/g, ' | ')),
      videos,
      audioTracks: audio?.srcObject ? audio.srcObject.getTracks().map((t) => `${t.kind}:${t.readyState}`) : [],
      audioPaused: audio?.paused,
    };
  }, label);
}

const desktopState = await inspect(desktop, 'desktop');
const phoneState = await inspect(phone, 'phone');
console.log('DESKTOP', JSON.stringify(desktopState));
console.log('PHONE', JSON.stringify(phoneState));
console.log('ERRORS', JSON.stringify(errors));

await desktop.screenshot({ path: `${out}\\cross-device-desktop.png` });
await phone.screenshot({ path: `${out}\\cross-device-phone-cdp.png` });
try {
  const png = adb(['exec-out', 'screencap', '-p']);
  const fs = await import('node:fs');
  fs.writeFileSync(`${out}\\cross-device-phone-adb.png`, Buffer.from(png, 'binary'));
} catch (error) {
  console.log('ADB_SCREENSHOT_FAILED', String(error));
}
const logcat = adb(['logcat', '-d']);
const matches = logcat.split(/\r?\n/).filter((line) => /webrtc|peerconnection|getUserMedia|PermissionDenied|SDP/i.test(line));
(await import('node:fs')).writeFileSync(`${out}\\cross-device-logcat.txt`, matches.join('\n'));
console.log('LOGCAT_MATCHES', matches.length);
await desktopBrowser.close();
await phoneBrowser.close();
