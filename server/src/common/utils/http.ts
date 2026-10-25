/** 从 Authorization 头提取 Bearer token */
export function extractBearerToken(
  header: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() ?? null;
}

/** 从 socket handshake.auth 中取出 token（契约 §6 连接参数） */
export function extractSocketToken(auth: unknown): string | null {
  if (typeof auth === 'string') return auth.length > 0 ? auth : null;
  if (auth && typeof auth === 'object') {
    const token = (auth as Record<string, unknown>).token;
    if (typeof token === 'string' && token.length > 0) return token;
  }
  return null;
}
