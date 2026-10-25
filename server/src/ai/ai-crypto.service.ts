import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { AppConfig } from '../config/config.module';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * AI 配置加密（AES-256-GCM）。
 *
 * - 密钥由 `AI_CONFIG_SECRET` 经 SHA-256 派生 32 字节；
 * - 密文格式：`v1:<ivB64>:<tagB64>:<cipherB64>`（iv 12 字节，tag 16 字节）；
 * - 解密失败（密钥不匹配 / 密文被篡改 / 格式错误）抛内部错误，**错误信息不含明文或密钥**。
 */
@Injectable()
export class AiCryptoService {
  private readonly key: Buffer;

  constructor(config: AppConfig) {
    this.key = createHash('sha256').update(config.ai.configSecret, 'utf8').digest();
  }

  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '待加密的 API Key 不能为空');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = typeof payload === 'string' ? payload.split(':') : [];
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new AppError(ErrorCode.INTERNAL, 'AI 配置解密失败：密文格式不正确');
    }
    try {
      const iv = Buffer.from(parts[1] ?? '', 'base64');
      const tag = Buffer.from(parts[2] ?? '', 'base64');
      const encrypted = Buffer.from(parts[3] ?? '', 'base64');
      if (iv.length !== 12 || tag.length !== 16) {
        throw new Error('invalid iv/tag length');
      }
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      // 不把原始密文/密钥带进错误信息
      throw new AppError(ErrorCode.INTERNAL, 'AI 配置解密失败（密钥不匹配或密文被篡改）');
    }
  }

  /** 供 GET /ai/config 使用：只暴露末 4 位，绝不返回明文 */
  mask(plaintext: string): string {
    return plaintext.length <= 4 ? '****' : `****${plaintext.slice(-4)}`;
  }
}
