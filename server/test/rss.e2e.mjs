#!/usr/bin/env node
/**
 * RSS 新闻塔 E2E：真实 API + 本地 RSS feed + PostgreSQL。
 * 验证：配置源 → 抓取 → posts/telegraph 写入 → 二次抓取幂等 → 删除源。
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const requireServer = createRequire(path.join(ROOT, 'package.json'));
const { PrismaClient } = requireServer('@prisma/client');
const prisma = new PrismaClient();

const API = 'http://127.0.0.1:3000/api/v1';
const FEED_PORT = 4217;
const FEED_URL = `http://127.0.0.1:${FEED_PORT}/feed.xml`;
const stamp = Date.now().toString(36).slice(-5);
const sourceName = `Mock Wire ${stamp}`;
const titles = [`外环物流低功耗调度 ${stamp}`, `跨带天线测试 ${stamp}`];
const checks = [];

function check(condition, label, detail = '') {
  if (!condition) throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  checks.push(label);
  console.log(`✓ ${label}`);
}

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'user-agent': 'rss-e2e/1.0',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}
const data = (response) => response.json?.data;

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${sourceName}</title>
    <link>https://example.test/</link>
    <description>O.M.V test wire</description>
    <item>
      <title>${titles[0]}</title>
      <link>https://example.test/a?${stamp}</link>
      <guid>test-${stamp}-a</guid>
      <pubDate>Fri, 24 Oct 2026 20:00:00 GMT</pubDate>
      <description><![CDATA[<p>多家运输节点开始采用夜间低功耗调度。</p>]]></description>
    </item>
    <item>
      <title>${titles[1]}</title>
      <link>https://example.test/b?${stamp}</link>
      <guid>test-${stamp}-b</guid>
      <pubDate>Fri, 24 Oct 2026 20:10:00 GMT</pubDate>
      <description>测试信号在断带边缘保持了十七分钟。</description>
    </item>
  </channel>
</rss>`;

async function main() {
  await prisma.post.deleteMany({ where: { sourceName } }).catch(() => null);
  await prisma.rssSource.deleteMany({ where: { name: sourceName } }).catch(() => null);

  const server = createServer((request, response) => {
    if (request.url === '/feed.xml') {
      response.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
      response.end(feed);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(FEED_PORT, '127.0.0.1', resolve));

  try {
    const login = await call('/auth/login', {
      method: 'POST',
      body: { handle: 'founder', password: 'Dijiang#2026' },
    });
    check(login.status === 200, 'Owner 登录');
    const token = data(login).accessToken;

    const invalid = await call('/rss/sources', {
      method: 'POST',
      token,
      body: { name: 'bad', url: 'ftp://example.com/feed' },
    });
    check(invalid.status === 400, '非法 RSS URL 被 400 拒绝');

    const created = await call('/rss/sources', {
      method: 'POST',
      token,
      body: { name: sourceName, url: FEED_URL },
    });
    check(created.status === 201, '创建 RSS 源 201');
    const sourceId = data(created).source.id;

    const list = await call('/rss/sources', { token });
    check(list.status === 200 && data(list).sources.some((source) => source.id === sourceId), '源列表可见');

    const fetched = await call('/rss/fetch', { method: 'POST', token, body: {} });
    check(fetched.status === 200, '抓取接口 200');
    const report = data(fetched).reports.find((row) => row.sourceId === sourceId);
    check(report?.fetched === 2, '解析 2 条 RSS item', JSON.stringify(report));
    check(report?.created === 2, '首次抓取写入 2 条', JSON.stringify(report));

    const posts = await prisma.post.findMany({
      where: { surface: 'belt', board: 'telegraph', source: 'rss', sourceName },
      select: { id: true, title: true, body: true, sourceUrl: true, publishedAt: true },
    });
    check(posts.length === 2, 'Post 写入 2 条');
    check(posts.every((post) => titles.includes(post.title)), '标题正确');
    check(posts.every((post) => !post.body.includes('<p>')), 'HTML 已清洗');
    check(posts.every((post) => Boolean(post.sourceUrl)), '保留来源链接');

    const items = await prisma.rssItem.count({ where: { sourceId } });
    check(items === 2, 'rss_items 幂等账本 2 条');

    const second = await call('/rss/fetch', { method: 'POST', token, body: {} });
    const secondReport = data(second).reports.find((row) => row.sourceId === sourceId);
    check(secondReport?.created === 0, '二次抓取不重复创建', JSON.stringify(secondReport));
    check(secondReport?.skipped === 2, '二次抓取跳过 2 条', JSON.stringify(secondReport));

    const detail = await call(`/rss/sources`, { token });
    const sourceView = data(detail).sources.find((source) => source.id === sourceId);
    check(Boolean(sourceView?.lastFetchedAt), '源记录 lastFetchedAt');
    check(sourceView?.itemCount === 2, '源记录 itemCount=2');

    const removed = await call(`/rss/sources/${sourceId}`, { method: 'DELETE', token });
    check(removed.status === 200, '删除 RSS 源 200');
    check((await prisma.rssItem.count({ where: { sourceId } })) === 0, '删除源级联删除 rss_items');
    check(
      (await prisma.post.count({ where: { sourceName, surface: 'belt' } })) === 2,
      '删除源保留已抓取电文',
    );

    console.log('\nRSS_E2E_RESULT=' + JSON.stringify({ ok: true, checks: checks.length }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.post.deleteMany({ where: { sourceName } });
    await prisma.rssSource.deleteMany({ where: { name: sourceName } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`\nRSS_E2E_RESULT=${JSON.stringify({ ok: false, error: String(error) })}`);
  process.exitCode = 1;
});
