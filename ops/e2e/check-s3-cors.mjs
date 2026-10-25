#!/usr/bin/env node
/**
 * task-18：S3（rclone serve s3 @9000）CORS 验收
 *
 * 浏览器直传必须过 CORS 预检，因此验三件事：
 *   1) OPTIONS 预检（Origin + Access-Control-Request-Method: PUT）→ 2xx 且带 Allow-Origin/Methods/Headers
 *   2) 预签名 PUT（带 Origin）→ 成功且响应带 Allow-Origin
 *   3) 预签名 GET（带 Origin）→ 成功且响应带 Allow-Origin，字节一致
 * 结果写 reports/infra/s3-cors.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'reports', 'infra');
const OUT = path.join(OUT_DIR, 's3-cors.json');

const ENDPOINT = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
const BUCKET = process.env.S3_BUCKET ?? 'dijiang';
const REGION = process.env.S3_REGION ?? 'us-east-1';
const ACCESS_KEY = process.env.S3_ACCESS_KEY_ID ?? 'minioadmin';
const SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin';
const ORIGIN = process.env.E2E_ORIGIN ?? 'http://localhost:3100';

const client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

const steps = [];
const add = (id, name, ok, detail = {}, error = null) => {
  const entry = { id, name, ok, detail, ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) };
  steps.push(entry);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${name}${ok ? '' : `  ← ${entry.error}`}`);
  return entry;
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const corsOf = (headers) => ({
  allowOrigin: headers.get('access-control-allow-origin'),
  allowMethods: headers.get('access-control-allow-methods'),
  allowHeaders: headers.get('access-control-allow-headers'),
  exposeHeaders: headers.get('access-control-expose-headers'),
  maxAge: headers.get('access-control-max-age'),
});

const key = `cors-check/${Date.now()}-${randomUUID().slice(0, 8)}.txt`;
const bytes = Buffer.from(`cors check ${new Date().toISOString()}`, 'utf8');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const objectUrl = `${ENDPOINT}/${BUCKET}/${key}`;

try {
  // 1) OPTIONS 预检
  const preflight = await fetch(objectUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const preflightCors = corsOf(preflight.headers);
  const preflightOk =
    (preflight.status === 200 || preflight.status === 204) &&
    Boolean(preflightCors.allowOrigin) &&
    (preflightCors.allowOrigin === '*' || preflightCors.allowOrigin.includes(ORIGIN));
  add('C1', `OPTIONS 预检（Origin: ${ORIGIN} → PUT）`, preflightOk, {
    status: preflight.status,
    ...preflightCors,
  }, preflightOk ? null : new Error(`状态或 CORS 头不满足：${JSON.stringify(preflightCors)}`));

  // 2) 预签名 PUT（带 Origin，模拟浏览器直传）
  const putUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: 'text/plain' }), {
    expiresIn: 300,
  });
  const put = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain', Origin: ORIGIN },
    body: bytes,
    signal: AbortSignal.timeout(20_000),
  });
  const putCors = corsOf(put.headers);
  const putOk = put.ok && Boolean(putCors.allowOrigin);
  add('C2', '预签名 PUT（带 Origin）→ 200 且回 CORS 头', putOk, {
    status: put.status,
    etag: put.headers.get('etag'),
    bytes: bytes.length,
    ...putCors,
  }, putOk ? null : new Error(`HTTP ${put.status}，CORS=${JSON.stringify(putCors)}`));

  // 3) 预签名 GET（带 Origin）→ 字节一致
  const getUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 300 });
  const got = await fetch(getUrl, { headers: { Origin: ORIGIN }, signal: AbortSignal.timeout(20_000) });
  const gotBytes = Buffer.from(await got.arrayBuffer());
  const gotCors = corsOf(got.headers);
  const gotOk = got.ok && Boolean(gotCors.allowOrigin) && gotBytes.equals(bytes);
  add('C3', '预签名 GET（带 Origin）→ 字节一致 + CORS 头', gotOk, {
    status: got.status,
    bytes: gotBytes.length,
    sha256: createHash('sha256').update(gotBytes).digest('hex'),
    expectedSha256: sha256,
    byteEqual: gotBytes.equals(bytes),
    ...gotCors,
  }, gotOk ? null : new Error(`HTTP ${got.status}，byteEqual=${gotBytes.equals(bytes)}，CORS=${JSON.stringify(gotCors)}`));
} catch (error) {
  add('C0', 'CORS 验收异常中断', false, {}, error);
}

const failed = steps.filter((step) => !step.ok);
const result = {
  checkedAt: new Date().toISOString(),
  endpoint: ENDPOINT,
  bucket: BUCKET,
  origin: ORIGIN,
  note: 'rclone serve s3 的 CORS 由启动参数 --allow-origin 提供；浏览器直传必须通过此预检',
  steps,
  verdict: failed.length === 0 ? 'PASS' : 'FAIL',
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`\nverdict=${result.verdict}  证据：${OUT}`);
process.exitCode = result.verdict === 'PASS' ? 0 : 1;
