#!/usr/bin/env node
/** 把桌面上的「将进酒.pptx」上传到环带频道并发送为附件消息 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://127.0.0.1:3000/api/v1';
const SRC = 'C:/Users/Administrator/Desktop/将进酒.pptx';
const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const OUT = path.resolve('reports', 'e2e');
const result = {};
const log = (key, value) => {
  result[key] = value;
  console.log(key, JSON.stringify(value).slice(0, 300));
};

const json = async (method, route, token, body) => {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
};

try {
  const bytes = fs.readFileSync(SRC);
  log('file', { path: SRC, size: bytes.length, mime: MIME });

  const login = await json('POST', '/belt/auth/login', null, { handle: 'founder', password: 'Dijiang#2026' });
  const token = login.data?.data?.accessToken;
  log('login', { status: login.status, ok: Boolean(token) });
  if (!token) throw new Error('登录失败');

  const channels = await json('GET', '/belt/channels', token);
  const list = channels.data?.data?.channels ?? channels.data?.data ?? [];
  const channel = list.find((item) => item.name?.includes('环带频道')) ?? list[0];
  log('channel', { id: channel?.id, name: channel?.name, count: list.length });

  const presign = await json('POST', '/belt/files/attachments/presign', token, {
    channelId: channel.id,
    filename: path.basename(SRC),
    mime: MIME,
    size: bytes.length,
  });
  const fileId = presign.data?.data?.fileId;
  const uploadUrl = presign.data?.data?.uploadUrl;
  log('presign', { status: presign.status, fileId, kind: presign.data?.data?.kind, maxBytes: presign.data?.data?.maxBytes, error: presign.data?.error?.message });
  if (!fileId) throw new Error('预签名失败');

  let uploaded = 'direct';
  try {
    const put = await fetch(uploadUrl, { method: 'PUT', headers: presign.data.data.headers ?? {}, body: bytes });
    if (!put.ok) throw new Error(`HTTP ${put.status}`);
  } catch (error) {
    uploaded = `fallback(${error.message})`;
    const fallback = await json('POST', `/belt/files/${fileId}/upload`, token, { data: bytes.toString('base64') });
    if (fallback.status >= 300) throw new Error(`回退上传失败 ${fallback.status} ${JSON.stringify(fallback.data?.error)}`);
  }
  log('upload', { via: uploaded });

  const complete = await json('POST', `/belt/files/${fileId}/complete`, token, {});
  log('complete', { status: complete.status, kind: complete.data?.data?.kind, size: complete.data?.data?.sizeBytes, error: complete.data?.error?.message });
  if (complete.status >= 300) throw new Error('complete 失败');

  const message = await json('POST', `/belt/channels/${channel.id}/messages`, token, {
    body: '【演示材料】将进酒.pptx — 点击卡片下载',
    attachmentIds: [fileId],
  });
  log('message', { status: message.status, id: message.data?.data?.id ?? message.data?.data?.message?.id, error: message.data?.error?.message });

  const download = await fetch(`${API}/belt/files/download/${fileId}`, { headers: { authorization: `Bearer ${token}` } });
  const downBytes = Buffer.from(await download.arrayBuffer());
  log('download', {
    status: download.status,
    bytes: downBytes.length,
    same: downBytes.length === bytes.length && downBytes.equals(bytes),
    disposition: download.headers.get('content-disposition'),
    contentType: download.headers.get('content-type'),
  });
} catch (error) {
  result.fatal = String(error?.stack ?? error);
  console.error(result.fatal);
} finally {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'upload-jiangjinjiu.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
