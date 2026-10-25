import { describe, expect, it } from 'vitest';
import { RedisService } from '../src/common/redis/redis.service';
import { loadEnv } from '../src/config/env';
import { withPoolParams } from '../src/config/db';
import type { AppConfig } from '../src/config/config.module';

function redisConfig(url: string): AppConfig {
  return {
    redis: { url, keyPrefix: 'test:', presenceTtlSec: 90, typingTtlMs: 3000 },
  } as unknown as AppConfig;
}

describe('Redis 必填且启动 fail-fast（无内存降级）', () => {
  it('缺少 REDIS_URL 时环境校验直接失败', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/dijiang' } as NodeJS.ProcessEnv),
    ).toThrow(/REDIS_URL/);
  });

  it('REDIS_URL 不可达时 onModuleInit 抛错（不降级、不吞错）', async () => {
    const service = new RedisService(redisConfig('redis://127.0.0.1:1'));
    await expect(service.onModuleInit()).rejects.toThrow(/Redis 连接失败/);
    // 失败后仍可安全销毁，不留下悬挂连接
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('RedisService 不再暴露内存降级开关', () => {
    const service = new RedisService(redisConfig('redis://127.0.0.1:6379'));
    expect('degraded' in service).toBe(false);
    expect('enabled' in service).toBe(false);
  });
});

describe('PG 连接池参数注入', () => {
  it('按 DATABASE_POOL_MAX 注入 connection_limit / pool_timeout / connect_timeout', () => {
    const url = withPoolParams('postgresql://u:p@127.0.0.1:5432/dijiang', { poolMax: 20 });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('connection_limit')).toBe('20');
    expect(parsed.searchParams.get('pool_timeout')).toBe('10');
    expect(parsed.searchParams.get('connect_timeout')).toBe('5');
  });

  it('URL 已显式给出参数时不覆盖（便于按环境微调）', () => {
    const url = withPoolParams(
      'postgresql://u:p@127.0.0.1:5432/dijiang?connection_limit=7&pool_timeout=3',
      { poolMax: 20 },
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('connection_limit')).toBe('7');
    expect(parsed.searchParams.get('pool_timeout')).toBe('3');
    expect(parsed.searchParams.get('connect_timeout')).toBe('5');
  });
});
