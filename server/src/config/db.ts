/**
 * PG 连接池参数注入。
 *
 * Prisma 的连接串支持 `connection_limit` / `pool_timeout` / `connect_timeout`；
 * 本地 embedded PG 与生产 PG 都通过 `DATABASE_POOL_MAX`（默认 20）统一控制池大小，
 * 避免 100 并发时把 PG 的 max_connections 打满。
 *
 * 规则：URL 中已显式给出的参数不覆盖（便于运维按环境微调）。
 */
export interface PoolParams {
  /** 连接池上限，来自 DATABASE_POOL_MAX */
  poolMax: number;
  /** 等待空闲连接的超时（秒），默认 10 */
  poolTimeoutSec?: number;
  /** 建立 TCP 连接的超时（秒），默认 5 */
  connectTimeoutSec?: number;
}

export function withPoolParams(databaseUrl: string, params: PoolParams): string {
  const url = new URL(databaseUrl);
  const limit = Math.max(1, Math.floor(params.poolMax));
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', String(limit));
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', String(params.poolTimeoutSec ?? 10));
  }
  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', String(params.connectTimeoutSec ?? 5));
  }
  return url.toString();
}
