/**
 * Phase1：S3 浏览器直传地址推导。
 *
 * 优先级：
 * 1. 显式 `S3_PUBLIC_ENDPOINT`（运维指定，最可信）；
 * 2. API 监听 0.0.0.0 且有 LAN IP 时，用 `http://<LAN_IPS[0]>:<S3 endpoint 端口>`
 *    （手机/其他设备才能访问；服务端内部仍走 S3_ENDPOINT=127.0.0.1:9000）；
 * 3. 回退 `S3_ENDPOINT`。
 *
 * 注意：rclone/MinIO 必须监听 0.0.0.0（或至少 LAN 网卡），否则第 2 条的地址不可达。
 */
export function resolveS3PublicEndpoint({ explicit, endpoint, apiHost, lanIps = [] }) {
  if (explicit) return explicit;
  if (apiHost === '0.0.0.0' && lanIps.length > 0) {
    try {
      const parsed = new URL(endpoint);
      return `${parsed.protocol}//${lanIps[0]}${parsed.port ? `:${parsed.port}` : ''}`;
    } catch {
      return endpoint;
    }
  }
  return endpoint;
}
