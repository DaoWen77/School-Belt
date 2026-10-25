import { Global, Module } from '@nestjs/common';
import { RedisModule } from './redis.service';
import { RateLimiterService } from './rate-limiter.service';

/**
 * 限流模块（全局）。
 * 单独成模块是为了避免 redis.service ↔ rate-limiter.service 的循环导入：
 * RedisService 不该反向依赖使用它的组件。
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class RateLimiterModule {}
