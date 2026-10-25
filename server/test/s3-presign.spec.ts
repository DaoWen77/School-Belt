import { describe, expect, it, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { S3Service } from '../src/files/s3.service';
import { createS3Clients } from '../src/files/s3-clients';
import type { AppConfig } from '../src/config/config.module';

/** 只填 S3Service 需要的字段，避免依赖完整 env */
function stubConfig(overrides: { endpoint?: string; publicEndpoint?: string } = {}): AppConfig {
  return {
    s3: {
      endpoint: overrides.endpoint ?? 'http://minio:9000',
      publicEndpoint: overrides.publicEndpoint ?? 'http://files.example.com',
      region: 'us-east-1',
      bucket: 'dijiang',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      forcePathStyle: true,
      presignExpiresSec: 900,
    },
  } as unknown as AppConfig;
}

type EndpointLike = { endpoint: () => Promise<{ hostname: string }> };

describe('S3 预签名使用公网端点（R1）', () => {
  it('presignPut / presignGet 的 host 是 S3_PUBLIC_ENDPOINT，不是内网 endpoint', async () => {
    const service = new S3Service(stubConfig({ endpoint: 'http://minio:9000', publicEndpoint: 'http://files.example.com' }));

    const putUrl = new URL(await service.presignPut('channels/c1/2026/10/a.png', 'image/png'));
    expect(putUrl.host).toBe('files.example.com');
    expect(putUrl.host).not.toContain('minio');
    // forcePathStyle：bucket 在 path 上，key 完整保留
    expect(putUrl.pathname).toBe('/dijiang/channels/c1/2026/10/a.png');
    expect(putUrl.searchParams.get('X-Amz-Signature')).toBeTruthy();

    const getUrl = new URL(await service.presignGet('channels/c1/2026/10/a.png'));
    expect(getUrl.host).toBe('files.example.com');
    expect(getUrl.pathname).toBe('/dijiang/channels/c1/2026/10/a.png');
    expect(getUrl.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('两个 S3Client 的 endpoint 不同：internal=内网、signing=公网', async () => {
    const pair = createS3Clients({
      endpoint: 'http://minio:9000',
      publicEndpoint: 'http://localhost:9000',
      region: 'us-east-1',
      forcePathStyle: true,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    });
    const internalEndpoint = await (pair.internal.config as unknown as EndpointLike).endpoint();
    const signingEndpoint = await (pair.signing.config as unknown as EndpointLike).endpoint();
    expect(internalEndpoint.hostname).toBe('minio');
    expect(signingEndpoint.hostname).toBe('localhost');
  });

  it('数据面（head / delete）只走内网 client，不触碰签名 client', async () => {
    const internalSend = vi.fn(async () => ({
      ContentLength: 2048,
      ContentType: 'image/png',
      ETag: '"abc"',
    }));
    const signingSend = vi.fn(async () => {
      throw new Error('signing client 不应处理数据面请求');
    });
    const pair = {
      internal: { send: internalSend } as unknown as S3Client,
      signing: { send: signingSend } as unknown as S3Client,
    };

    const service = new S3Service(stubConfig(), pair);
    const head = await service.head('channels/c1/a.png');
    expect(head).toEqual({ sizeBytes: 2048, mime: 'image/png', etag: '"abc"' });
    await service.delete('channels/c1/a.png');

    expect(internalSend).toHaveBeenCalledTimes(2);
    expect(signingSend).not.toHaveBeenCalled();
  });
});
