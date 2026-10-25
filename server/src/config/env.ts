import { z } from 'zod';

/**
 * 环境变量契约（与 docs/15-环境变量.md 一一对应）。
 * 启动时一次性解析并校验，缺失必填项直接快速失败（fail fast），不把错误留到第一个请求。
 */

const booleanish = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      if (typeof value === 'boolean') return value;
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const urlString = (label: string) =>
  z.string().refine(
    (value) => {
      try {
        // 允许 postgresql:// redis:// http:// 等非 HTTP 协议
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: `${label} 必须是合法的连接串` },
  );

/** AI 配置加密的开发默认密钥（≥32 字符）；生产必须用 AI_CONFIG_SECRET 覆盖 */
export const DEV_AI_CONFIG_SECRET = 'dev-ai-config-secret-请勿用于生产-0123456789';

export const envSchema = z.object({
  // ── API ──────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:3100,http://localhost:3000,http://127.0.0.1:3100,http://127.0.0.1:3000',
    ),
  /**
   * 局域网 origin 自动探测：CORS_ORIGINS 未显式给出私网地址时，
   * 自动追加 http://<本机私网IP>:3100 与 :3000（换 WiFi/IP 后无需改配置）。
   */
  LAN_ORIGINS_AUTO: booleanish(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: booleanish(false),
  REQUEST_BODY_LIMIT_MB: z.coerce.number().positive().default(2),
  READ_RECEIPT_WINDOW_MS: z.coerce.number().int().nonnegative().default(300),

  // ── DB ───────────────────────────────────────────────────────────────
  DATABASE_URL: urlString('DATABASE_URL'),
  /** 连接池上限：注入 Prisma URL 的 connection_limit（默认 20） */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),

  // ── Redis（必填，无内存降级）────────────────────────────────────────
  REDIS_URL: urlString('REDIS_URL'),
  REDIS_KEY_PREFIX: z.string().default('dijiang:'),
  PRESENCE_TTL_SEC: z.coerce.number().int().positive().default(90),
  TYPING_TTL_MS: z.coerce.number().int().positive().default(3000),

  // ── S3（S3 兼容服务；本机为 rclone serve s3，非 MinIO）────────────────
  S3_ENDPOINT: urlString('S3_ENDPOINT').default('http://localhost:9000'),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('dijiang'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: booleanish(true),
  S3_PRESIGN_EXPIRES_SEC: z.coerce.number().int().positive().max(604800).default(900),

  // ── JWT ──────────────────────────────────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-please-change-0001'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-please-change-01'),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(2_592_000),
  JWT_ISSUER: z.string().default('dijiang'),
  JWT_AUDIENCE: z.string().default('dijiang-web'),

  // ── Push（预留，Web Push / FCM）──────────────────────────────────────
  PUSH_ENABLED: booleanish(false),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@dijiang.local'),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FCM_SERVER_KEY: z.string().optional(),
  FCM_PROJECT_ID: z.string().optional(),
  PUSH_DIGEST_WINDOW_SEC: z.coerce.number().int().positive().default(300),

  // ── RTC（契约 §11 预留，恒不实现）────────────────────────────────────
  RTC_SIGNALING_ENABLED: booleanish(false),
  RTC_PROVIDER: z.string().default('none'),
  RTC_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(600),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),

  // ── AI（Sprint3）─────────────────────────────────────────────────────
  // AES-256-GCM 密钥：≥32 字符；API Key 只以密文存 DB，明文永不回传/落日志
  AI_CONFIG_SECRET: z.string().min(32).default(DEV_AI_CONFIG_SECRET),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`环境变量校验失败：\n${details}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.JWT_ACCESS_SECRET.startsWith('dev-') || env.JWT_REFRESH_SECRET.startsWith('dev-')) {
      throw new Error('生产环境禁止使用默认 JWT 密钥');
    }
    if (env.RTC_SIGNALING_ENABLED) {
      // 契约 §11：RTC 为预留能力，v1.0 不允许打开
      throw new Error('RTC_SIGNALING_ENABLED 在 v1.0 必须为 false（契约 §11）');
    }
  }
  return env;
}
