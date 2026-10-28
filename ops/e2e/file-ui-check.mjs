#!/usr/bin/env node
/** 前端「+」附件任意文件上传 + 文件卡片下载 的真实点击校验 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'reports', 'e2e', 'p0-ui');
const WEB = 'http://localhost:3100';
const API = 'http://127.0.0.1:3000/api/v1';
fs.mkdirSync(OUT, { recursive: true });
const steps = [];
const ok = (id, pass, detail) => {
  steps.push({ id, ok: pass, ...detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}`, JSON.stringify(detail).slice(0, 220));
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const login = await fetch(`${API}/belt/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: 'qiu', password: 'Dijiang#2026' }),
  });
  const token = (await login.json())?.data;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((t) => {
    localStorage.setItem('dj.belt.access', t.a);
    localStorage.setItem('dj.belt.refresh', t.r);
  }, { a: token.accessToken, r: token.refreshToken });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/belt/channel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const input = page.locator('input[type=file]');
  const accept = await input.first().getAttribute('accept');
  ok('U1 附件 input 不设类型限制', (accept ?? '') === '', { accept });
  await page.screenshot({ path: path.join(OUT, 'file-01-channel.png') });

  /* 造一个 pptx 并上传 */
  const pptx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(900, 0x42)]);
  const tmp = path.join(OUT, '演示材料.pptx');
  fs.writeFileSync(tmp, pptx);
  await input.first().setInputFiles(tmp);
  await page.waitForTimeout(2500);
  /* 等真实上传完成（pending 会显示 UPLOADING），否则发出去的是占位 tempId */
  await page.waitForFunction(() => !document.body.innerText.includes('UPLOADING'), { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const attached = await page.locator('body').innerText();
  ok('U2 附件进入待发送区', /演示材料\.pptx/.test(attached), { hasName: attached.includes('演示材料.pptx') });

  await page.getByPlaceholder('输入信号…  /ping /task /poll /report /chart').fill('任意文件上传自检');
  await page.locator('.belt-channel-composer button[type=submit], .belt-channel-composer .belt-send').first().click();
  await page.waitForTimeout(2500);
  const afterSend = page.locator('body');
  ok('U3 消息流出现文件卡片', (await page.locator('.belt-file-card').count()) > 0, {
    count: await page.locator('.belt-file-card').count(),
    text: (await afterSend.innerText()).match(/演示材料\.pptx[^\n]*/)?.[0] ?? null,
  });
  await page.screenshot({ path: path.join(OUT, 'file-02-file-card.png') });

  /* 点击卡片下载 */
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }).catch(() => null),
    page.locator('.belt-file-card', { hasText: '演示材料.pptx' }).last().click(),
  ]);
  const downloadName = download?.suggestedFilename() ?? null;
  ok('U4 点击卡片触发下载', Boolean(download), { suggestedFilename: downloadName });
  if (download) {
    const saved = path.join(OUT, 'downloaded-任意文件.pptx');
    await download.saveAs(saved);
    ok('U5 下载文件字节一致', fs.readFileSync(saved).equals(pptx), { bytes: fs.readFileSync(saved).length });
  }
  await page.screenshot({ path: path.join(OUT, 'file-03-after-download.png') });
  await ctx.close();
} catch (error) {
  steps.push({ id: 'fatal', ok: false, error: String(error?.message ?? error) });
  console.error(error);
} finally {
  fs.writeFileSync(path.join(OUT, '..', 'file-ui.json'), `${JSON.stringify(steps, null, 2)}\n`, 'utf8');
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} 通过`);
  process.exitCode = failed.length ? 1 : 0;
  await browser.close();
}
