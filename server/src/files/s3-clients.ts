import { S3Client } from '@aws-sdk/client-s3';

export interface S3ClientOptions {
  /** 服务端内网可达地址（如 http://minio:9000） */
  endpoint: string;
  /** 浏览器/公网可达地址（如 https://files.example.com 或 http://localhost:9000） */
  publicEndpoint: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3ClientPair {
  /** 内网客户端：HeadObject / GetObject / DeleteObject / HeadBucket，不参与签名 URL 生成 */
  internal: S3Client;
  /** 公网客户端：只用于预签名，endpoint 必须是浏览器可达的地址 */
  signing: S3Client;
}

/**
 * 契约 §10 预签名直传的关键点：
 * 部署在容器/内网时，服务端访问 MinIO 用 `http://minio:9000`，但浏览器拿到的 uploadUrl
 * 必须是公网可达地址（`S3_PUBLIC_ENDPOINT`）。两者各建一个 S3Client：
 * - 数据面（HEAD/GET/DELETE）走内网，省流量、无需公网；
 * - 控制面（presign）走公网 endpoint，SigV4 的 host 即签名 host，浏览器才能直传。
 *
 * 注意：预签名 URL 的 path 会被完整签名（含 bucket），因此 `S3_PUBLIC_ENDPOINT` 不能带
 * 路径前缀（不能用 Caddy `/files/*` 反代形态），只能是独立端口或子域。
 */
export function createS3Clients(options: S3ClientOptions): S3ClientPair {
  const shared = {
    region: options.region,
    forcePathStyle: options.forcePathStyle,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    // rclone/MinIO 兼容：SDK v3 默认按 CRC32 双向校验，非 AWS 实现会返回不一致的
    // x-amz-checksum-crc32 导致 500；仅在协议要求时计算/校验。
    requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    responseChecksumValidation: 'WHEN_REQUIRED' as const,
  } as const;

  return {
    internal: new S3Client({ ...shared, endpoint: options.endpoint }),
    signing: new S3Client({ ...shared, endpoint: options.publicEndpoint }),
  };
}
