#!/usr/bin/env node
/**
 * 公网穿透端到端自检（真实 ofalias 域名，不用 localhost）
 *
 *   Web : http://cn-hk-bgp-4.ofalias.net:51065
 *   API : http://cn-hk-bgp-4.ofalias.net:20097
 *
 * 覆盖：CORS 预检 / 登录 / 预签名 / 上传（回环直传自动回退）/ complete /
 *       下载代理（Content-Disposition + 字节一致 + 无回环地址）/ 未登录 401
 *
 * 用法：node file-tunnel-check.mjs [--web URL] [--api URL] [--handle qiu]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const WEB = arg('--web', 'http://cn-hk-bgp-4.ofalias.net:51065').replace(/\/$/, '');
const API_ROOT = arg('--api', 'http://cn-hk-bgp-4.ofalias.net:20097').replace(/\/$/, '');
const API = `${API_ROOT}/api/v1`;
const HANDLE = arg('--handle', 'qiu');
const PASSWORD = process.env.SEED_PASSWORD ?? 'Dijiang#2026';
const OUT = path.join(ROOT, 'reports', 'e2e');

const checks = [];
const log = (id, ok, detail = {}) => {
  checks.push({ id, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${JSON.stringify(detail).slice(0, 260)}`);
};

const call = async (method, route, { token, body, origin } = {}) => {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, json, buffer };
};

try {
  /* 1. CORS 预检 */
  const preflight = await fetch(`${API}/belt/auth/login`, {
    method: 'OPTIONS',
    headers: {
      origin: WEB,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,authorization',
    },
  });
  const allowOrigin = preflight.headers.get('access-control-allow-origin');
  const allowHeaders = preflight.headers.get('access-control-allow-headers') ?? '';
  log('C1 公网 CORS 预检', [200, 204].includes(preflight.status) && (allowOrigin === WEB || allowOrigin === '*'), {
    status: preflight.status,
    allowOrigin,
    allowHeaders,
    allowMethods: preflight.headers.get('access-control-allow-methods'),
  });

  /* 2. 登录（带 Origin） */
  const login = await call('POST', '/belt/auth/login', {
    body: { handle: HANDLE, password: PASSWORD },
    origin: WEB,
  });
  const token = login.json?.data?.accessToken;
  log('C2 公网登录不跨域', login.status === 200 && Boolean(token) && Boolean(login.headers.get('access-control-allow-origin')), {
    status: login.status,
    acao: login.headers.get('access-control-allow-origin'),
    handle: login.json?.data?.user?.handle,
  });
  if (!token) throw new Error('登录失败，后续中止');

  /* 3. 频道 */
  const channels = await call('GET', '/belt/channels', { token, origin: WEB });
  const list = channels.json?.data?.channels ?? channels.json?.data ?? [];
  const channel = list[0];
  log('C3 公网频道列表', channels.status === 200 && Boolean(channel?.id), { count: list.length, name: channel?.name });

  /* 4. 预签名 */
  const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2048, 0x44)]);
  const filename = `公网穿透测试-${Date.now()}.pptx`;
  const presign = await call('POST', '/belt/files/attachments/presign', {
    token,
    origin: WEB,
    body: {
      channelId: channel.id,
      filename,
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size: bytes.length,
    },
  });
  const fileId = presign.json?.data?.fileId;
  const uploadUrl = presign.json?.data?.uploadUrl ?? '';
  const uploadHost = (() => {
    try {
      return new URL(uploadUrl).host;
    } catch {
      return null;
    }
  })();
  log('F1 公网预签名', presign.status === 200 && Boolean(fileId), {
    status: presign.status,
    kind: presign.json?.data?.kind,
    maxBytes: presign.json?.data?.maxBytes,
    uploadHost,
    loopback: /^(localhost|127\.0\.0\.1)/.test(uploadHost ?? ''),
  });
  if (!fileId) throw new Error('预签名失败');

  /* 5. 上传：预签名回环 → 走服务端回退（与公网浏览器行为一致） */
  let via = 'direct';
  if (/^(localhost|127\.0\.0\.1)/.test(uploadHost ?? '')) {
    via = 'fallback';
  } else {
    const put = await fetch(uploadUrl, { method: 'PUT', headers: presign.json.data.headers ?? {}, body: bytes });
    if (!put.ok) via = 'fallback';
  }
  if (via === 'fallback') {
    const fallback = await call('POST', `/belt/files/${fileId}/upload`, {
      token,
      origin: WEB,
      body: { data: bytes.toString('base64') },
    });
    if (fallback.status >= 300) throw new Error(`回退上传失败 ${fallback.status}`);
  }
  log('F2 公网上传', true, { via, bytes: bytes.length });

  /* 6. complete */
  const complete = await call('POST', `/belt/files/${fileId}/complete`, { token, origin: WEB, body: {} });
  log('F3 公网 complete', complete.status === 200, {
    status: complete.status,
    kind: complete.json?.data?.kind,
    size: complete.json?.data?.sizeBytes,
    error: complete.json?.error?.message,
  });

  /* 7. 下载代理（用户指定的 /api/v1/files/download/:id） */
  const download = await call('GET', `/files/download/${fileId}`, { token, origin: WEB });
  const disposition = download.headers.get('content-disposition') ?? '';
  const same = download.buffer.equals(bytes);
  log('F4 下载代理（/files/download/:id）', download.status === 200 && same, {
    status: download.status,
    bytes: download.buffer.length,
    same,
    contentType: download.headers.get('content-type'),
  });
  log('F5 Content-Disposition 附件', /attachment;/.test(disposition) && /\.pptx/.test(disposition), { disposition });

  /* 8. 无回环地址泄露 */
  const headerDump = JSON.stringify([...download.headers.entries()]);
  log('F6 响应不含 127.0.0.1/localhost', !/127\.0\.0\.1|localhost/i.test(headerDump), {
    location: download.headers.get('location'),
    acao: download.headers.get('access-control-allow-origin'),
  });

  /* 9. 环带路径同样可用 */
  const beltDownload = await call('GET', `/belt/files/download/${fileId}`, { token, origin: WEB });
  log('F7 环带下载路径可用', beltDownload.status === 200 && beltDownload.buffer.equals(bytes), {
    status: beltDownload.status,
    bytes: beltDownload.buffer.length,
  });

  /* 10. 未登录 */
  const anonymous = await call('GET', `/files/download/${fileId}`, { origin: WEB });
  log('F8 未登录下载被拒', anonymous.status === 401, { status: anonymous.status });

  /* 11. 真正发一条消息，便于在公网页面肉眼验证 */
  const message = await call('POST', `/belt/channels/${channel.id}/messages`, {
    token,
    origin: WEB,
    body: { body: `【公网自检】${filename}`, attachmentIds: [fileId] },
  });
  log('F9 公网发消息带附件', message.status === 201, { status: message.status });
} catch (error) {
  checks.push({ id: 'fatal', ok: false, error: String(error?.message ?? error) });
  console.error('FATAL', error);
} finally {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'file-tunnel-public.json'), `${JSON.stringify({ web: WEB, api: API_ROOT, checks }, null, 2)}\n`, 'utf8');
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 通过${failed.length ? `，失败：${failed.map((f) => f.id).join(',')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}
