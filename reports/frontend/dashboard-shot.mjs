/**
 * 全新帝江号仪表盘截图（无 DB 环境）：
 * 只起 web（next start 已构建产物），用 Playwright 拦截 /api/v1 返回固定档案数据，
 * 让档案库 / 雷达 / IoT 三面板都有内容可看。仅用于视觉验收，不碰任何真实后端。
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), 'ops', 'e2e', 'node_modules', 'playwright-core'));

const OUT = path.join(process.cwd(), 'reports', 'frontend');
const BASE = process.env.SHOT_BASE || 'http://localhost:3200';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const wrap = (data) => ({ ok: true, data, requestId: 'shot' });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await context.addInitScript(() => {
  window.localStorage.setItem('dj.access', 'shot-access');
  window.localStorage.setItem('dj.refresh', 'shot-refresh');
});
const page = await context.newPage();
const failed = [];
page.on('response', (response) => {
  if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
});

await page.route('**/api/v1/**', async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname.replace('/api/v1', '');
  const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wrap(data)) });
  if (p === '/me')
    return json({
      user: { id: 'u-owner', handle: 'chisaki', displayName: '终澪', globalRole: 'owner', prefixes: ['[极光科技]', '[指挥中枢]'] },
    });
  if (p === '/device')
    return json({
      devices: [
        { id: 'd1', name: 'ESP32-S3 · 环带信标', platform: 'esp32s3', lastActiveAt: new Date(Date.now() - 120000).toISOString() },
        { id: 'd2', name: 'ESP32-C3 · 舱门节点', platform: 'esp32c3', lastActiveAt: new Date(Date.now() - 900000).toISOString() },
        { id: 'd3', name: 'ESP32 · 温湿度阵列', platform: 'esp32', lastActiveAt: null },
      ],
    });
  if (p === '/stats/activity')
    return json({ metrics: { messages: 1284, active: 17, tasks: 32, votes: 9, materials: 214 } });
  if (p === '/archive')
    return json({
      items: [
        { id: 'a1', kind: 'task', title: '环带外环测绘任务 · 第二轮', body: '交付测绘浮标坐标与地形切片。', createdAt: '2026-10-21T09:12:00.000Z' },
        { id: 'a2', kind: 'material', title: 'O.M.V 舰体结构图 v3', body: '主结构剖面，含推进段。', createdAt: '2026-10-19T14:40:00.000Z' },
        { id: 'a3', kind: 'idea', title: '帝江号指挥中枢信息层级草案', body: '档案库 / 活跃度 / IoT 三面板。', createdAt: '2026-10-18T08:05:00.000Z' },
        { id: 'a4', kind: 'vote', title: '是否开放外环第 07 中继', createdAt: '2026-10-17T20:30:00.000Z' },
        { id: 'a5', kind: 'chart', title: '近 7 天信号吞吐趋势', createdAt: '2026-10-16T11:00:00.000Z' },
        { id: 'a6', kind: 'music', title: '舰桥广播 BGM · 极光噪点', createdAt: '2026-10-15T22:10:00.000Z' },
      ],
    });
  return json({});
});

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const file = path.join(OUT, 'dijiang-dashboard-new.png');
await page.screenshot({ path: file });
console.log('SHOT', file);
console.log('TITLE', await page.locator('h1').first().textContent());
console.log('PANELS', await page.locator('main section').count());
console.log('FAILED', failed);
await browser.close();
