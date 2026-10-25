import { Injectable } from '@nestjs/common';
import { hash, verify, argon2id } from 'argon2';

/**
 * 契约 §2.1：password_hash 使用 argon2id。
 * 参数取 OWASP 推荐的最小配置（19 MiB / 2 轮 / 1 并行度），在 50 人规模下足够。
 */
@Injectable()
export class PasswordService {
  private readonly options = {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  async hash(plain: string): Promise<string> {
    return hash(plain, this.options);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      // verify 不接受 type：参数从摘要自身解析，只允许 secret / associatedData
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  }
}
