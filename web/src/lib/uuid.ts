/**
 * 生成 UUID v4。
 *
 * 为什么不用 `crypto.randomUUID()`：它只在 **安全上下文**（HTTPS 或 localhost）可用。
 * 局域网里用 `http://192.168.x.x:3100` 打开时属于非安全上下文，`crypto.randomUUID` 是 undefined，
 * 之前发送消息/上传在调用处直接抛异常，表现就是“点了发送但什么都没发生”。
 *
 * `crypto.getRandomValues` 在非安全上下文仍可用；极端环境（老浏览器）再退回 Math.random。
 */
export function randomUuid(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 version 4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
