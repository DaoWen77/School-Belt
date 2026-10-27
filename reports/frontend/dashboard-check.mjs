/** 仪表盘 DOM 断言（配合 dashboard-shot.mjs 的假 API）：确认三面板 + 巨型接入按钮都有内容。 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), 'ops', 'e2e', 'node_modules', 'playwright-core'));

const BASE = process.env.SHOT_BASE || 'http://localhost:3200';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wrap = (data) => ({ ok: true, data, requestId: 'shot' });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  localStorage.setItem('dj.access', 'a');
  localStorage.setItem('dj.refresh', 'r');
});
const page = await context.newPage();
await page.route('**/api/v1/**', async (route) => {
  const p = new URL(route.request().url()).pathname.replace('/api/v1', '');
  const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap(data)) });
  if (p === '/me') return json({ user: { id: 'u1', handle: 'chisaki', displayName: '终澪', prefixes: ['[极光科技]'] } });
  if (p === '/device') return json({ devices: [{ id: 'd1', name: 'ESP32-S3 · 环带信标', platform: 'esp32s3', lastActiveAt: new Date().toISOString() }] });
  if (p === '/stats/activity') return json({ metrics: { messages: 1284, active: 17, tasks: 32, votes: 9, materials: 214 } });
  if (p === '/archive') return json({ items: [{ id: 'a1', kind: 'task', title: '环带外环测绘任务', createdAt: '2026-10-21T09:12:00.000Z' }] });
  return json({});
});
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const checks = {
  title: (await page.locator('h1').first().textContent())?.trim(),
  panels: await page.locator('main section').count(),
  archiveCards: await page.locator('.archive-card').count(),
  radarImage: await page.locator('main svg').count(),
  devices: await page.getByText('ESP32-S3').count(),
  beltButtons: await page.getByRole('button', { name: /文明环带|接入/ }).count(),
  chatEntries: await page.locator('text=朋友圈').count(),
  announcement: await page.locator('text=全服公告').count(),
};
console.log(JSON.stringify(checks, null, 2));
await browser.close();
