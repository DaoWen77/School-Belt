/**
 * 上传全链路（契约 §10 / task-13 的 F9）——真实 HTTP，无 mock：
 *   presign → 预签名 PUT 真实字节 → complete（HEAD + 魔数嗅探）→ 预签名 GET 下载并逐字节比对
 *   → REST 发带 attachmentIds 的消息 → 读回确认 attachments
 *   → 限额拒绝：25MB 超限（413 FILE_TOO_LARGE）、伪造 MIME（415 FILE_TYPE_NOT_ALLOWED）
 *
 * 被 verify-upload.mjs（独立证据）与 smoke-api.mjs（F9）共用。
 */
import { createHash } from 'node:crypto';
import { createPng } from './png.mjs';

class HttpError extends Error {
  constructor(label, status, body) {
    super(`${label} → HTTP ${status} ${JSON.stringify(body)?.slice(0, 400)}`);
    this.status = status;
    this.body = body;
  }
}

async function api(base, method, apiPath, { token, body, timeoutMs = 20_000 } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) throw new HttpError(`${method} ${apiPath}`, response.status, payload);
  return payload?.data ?? payload;
}

/** 统一错误码读取（信封 {ok:false,error:{code,message}}） */
function errorCode(error) {
  if (!(error instanceof HttpError)) return null;
  const body = error.body;
  return body?.error?.code ?? body?.code ?? null;
}

/**
 * @param {{base: string, token: string, channelId: string, log?: (msg: string) => void}} options
 */
