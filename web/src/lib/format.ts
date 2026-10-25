/** 展示层格式化：时间统一按本地时区，数字不进 Number（BIGINT id 只做字符串比较） */

export function initialOf(name: string | null | undefined): string {
  const text = (name ?? '').trim();
  if (!text) return '·';
  return Array.from(text)[0] ?? '·';
}

export function timeOf(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function dayOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

export function messageStamp(iso: string | null | undefined): string {
  const day = dayOf(iso);
  return day ? `${day} ${timeOf(iso)}` : '--';
}

/** BIGINT 十进制字符串的大小比较（不转 Number，避免 >2^53 精度丢失） */
export function compareSeq(a: string | null | undefined, b: string | null | undefined): number {
  const left = (a ?? '0').replace(/^0+(?=\d)/, '');
  const right = (b ?? '0').replace(/^0+(?=\d)/, '');
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function maxSeq(a: string | null | undefined, b: string | null | undefined): string {
  return compareSeq(a, b) >= 0 ? (a ?? '0') : (b ?? '0');
}

/** 纯数字 id 的消息按 seq 排；本地 optimistic 消息排在最后（id 以 local: 开头） */
export function sortMessages<T extends { id: string; createdAt: string }>(messages: T[]): T[] {
  return [...messages].sort((left, right) => {
    const localLeft = left.id.startsWith('local:');
    const localRight = right.id.startsWith('local:');
    if (localLeft !== localRight) return localLeft ? 1 : -1;
    if (localLeft && localRight) return left.createdAt.localeCompare(right.createdAt);
    return compareSeq(left.id, right.id);
  });
}

export function parseMentions(body: string): Array<{ text: string; mention: boolean }> {
  const parts: Array<{ text: string; mention: boolean }> = [];
  const pattern = /(@[A-Za-z0-9_\u4e00-\u9fa5]{1,32})/g;
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: body.slice(last, index), mention: false });
    parts.push({ text: match[1], mention: true });
    last = index + match[1].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false });
  return parts.length ? parts : [{ text: body, mention: false }];
}

export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'owner':
      return '建立者';
    case 'admin':
      return '协议官';
    case 'moderator':
      return '档案员';
    case 'member':
      return '成员';
    default:
      return role ?? '—';
  }
}

export function kindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case 'channel':
      return '社区频道';
    case 'dm':
      return '私聊';
    case 'group':
      return '群聊';
    default:
      return kind ?? '会话';
  }
}
