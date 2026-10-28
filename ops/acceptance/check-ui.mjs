#!/usr/bin/env node
/**
 * O.M.V 工作台 · 全域广播 —— UI 验收探针（零依赖）
 *
 * 对两套 UI 的 18 个页面逐页检查：
 *   1. HTTP 200、内容长度、页面标题标记（h1/标题关键字）
 *   2. 页面引用的本地资源（css/js/字体/图片）全部 200，无外链资源
 *   3. 两套 index 都链接到 8 个屏，无死链
 *
 * 用法：
 *   node ops/acceptance/check-ui.mjs [--base http://127.0.0.1:8099] [--json <路径>]
 * 退出码：0 全过；1 有失败。
 */
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = argOf('--base', 'http://127.0.0.1:8099').replace(/\/$/, '');
const JSON_OUT = argOf('--json', '');

const SUITES = [
  {
    key: 'ef',
    name: '甲套 · 工业协议',
    index: '/design/ui-endfield/index.html',
    screens: [
      ['01-chat.html', '全域播报'],
      ['02-archive.html', '素材工坊'],
      ['03-ideaboard.html', '灵感墙'],
      ['04-vote.html', '投票'],
      ['05-tasks.html', '任务清单'],
      ['06-showcase.html', '作品墙'],
      ['07-members.html', '成员与邀请'],
      ['08-settings.html', '设置'],
    ],
    dir: '/design/ui-endfield/screens/',
  },
  {
    key: 'ui2',
    name: '乙套 · 航测档案',
    index: '/design/ui-independent/index.html',
    screens: [
      ['01-chat.html', '信号流'],
      ['02-archive.html', '素材库'],
      ['03-ideaboard.html', '灵感墙'],
      ['04-vote.html', '投票 · 票根'],
      ['05-tasks.html', '任务台账'],
      ['06-showcase.html', '作品墙'],
      ['07-invite.html', '邀请成员'],
      ['08-settings.html', '设置'],
    ],
    dir: '/design/ui-independent/screens/',
  },
];

const rows = [];
const fail = (suite, page, message) => rows.push({ suite, page, ok: false, message });
const pass = (suite, page, message) => rows.push({ suite, page, ok: true, message });

async function get(url, method = 'GET') {
  const res = await fetch(url, { method, signal: AbortSignal.timeout(8000) });
  const body = method === 'HEAD' ? '' : await res.text();
  return { status: res.status, body, type: res.headers.get('content-type') ?? '' };
}

function resourceRefs(html) {
  const refs = [];
  const tagRe = /<(?:script|link|img|source|video|audio)\b[^>]*>/gi;
  for (const tag of html.match(tagRe) ?? []) {
    const attr = /(?:src|href)\s*=\s*"([^"]+)"/i.exec(tag);
    if (attr && attr[1]) refs.push(attr[1]);
  }
  return [...new Set(refs)];
}

function isLocal(ref) {
  return !/^(?:[a-z]+:|\/\/|#)/i.test(ref);
}

async function checkPage(suite, pagePath, marker, url) {
  let page;
  try {
    page = await get(url);
  } catch (error) {
    fail(suite.key, pagePath, `请求失败：${error.message}`);
    return;
  }
  if (page.status !== 200) {
    fail(suite.key, pagePath, `HTTP ${page.status}`);
    return;
  }
  if (!/text\/html/i.test(page.type)) {
    fail(suite.key, pagePath, `Content-Type 不是 HTML：${page.type || '空'}`);
    return;
  }
  if (page.body.length < 2000) {
    fail(suite.key, pagePath, `内容过短：${page.body.length} 字节`);
    return;
  }
  if (!page.body.includes(marker)) {
    fail(suite.key, pagePath, `缺少页面标记「${marker}」`);
    return;
  }

  // 本地资源必须全部可达；外链资源一律不允许（离线可验收）
  const refs = resourceRefs(page.body);
  const localRefs = refs.filter(isLocal);
  const externalRefs = refs.filter((ref) => /^(?:https?:)?\/\//i.test(ref));
  if (externalRefs.length > 0) {
    fail(suite.key, pagePath, `存在外链资源：${externalRefs.join(', ')}`);
    return;
  }
  for (const ref of localRefs) {
    const assetUrl = new URL(ref, url).href;
    try {
      const head = await get(assetUrl, 'HEAD');
      if (head.status !== 200) {
        fail(suite.key, pagePath, `资源 ${ref} → HTTP ${head.status}`);
        return;
      }
    } catch (error) {
      fail(suite.key, pagePath, `资源 ${ref} 请求失败：${error.message}`);
      return;
    }
  }
  pass(suite.key, pagePath, `标记「${marker}」· 本地资源 ${localRefs.length} 个全部可达`);
}

async function checkIndexLinks(suite) {
  const url = BASE + suite.index;
  let page;
  try {
    page = await get(url);
  } catch (error) {
    fail(suite.key, 'index.html', `请求失败：${error.message}`);
    return;
  }
  if (page.status !== 200) {
    fail(suite.key, 'index.html', `HTTP ${page.status}`);
    return;
  }
  const linked = new Set(
    [...page.body.matchAll(/screens\/(\d{2}-[a-z-]+\.html)/g)].map((m) => m[1]),
  );
  const expected = suite.screens.map(([file]) => file);
  const missing = expected.filter((file) => !linked.has(file));
  if (missing.length > 0) {
    fail(suite.key, 'index.html', `未链接的屏：${missing.join(', ')}`);
    return;
  }
  pass(suite.key, 'index.html', `链接到全部 8 屏 · 页面长度 ${page.body.length} 字节`);
}

async function main() {
  console.log(`[check-ui] 目标：${BASE}`);
  for (const suite of SUITES) {
    await checkIndexLinks(suite);
    for (const [file, marker] of suite.screens) {
      await checkPage(suite, file, marker, BASE + suite.dir + file);
    }
  }

  let current = '';
  for (const row of rows) {
    if (row.suite !== current) {
      current = row.suite;
      const name = SUITES.find((s) => s.key === current)?.name ?? current;
      console.log(`\n── ${name} ──`);
    }
    console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.page}  ${row.message}`);
  }

  const total = rows.length;
  const passed = rows.filter((row) => row.ok).length;
  const failed = total - passed;
  console.log(`\n[check-ui] ${passed}/${total} 通过，${failed} 失败`);

  if (JSON_OUT) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(JSON_OUT), { recursive: true });
    await fs.writeFile(
      JSON_OUT,
      JSON.stringify({ base: BASE, timestamp: new Date().toISOString(), total, passed, failed, rows }, null, 2),
      'utf8',
    );
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[check-ui] 未捕获错误：', error);
  process.exit(1);
});
