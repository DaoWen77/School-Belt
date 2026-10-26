import { Global, Injectable, Module } from '@nestjs/common';
import { loadEnv, DEV_AI_CONFIG_SECRET, type AppEnv } from './env';
import { buildCorsPolicy, type CorsPolicy } from './cors';

/**
 * 全局配置服务：把 zod 校验后的环境变量按组暴露，业务代码不直接读 process.env。
 * 使用 useFactory 延迟到 Nest 启动时解析，避免 import 期就抛错（单测可直接引用工具函数）。
 */
@Injectable()
export class AppConfig {
  private cachedCors: CorsPolicy | null = null;

  constructor(private readonly env: AppEnv) {}

  static fromProcess(source: NodeJS.ProcessEnv = process.env): AppConfig {
    return new AppConfig(loadEnv(source));
  }

  get raw(): AppEnv {
    return this.env;
  }

  get nodeEnv(): AppEnv['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  /**
   * CORS 策略（REST 与 Socket.IO 共用同一份）：
   * - exact：精确 origin 列表；
   * - patterns：私网通配（如 http://192.168.1.*:3100）编译出的正则；
   * - allowed(origin)：实际用于 Fastify cors 与 Socket.IO allowRequest。
   * 结果缓存，避免每次请求都重新探测网卡。
   */
  get cors(): CorsPolicy {
    if (!this.cachedCors) {
      this.cachedCors = buildCorsPolicy(this.env.CORS_ORIGINS, {
        autoLan: this.env.LAN_ORIGINS_AUTO,
        ports: [3100, 3000],
        tunnelOrigins: this.env.TUNNEL_ORIGINS,
      });
    }
    return this.cachedCors;
  }

  /** 兼容旧字段：只返回精确 origin（不展开通配） */
  get corsOrigins(): string[] {
    return this.cors.exact;
  }

  get http() {
    return {
      host: this.env.HOST,
      port: this.env.PORT,
      apiPrefix: this.env.API_PREFIX,
      corsOrigins: this.cors.exact,
      cors: this.cors,
      trustProxy: this.env.TRUST_PROXY,
      bodyLimitBytes: Math.floor(this.env.REQUEST_BODY_LIMIT_MB * 1024 * 1024),
      readReceiptWindowMs: this.env.READ_RECEIPT_WINDOW_MS,
      logLevel: this.env.LOG_LEVEL,
    };
  }

  get db() {
    return { url: this.env.DATABASE_URL, poolMax: this.env.DATABASE_POOL_MAX };
  }

  get redis() {
    return {
      url: this.env.REDIS_URL,
      keyPrefix: this.env.REDIS_KEY_PREFIX,
      presenceTtlSec: this.env.PRESENCE_TTL_SEC,
      typingTtlMs: this.env.TYPING_TTL_MS,
    };
  }

  get s3() {
    return {
      endpoint: this.env.S3_ENDPOINT,
      publicEndpoint: this.env.S3_PUBLIC_ENDPOINT ?? this.env.S3_ENDPOINT,
      region: this.env.S3_REGION,
      bucket: this.env.S3_BUCKET,
      accessKeyId: this.env.S3_ACCESS_KEY_ID,
      secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
      presignExpiresSec: this.env.S3_PRESIGN_EXPIRES_SEC,
    };
  }

  get jwt() {
    return {
      accessSecret: this.env.JWT_ACCESS_SECRET,
      refreshSecret: this.env.JWT_REFRESH_SECRET,
      accessTtlSec: this.env.JWT_ACCESS_TTL_SEC,
      refreshTtlSec: this.env.JWT_REFRESH_TTL_SEC,
      issuer: this.env.JWT_ISSUER,
      audience: this.env.JWT_AUDIENCE,
    };
  }

  get push() {
    return {
      enabled: this.env.PUSH_ENABLED,
      vapidPublicKey: this.env.VAPID_PUBLIC_KEY,
      vapidPrivateKey: this.env.VAPID_PRIVATE_KEY,
      vapidSubject: this.env.VAPID_SUBJECT,
      fcmServiceAccountJson: this.env.FCM_SERVICE_ACCOUNT_JSON,
      fcmServerKey: this.env.FCM_SERVER_KEY,
      fcmProjectId: this.env.FCM_PROJECT_ID,
      digestWindowSec: this.env.PUSH_DIGEST_WINDOW_SEC,
    };
  }

  get rtc() {
    return {
      enabled: this.env.RTC_SIGNALING_ENABLED,
      provider: this.env.RTC_PROVIDER,
      tokenTtlSec: this.env.RTC_TOKEN_TTL_SEC,
      livekitUrl: this.env.LIVEKIT_URL,
      livekitApiKey: this.env.LIVEKIT_API_KEY,
      livekitApiSecret: this.env.LIVEKIT_API_SECRET,
    };
  }

  get ai() {
    return {
      configSecret: this.env.AI_CONFIG_SECRET,
      usingDevConfigSecret: this.env.AI_CONFIG_SECRET === DEV_AI_CONFIG_SECRET,
    };
  }
}

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => AppConfig.fromProcess() }],
  exports: [AppConfig],
})
export class AppConfigModule {}