export async function runUploadFlow({ base, token, channelId, log = () => undefined }) {
  const steps = [];
  const add = (id, name, ok, detail = {}, error = null) => {
    const entry = {
      id,
      name,
      ok,
      detail,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    };
    steps.push(entry);
    log(`${ok ? '✓' : '✗'} ${id} ${name}${ok ? '' : `：${entry.error ?? ''}`}`);
    return entry;
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  const bytes = createPng({ width: 24, height: 18 });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const filename = `e2e-upload-${Date.now()}.png`;
  const result = {
    bytes: bytes.length,
    sha256,
    presigned: null,
    upload: null,
    complete: null,
    download: null,
    message: null,
    limits: {},
    steps,
    ok: false,
  };

  // ── 1) presign ────────────────────────────────────────────────────────
  const presign = await api(base, 'POST', '/files/presign', {
    token,
    body: { channelId, filename, mime: 'image/png', size: bytes.length },
  });
  const { fileId, uploadUrl } = presign ?? {};
  assert(fileId && uploadUrl, `presign 返回缺字段：${JSON.stringify(presign)?.slice(0, 300)}`);
  const uploadHost = new URL(uploadUrl).host;
  const signed = uploadUrl.includes('X-Amz-Signature');
  add('U1', 'POST /files/presign（真实 PNG 24×18）', true, {
    fileId,
    kind: presign.kind,
    maxBytes: presign.maxBytes,
    method: presign.method,
    expiresIn: presign.expiresIn,
    uploadHost,
    presignedSignature: signed,
    bytes: bytes.length,
  });
  result.presigned = { fileId, uploadHost, presignedSignature: signed, kind: presign.kind };

  // ── 2) 预签名 PUT 真实字节 ────────────────────────────────────────────
  const putStarted = Date.now();
  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/png', ...(presign.headers ?? {}) },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  });
  const putBody = await putResponse.text().catch(() => '');
  assert(putResponse.ok, `预签名 PUT 失败：HTTP ${putResponse.status} ${putBody.slice(0, 300)}`);
  const putMs = Date.now() - putStarted;
  add('U2', '预签名 PUT 上传真实 PNG 字节', true, {
    status: putResponse.status,
    etag: putResponse.headers.get('etag'),
    uploadMs: putMs,
    bytes: bytes.length,
  });
  result.upload = { status: putResponse.status, etag: putResponse.headers.get('etag'), uploadMs: putMs };

  // ── 3) complete（HEAD 大小 + 魔数嗅探）───────────────────────────────
  const completed = await api(base, 'POST', `/files/${fileId}/complete`, {
    token,
    body: { checksum: sha256 },
  });
  assert(completed?.status === 'ready', `complete 后 status 不是 ready：${JSON.stringify(completed)?.slice(0, 300)}`);
  assert(Number(completed.sizeBytes) === bytes.length, `complete sizeBytes ${completed.sizeBytes} ≠ ${bytes.length}`);
  assert(completed.mime === 'image/png', `complete mime ${completed.mime} ≠ image/png`);
  assert(completed.kind === 'image', `complete kind ${completed.kind} ≠ image`);
  add('U3', 'POST /files/:id/complete（大小 + 魔数校验）→ ready', true, {
    status: completed.status,
    sizeBytes: completed.sizeBytes,
    mime: completed.mime,
    kind: completed.kind,
    previewStatus: completed.previewStatus,
  });
  result.complete = {
    status: completed.status,
    sizeBytes: completed.sizeBytes,
    mime: completed.mime,
    kind: completed.kind,
  };

  // ── 4) 预签名 GET 下载并逐字节比对 ────────────────────────────────────
  const urlInfo = await api(base, 'GET', `/files/${fileId}/url`, { token });
  assert(urlInfo?.url, `GET /files/:id/url 未返回 url：${JSON.stringify(urlInfo)?.slice(0, 300)}`);
  const downloadResponse = await fetch(urlInfo.url, { signal: AbortSignal.timeout(30_000) });
  assert(downloadResponse.ok, `下载失败：HTTP ${downloadResponse.status}`);
  const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
  const downloadedSha = createHash('sha256').update(downloaded).digest('hex');
  const lengthEqual = downloaded.length === bytes.length;
  const byteEqual = lengthEqual && downloaded.equals(bytes);
  const hashEqual = downloadedSha === sha256;
  assert(byteEqual, `下载字节与上传不一致：长度 ${downloaded.length}/${bytes.length}，sha256 ${downloadedSha}`);
  add('U4', 'GET /files/:id/url 下载 + 逐字节比对', byteEqual && hashEqual, {
    downloadStatus: downloadResponse.status,
    downloadHost: new URL(urlInfo.url).host,
    downloadedBytes: downloaded.length,
    lengthEqual,
    byteEqual,
    sha256Equal: hashEqual,
    sha256,
  });
  result.download = {
    status: downloadResponse.status,
    bytes: downloaded.length,
    byteEqual,
    sha256Equal: hashEqual,
    sha256: downloadedSha,
  };

  // ── 5) 带 attachmentIds 的消息 + 读回确认 ────────────────────────────
  const clientMsgId = cryptoSafeUuid();
  const bodyText = `[e2e] 带附件消息 ${Date.now()}`;
  const sent = await api(base, 'POST', `/channels/${channelId}/messages`, {
    token,
    body: { clientMsgId, kind: 'text', body: bodyText, attachmentIds: [fileId] },
  });
  assert(sent?.message?.id, `发消息未返回 message.id：${JSON.stringify(sent)?.slice(0, 300)}`);
  const page = await api(base, 'GET', `/channels/${channelId}/messages?limit=20&direction=older`, { token });
  const readBack = (page?.messages ?? []).find((item) => item.clientMsgId === clientMsgId);
  assert(readBack, `读回消息找不到 clientMsgId=${clientMsgId}`);
  const attachment = (readBack.attachments ?? [])[0];
  assert(attachment, '读回消息没有 attachments');
  assert(attachment.fileId === fileId, `attachment.fileId ${attachment.fileId} ≠ ${fileId}`);
  assert(attachment.originalName === filename, `attachment.originalName ${attachment.originalName} ≠ ${filename}`);
  add('U5', 'REST 发带 attachmentIds 消息 → 读回确认 attachments', true, {
    messageId: sent.message.id,
    clientMsgId,
    attachment: {
      fileId: attachment.fileId,
      originalName: attachment.originalName,
      mime: attachment.mime,
      sizeBytes: attachment.sizeBytes,
      kind: attachment.kind,
    },
  });
  result.message = { messageId: sent.message.id, clientMsgId, fileId: attachment.fileId };

  // ── 6) 限额用例 1：25MB 图片超限（图片上限 20MB）────────────────────
  const oversize = 25 * 1024 * 1024;
  try {
    await api(base, 'POST', '/files/presign', {
      token,
      body: { channelId, filename: 'oversize-25mb.png', mime: 'image/png', size: oversize },
    });
    add('U6', '25MB PNG 应被 presign 拒绝', false, { sizeBytes: oversize }, new Error('服务端竟然接受了 25MB 图片'));
    result.limits.oversize = { rejected: false };
  } catch (error) {
    const code = errorCode(error);
    const ok = error instanceof HttpError && error.status === 413 && code === 'FILE_TOO_LARGE';
    add('U6', '25MB PNG 被 presign 拒绝（413 FILE_TOO_LARGE）', ok, {
      status: error instanceof HttpError ? error.status : null,
      code,
      maxBytes: error.body?.error?.maxBytes ?? null,
    }, ok ? null : error);
    result.limits.oversize = { rejected: ok, status: error instanceof HttpError ? error.status : null, code };
  }

  // ── 7) 限额用例 2：伪造 MIME（声明 png，实际不是 PNG 魔数）──────────
  const fakeBytes = Buffer.from('this is definitely not a png file, only text bytes 0123456789');
  const fakePresign = await api(base, 'POST', '/files/presign', {
    token,
    body: { channelId, filename: 'fake-image.png', mime: 'image/png', size: fakeBytes.length },
  });
  const fakePut = await fetch(fakePresign.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: fakeBytes,
    signal: AbortSignal.timeout(30_000),
  });
  assert(fakePut.ok, `伪造文件 PUT 失败：HTTP ${fakePut.status}`);
  try {
    await api(base, 'POST', `/files/${fakePresign.fileId}/complete`, { token, body: {} });
    add('U7', '伪造 MIME（声明 png / 实际文本）应被 complete 拒绝', false, {}, new Error('complete 竟然通过了'));
    result.limits.fakeMime = { rejected: false };
  } catch (error) {
    const code = errorCode(error);
    const ok = error instanceof HttpError && error.status === 415 && code === 'FILE_TYPE_NOT_ALLOWED';
    // 被拒绝后该文件应停在 rejected：再取 url 应 409 FILE_NOT_READY
    let notReadyCode = null;
    let notReadyStatus = null;
    try {
      await api(base, 'GET', `/files/${fakePresign.fileId}/url`, { token });
    } catch (urlError) {
      notReadyCode = errorCode(urlError);
      notReadyStatus = urlError instanceof HttpError ? urlError.status : null;
    }
    const stateOk = notReadyCode === 'FILE_NOT_READY' && notReadyStatus === 409;
    add('U7', '伪造 MIME 被 complete 拒绝（415 FILE_TYPE_NOT_ALLOWED）且文件置 rejected', ok && stateOk, {
      completeStatus: error instanceof HttpError ? error.status : null,
      code,
      urlStatus: notReadyStatus,
      urlCode: notReadyCode,
    }, ok && stateOk ? null : error);
    result.limits.fakeMime = {
      rejected: ok,
      status: error instanceof HttpError ? error.status : null,
      code,
      fileStayedRejected: stateOk,
    };
  }

  // ── 8) 限额用例 3：不支持的类型（text/html）──────────────────────────
  try {
    await api(base, 'POST', '/files/presign', {
      token,
      body: { channelId, filename: 'evil.html', mime: 'text/html', size: 128 },
    });
    add('U8', '不支持类型 text/html 应被 presign 拒绝', false, {}, new Error('服务端竟然接受了 text/html'));
    result.limits.unsupportedMime = { rejected: false };
  } catch (error) {
    const code = errorCode(error);
    const ok = error instanceof HttpError && error.status === 415 && code === 'FILE_TYPE_NOT_ALLOWED';
    add('U8', '不支持类型 text/html 被 presign 拒绝（415 FILE_TYPE_NOT_ALLOWED）', ok, {
      status: error instanceof HttpError ? error.status : null,
      code,
    }, ok ? null : error);
    result.limits.unsupportedMime = { rejected: ok, status: error instanceof HttpError ? error.status : null, code };
  }

  result.ok = steps.every((step) => step.ok);
  return result;
}

/** 生成 uuid v4（不复用外部依赖） */
function cryptoSafeUuid() {
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
