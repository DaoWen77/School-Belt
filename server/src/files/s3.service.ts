import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../config/config.module';
import { currentOrigin } from '../common/request-origin';
import { createS3Clients, type S3ClientPair } from './s3-clients';

export interface ObjectHead {
  sizeBytes: number;
  mime: string;
  etag: string | null;
}

/** 测试/多环境注入点：默认由配置构造，生产 DI 不注册该 token */
export const S3_CLIENT_PAIR = Symbol('DIJIANG_S3_CLIENT_PAIR');

/**
 * S3 / MinIO 适配层（契约 §10 文件直传）：
 * presign PUT → 客户端直传 → complete 阶段 HEAD + 魔数嗅探 → 签名 GET。
 *
 * 两个客户端：
 * - `internal`（config.s3.endpoint）：HEAD / GET / DELETE / HeadBucket；
 * - `signing`（config.s3.publicEndpoint）：presignPut / presignGet，保证返回 URL 的 host
 *   是浏览器可达地址，而不是容器 DNS（如 minio:9000）。
 */
@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private readonly internal: S3Client;
  private readonly signing: S3Client;

  constructor(
    private readonly config: AppConfig,
    @Optional() @Inject(S3_CLIENT_PAIR) pair?: S3ClientPair,
  ) {
    const clients = pair ?? createS3Clients(config.s3);
    this.internal = clients.internal;
    this.signing = clients.signing;
  }

  onModuleInit(): void {
    this.logger.log(
      `S3 就绪：internal=${this.config.s3.endpoint} signing=${this.config.s3.publicEndpoint} bucket=${this.config.s3.bucket}`,
    );
  }

  get bucket(): string {
    return this.config.s3.bucket;
  }

  get presignExpiresSec(): number {
    return this.config.s3.presignExpiresSec;
  }

  /** 公网端点（签名 URL 的 host 来源），便于 /readyz 与排障输出 */
  get publicEndpoint(): string {
    return this.config.s3.publicEndpoint;
  }

  /** 预签名 PUT：Content-Type 参与签名，客户端必须原样回传；用公网 client 签名 */
  async presignPut(key: string, mime: string, expiresInSec = this.presignExpiresSec): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mime,
    });
    return getSignedUrl(this.signing, command, { expiresIn: expiresInSec });
  }

  /** 服务端回退上传：浏览器直传被 PNA/CORS 拦截时使用，仍复用同一 storageKey。 */
  async put(key: string, body: Uint8Array, mime: string): Promise<void> {
    await this.internal.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime }),
    );
  }

  /** 预签名 GET：variant=preview 时优先缩略图，无预览降级原图；用公网 client 签名 */
  /** 签名媒体代理 URL（PUBLIC_API_ORIGIN 配置时启用；浏览器无需 Bearer，也无法直连 S3） */
  mediaUrl(key: string, expiresInSec = this.config.media?.ttlSec ?? 600): string {
    const media = this.config.media;
    const origin = currentOrigin() ?? media?.proxyOrigin;
    if (!media || !origin) return '';
    const exp = Math.floor(Date.now() / 1000) + expiresInSec;
    const sig = createHmac('sha256', media.secret).update(`${key}.${exp}`).digest('base64url');
    return `${origin}/api/v1/files/view?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  }

  /** 校验媒体代理签名（常量时间比较） */
  verifyMedia(key: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = createHmac('sha256', this.config.media.secret).update(`${key}.${exp}`).digest('base64url');
    const a = Buffer.from(expected);
    const b = Buffer.from(sig ?? '');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async presignGet(key: string, expiresInSec = this.presignExpiresSec): Promise<string> {
    /* 有请求上下文 → 跟随访问者 host；无上下文（脚本）→ 用 PUBLIC_API_ORIGIN */
    const proxy = this.mediaUrl(key, expiresInSec);
    if (proxy) return proxy;
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.signing, command, { expiresIn: expiresInSec });
  }

  /** 读取对象流（下载代理用；绕过 presign 的 localhost/跨域问题） */
  async stream(key: string): Promise<{ body: NodeJS.ReadableStream; contentType: string | null; contentLength: number | null } | null> {
    try {
      const response = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        body: response.Body as unknown as NodeJS.ReadableStream,
        contentType: response.ContentType ?? null,
        contentLength: response.ContentLength ?? null,
      };
    } catch {
      return null;
    }
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        sizeBytes: Number(result.ContentLength ?? 0),
        mime: result.ContentType ?? 'application/octet-stream',
        etag: result.ETag ?? null,
      };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  /** 只取前 N 字节做魔数嗅探（契约 §10.3） */
  async readHead(key: string, bytes = 512): Promise<Uint8Array | null> {
    try {
      const result = await this.internal.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${bytes - 1}`,
        }),
      );
      if (!result.Body) return null;
      return await result.Body.transformToByteArray();
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** /readyz 探活 */
  async ping(): Promise<boolean> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
