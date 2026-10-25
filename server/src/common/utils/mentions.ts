/**
 * 提及解析：契约 §2.8 messages.mentions 为 uuid[]，
 * 客户端只提交正文，服务端从正文中解析 @handle 再映射为用户 id。
 * handle 规则见契约 §2.1：3–24 位，`^[a-z0-9_]+$`。
 */

const MENTION_PATTERN = /@([a-z0-9_]{3,24})\b/g;

/** 按出现顺序去重提取 handle（小写） */
export function extractMentionHandles(body: string | null | undefined): string[] {
  if (!body) return [];
  const found = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const handle = match[1];
    if (handle) found.add(handle.toLowerCase());
  }
  return [...found];
}

/** 把 handle 列表映射为已存在的用户 id（保持顺序、去重） */
export function resolveMentionIds(
  handles: readonly string[],
  users: readonly { id: string; handle: string }[],
): string[] {
  const byHandle = new Map(users.map((u) => [u.handle.toLowerCase(), u.id]));
  const ids: string[] = [];
  for (const handle of handles) {
    const id = byHandle.get(handle.toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** 轻量 Markdown 限制：仅允许少量标注，禁止 HTML 标签注入（前端统一按纯文本渲染） */
export function sanitizeBody(body: string): string {
  return body.replace(/<\/?[a-z][^>]*>/gi, '');
}
