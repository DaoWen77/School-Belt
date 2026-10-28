#!/usr/bin/env node
/**
 * 按访问 host 的链路校验：
 *   - 内网页面 → API/图片都走内网（不得出现 ofalias）
 *   - 公网页面 → API/图片都走公网（不得出现 192.168./localhost）
 * 并记录页面首屏耗时。
 */
import { chromium } from 'playwright-core';

const targets = [
  { name: 'LAN', web: 'http://192.168.1.9:3100', expect: /^(192\.168\.|localhost|127\.0\.0\.1)/, forbid: /ofalias\.net/ },
  { name: 'PUBLIC', web: 'http://cn-hk-bgp-4.ofalias.net:51065', expect: /ofalias\.net/, forbid: /^(localhost|127\.0\.0\.1)/ },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const target of targets) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const apiHosts = new Set();
    const mediaHosts = new Set();
    page.on('request', (request) => {
      const url = request.url();
      if (!/\/api\/v1\//.test(url)) return;
      let host = '';
      try {
        host = new URL(url).host;
      } catch {
        return;
      }
      (url.includes('/files/view') || url.includes('/files/download') ? mediaHosts : apiHosts).add(host);
    });

    const login = await fetch('http://192.168.1.9:3000/api/v1/belt/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'qiu', password: 'Dijiang#2026' }),
    }).then((r) => r.json());
    await ctx.addInitScript((t) => {
      localStorage.setItem('dj.belt.access', t.a);
      localStorage.setItem('dj.belt.refresh', t.r);
    }, { a: login.data.accessToken, r: login.data.refreshToken });

    const started = Date.now();
    await page.goto(`${target.web}/belt/channel`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText('环塔频道').first().waitFor({ timeout: 40_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const elapsed = Date.now() - started;

    const images = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .map((img) => ({ host: (() => { try { return new URL(img.currentSrc).host } catch { return '' } })(), w: img.naturalWidth }))
        .filter((item) => item.host),
    );

    const apiList = [...apiHosts];
    const mediaList = [...mediaHosts];
    const apiOk = apiList.length > 0 && apiList.every((host) => target.expect.test(host) && !target.forbid.test(host));
    const mediaOk = mediaList.length === 0 || mediaList.every((host) => target.expect.test(host) && !target.forbid.test(host));
    const imgOk = images.every((item) => target.expect.test(item.host));
    report.push({ target: target.name, elapsedMs: elapsed, apiHosts: apiList, mediaHosts: mediaList, images: images.slice(0, 3), apiOk, mediaOk, imgOk });
    console.log(target.name, JSON.stringify({ elapsedMs: elapsed, apiHosts: apiList, mediaHosts: mediaList, images: images.slice(0, 2), apiOk, mediaOk, imgOk }));
    await ctx.close();
  }
} catch (error) {
  console.error('FATAL', error);
} finally {
  const fs = await import('node:fs');
  fs.writeFileSync('../../reports/e2e/host-routing.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const failed = report.filter((item) => !(item.apiOk && item.mediaOk && item.imgOk));
  console.log(`\n${report.length - failed.length}/${report.length} 通过${failed.length ? `，问题：${failed.map((f) => f.target).join(',')}` : ''}`);
  await browser.close();
}
