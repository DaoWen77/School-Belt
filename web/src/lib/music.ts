import type { MusicCardData } from '@/lib/types';

export function parseMusicUrl(raw: string): MusicCardData | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (/(^|\.)music\.163\.com$/i.test(url.hostname)) {
      const match = /[?&#]id=(\d+)/.exec(url.href) ?? /song\/(\d+)/.exec(url.pathname);
      if (match?.[1]) return { url: value, provider: 'netease', songId: match[1] };
      return { url: value, provider: 'link' };
    }
    if (/(^|\.)y\.qq\.com$/i.test(url.hostname)) {
      const match = /songmid[=/]([A-Za-z0-9]+)/.exec(url.href) ?? /songDetail\/([A-Za-z0-9]+)/.exec(url.pathname);
      return { url: value, provider: 'qq', songId: match?.[1] ?? null };
    }
    if (/\.(mp3|wav|ogg|m4a|aac)(\?|#|$)/i.test(url.pathname + url.search)) {
      return { url: value, provider: 'audio' };
    }
    return { url: value, provider: 'link' };
  } catch {
    return null;
  }
}

export function neteasePlayerUrl(songId: string): string {
  return `//music.163.com/outchain/player?type=2&id=${encodeURIComponent(songId)}&auto=0&height=66`;
}
