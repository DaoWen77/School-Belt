#!/usr/bin/env node
/**
 * 手工验证：AWS SDK v3 的**预签名 PUT/GET** 对真实 S3 兼容服务是否可用。
 * 只依赖 S3 服务本身，不经过工作台 API，用于证明“签名 URL 真能用”。
 *
 * 本机真实 S3：rclone 1.75.2 `serve s3`，127.0.0.1:9000，minioadmin/minioadmin。
 * 用法：node probe-s3.mjs
 *   前置：rclone serve s3 <dir> --addr 127.0.0.1:9000 --auth-key minioadmin,minioadmin --allow-origin *
 * 环境变量：E2E_S3_ENDPOINT / E2E_S3_BUCKET / E2E_S3_ACCESS_KEY / E2E_S3_SECRET_KEY / S3_IMPLEMENTATION
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPng } from './lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'reports', 'e2e', 's3-probe.json');

const ENDPOINT = process.env.E2E_S3_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
const BUCKET = process.env.E2E_S3_BUCKET ?? process.env.S3_BUCKET ?? 'dijiang';
const REGION = process.env.E2E_S3_REGION ?? process.env.S3_REGION ?? 'us-east-1';
const ACCESS_KEY = process.env.E2E_S3_ACCESS_KEY ?? process.env.S3_ACCESS_KEY_ID ?? 'minioadmin';
const SECRET_KEY = process.env.E2E_S3_SECRET_KEY ?? process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin';
const IMPLEMENTATION = process.env.S3_IMPLEMENTATION ?? 'rclone-s3';

const client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

const bytes = createPng({ width: 16, height: 16 });
const sha256 = createHash('sha256').update(bytes).digest('hex');
const key = `probe/real-s3-presign-${Date.now()}.png`;
const steps = [];
const record = (name, ok, detail = {}, error = null) => {
  const entry = { name, ok, detail, ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) };
  steps.push(entry);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ← ${entry.error}`}`);
  return entry;
};

let verdict = 'FAIL';
try {
  const bucketHead = await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
  record('HeadBucket（真实 S3 可达）', bucketHead.$metadata.httpStatusCode === 200, {
    status: bucketHead.$metadata.httpStatusCode,
  });

  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: 'image/png' }),
    { expiresIn: 300 },
  );
  record('预签名 PUT URL 生成', true, { key, host: new URL(uploadUrl).host, hasSignature: uploadUrl.includes('X-Amz-Signature') });

  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: bytes,
  });
  const putBody = await putResponse.text().catch(() => '');
  record('预签名 PUT 上传（SigV4 真校验）', putResponse.ok, {
    status: putResponse.status,
    etag: putResponse.headers.get('etag'),
    ...(putResponse.ok ? {} : { body: putBody.slice(0, 400) }),
  });
  if (!putResponse.ok) throw new Error(`PUT 失败：HTTP ${putResponse.status}`);

  const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  record('HeadObject 校验大小/类型', Number(head.ContentLength) === bytes.length, {
    contentLength: Number(head.ContentLength),
    contentType: head.ContentType,
    etag: head.ETag,
  });

  const ranged = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: 'bytes=0-511' }));
  const headBytes = await ranged.Body.transformToByteArray();
  record('GetObject Range 读取头部 512B', headBytes.length > 0 && Buffer.from(headBytes.subarray(0, 8)).equals(bytes.subarray(0, 8)), {
    got: headBytes.length,
    pngMagic: Buffer.from(headBytes.subarray(0, 8)).toString('hex'),
  });

  const downloadUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 300 });
  const download = await fetch(downloadUrl);
  const downloaded = Buffer.from(await download.arrayBuffer());
  record('预签名 GET 下载并按字节比对', download.ok && downloaded.equals(bytes), {
    status: download.status,
    bytes: downloaded.length,
    sha256: createHash('sha256').update(downloaded).digest('hex'),
  });

  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  record('DeleteObject 清理探针对象', true);
  verdict = steps.every((step) => step.ok) ? 'PASS' : 'FAIL';
} catch (error) {
  record('异常中断', false, {}, error);
} finally {
  const result = {
    checkedAt: new Date().toISOString(),
    implementation: IMPLEMENTATION,
    implementationNote: '真实 S3 兼容服务（本机 rclone serve s3；非 MinIO、非内置替身）',
    endpoint: ENDPOINT,
    bucket: BUCKET,
    region: REGION,
    forcePathStyle: true,
    requestBytes: bytes.length,
    requestSha256: sha256,
    steps,
    verdict,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`\nverdict=${verdict}  证据：${OUT}`);
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}
