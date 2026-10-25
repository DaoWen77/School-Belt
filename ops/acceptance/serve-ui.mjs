#!/usr/bin/env node
/**
 * O.M.V 帝江号 · 全域广播 —— 验收静态服务（零依赖）
 *
 * 只做一件事：把工作区目录以 HTTP 方式暴露给浏览器，供两套 UI 与验收台预览。
 * 不依赖任何 npm 包，Node >= 18 即可运行。
 *
 * 用法：
 *   node ops/acceptance/serve-ui.mjs --port 8099 [--root <工作区>]
 * 路由：
 *   /__health   健康探针（JSON）
 *   其余         工作区文件（目录自动找 index.html）
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(argOf('--port', '8099'));
const HOST = '127.0.0.1';
const ROOT = path.resolve(argOf('--root', path.join(HERE, '..', '..')));
const STARTED_AT = new Date().toISOString();

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.map', 'application/json; charset=utf-8'],
]);

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendText(res, status, text) {
  const payload = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD');
      return sendText(res, 405, '只支持 GET / HEAD');
    }

    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    if (url.pathname === '/__health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'dijiang-acceptance-preview',
        pid: process.pid,
        root: ROOT,
        startedAt: STARTED_AT,
      });
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendText(res, 400, '非法路径');
    }
    if (pathname.includes('\0')) return sendText(res, 400, '非法路径');

    // 目录穿越防护：解析后必须仍在 ROOT 之内
    let filePath = path.resolve(ROOT, `.${pathname}`);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      return sendText(res, 403, '越界访问');
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return sendText(res, 404, `404 未找到：${pathname}`);
    }
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      try {
        stat = await fsp.stat(filePath);
      } catch {
        return sendText(res, 404, '目录下没有 index.html');
      }
    }
    if (!stat.isFile()) return sendText(res, 404, '不是文件');

    const type = MIME.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': stat.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath)
      .on('error', () => {
        if (!res.headersSent) sendText(res, 500, '读取文件失败');
        else res.destroy();
      })
      .pipe(res);
  } catch (error) {
    sendText(res, 500, `内部错误：${error instanceof Error ? error.message : String(error)}`);
  }
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`[serve-ui] 端口 ${PORT} 已被占用，请换一个端口：--port 8100`);
    process.exit(2);
  }
  console.error('[serve-ui] 启动失败：', error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[serve-ui] 工作区根目录：${ROOT}`);
  console.log(`[serve-ui] 验收台：http://${HOST}:${PORT}/ops/acceptance/hub.html`);
  console.log(`SERVE_READY http://${HOST}:${PORT} pid=${process.pid}`);
});

const shutdown = () => {
  console.log('[serve-ui] 正在关闭…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
