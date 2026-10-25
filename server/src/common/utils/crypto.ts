import { createHash, randomBytes } from 'node:crypto';

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 32 字节随机 token 的 base64url 形式（refresh token / 签名 nonce） */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Crockford Base32（去除易混淆的 I/L/O/U） */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 邀请码：`DJ-XXXX-XXXX`，共 8 位随机字符。
 * 明文只返回一次，库里只存 sha256(大写明文)（契约 §5）。
 */
export function generateInviteCode(groups = 2, groupSize = 4): string {
  const bytes = randomBytes(groups * groupSize);
  let out = 'DJ-';
  for (let g = 0; g < groups; g += 1) {
    if (g > 0) out += '-';
    for (let i = 0; i < groupSize; i += 1) {
      const byte = bytes[g * groupSize + i] ?? 0;
      out += ALPHABET[byte % ALPHABET.length] ?? '0';
    }
  }
  return out;
}

/** 契约 §5：code_hash = sha256(大写邀请码) */
export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

export function hashInviteCode(code: string): string {
  return sha256Hex(normalizeInviteCode(code));
}

/** 管理台识别用前缀：前 4 位（不含 `DJ-`） */
export function inviteCodePrefix(code: string): string {
  const normalized = normalizeInviteCode(code);
  return normalized.replace(/^DJ-/, '').slice(0, 4);
}
