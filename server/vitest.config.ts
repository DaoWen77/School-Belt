import { defineConfig } from 'vitest/config';

/**
 * 单元测试只覆盖纯逻辑：不连接 PG / Redis / S3。
 * 被测对象全部来自 src/common、src/messages 等目录中可注入 fake 的纯函数与小服务。
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    reporters: 'default',
    testTimeout: 10_000,
  },
});
