#!/usr/bin/env node
/**
 * 公网浏览器端到端：真实 ofalias 域名打开前端 → UI 登录 → 上传 pptx → 文件卡片 → 点击下载
 * 不使用 localhost。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 'public');
const WEB = process.env.PUBLIC_WEB ?? 'http://cn-hk-bgp-4.ofalias.net:51065';
fs.mkdirSync(OUT, { recursive: true });

const steps = [];
const ok = (id, pass, detail = {}) => {
  steps.push({ id, ok: pass, ...detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail).slice(0, 220)}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => steps.push({ id: 'pageerror', ok: false, error: error.message }));

  /* 公网登录：先用公网 API 取会话，再注入 localStorage（页面仍从公网域名发起跨域请求） */
  const loginResponse = await fetch('http://cn-hk-bgp-4.ofalias.net:20097/api/v1/belt/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB },
    body: JSON.stringify({ handle: 'qiu', password: 'Dijiang#2026' }),
  });
  const loginPayload = await loginResponse.json();
  const session = loginPayload?.data;
  ok('B1 公网 API 登录', loginResponse.status === 200 && Boolean(session?.accessToken), {
    status: loginResponse.status,
    acao: loginResponse.headers.get('access-control-allow-origin'),
  });
  if (!session?.accessToken) throw new Error('公网登录失败');
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: session.accessToken, r: session.refreshToken });
  await page.goto(`${WEB}/belt/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1200);

  await page.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('环带频道').first().waitFor({ timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const channelText = await page.locator('body').innerText();
  ok('B2 公网页面加载频道', /环带频道/.test(channelText), { snippet: channelText.slice(0, 80) });
  await page.screenshot({ path: path.join(OUT, 'public-channel.png') });

  /* 上传一个小 pptx（走 + 附件） */
  const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(1200, 0x45)]);
  const file = path.join(OUT, '公网端到端.pptx');
  fs.writeFileSync(file, bytes);
  await page.locator('input[type=file]').first().setInputFiles(file);
  await page.waitForTimeout(6000);
  await page.waitForFunction(() => !document.body.innerText.includes('UPLOADING'), { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(800);
  ok('B3 公网页面附件上传', /公网端到端\.pptx/.test(await page.locator('body').innerText()), {});

  /* 发送 */
  await page.getByPlaceholder('输入信号…  /ping /task /poll /report /chart').fill('公网 E2E 自检');
  await page.locator('.belt-channel-composer button[type=submit], .belt-channel-composer .belt-send').first().click();
  await page.waitForTimeout(3000);
  const card = page.locator('.belt-file-card', { hasText: '公网端到端.pptx' }).last();
  ok('B4 公网消息出现文件卡片', (await card.count()) > 0, { count: await page.locator('.belt-file-card').count() });
  await page.screenshot({ path: path.join(OUT, 'public-file-card.png') });

  /* 头像/图片走签名代理后，公网应能真正渲染（naturalWidth>0） */
  const images = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .map((img) => ({ src: img.currentSrc.slice(0, 80), w: img.naturalWidth }))
      .filter((item) => item.src),
  );
  ok('B7 公网图片/头像加载', images.some((item) => item.w > 0), { images: images.slice(0, 4) });

  /* 下载 */
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }).catch(() => null),
    card.click(),
  ]);
  const name = download?.suggestedFilename() ?? null;
  let sameBytes = false;
  if (download) {
    const saved = path.join(OUT, 'downloaded-公网端到端.pptx');
    await download.saveAs(saved);
    sameBytes = fs.readFileSync(saved).equals(bytes);
  }
  ok('B5 公网点击卡片下载', Boolean(download), { suggestedFilename: name });
  ok('B6 下载字节一致', sameBytes, {});
  await page.screenshot({ path: path.join(OUT, 'public-after-download.png') });
  await ctx.close();
} catch (error) {
  steps.push({ id: 'fatal', ok: false, error: String(error?.message ?? error) });
  console.error(error);
} finally {
  fs.writeFileSync(path.join(OUT, 'public-browser.json'), `${JSON.stringify({ web: WEB, steps }, null, 2)}\n`, 'utf8');
  const failed = steps.filter((item) => !item.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
  await browser.close();
}
