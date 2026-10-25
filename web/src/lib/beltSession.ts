/**
 * 环带会话存储：与内部 `dj.access/dj.refresh` 完全分离。
 * 同一个浏览器可以同时持有帝江号内部会话与文明环带会话。
 */
const ACCESS_KEY = 'dj.belt.access';
const REFRESH_KEY = 'dj.belt.refresh';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let loaded = false;

function safeGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式：内存态仍然工作 */
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  accessToken = safeGet(ACCESS_KEY);
  refreshToken = safeGet(REFRESH_KEY);
}

export const beltSession = {
  hasTokens(): boolean {
    load();
    return Boolean(accessToken || refreshToken);
  },
  getAccess(): string | null {
    load();
    return accessToken;
  },
  getRefresh(): string | null {
    load();
    return refreshToken;
  },
  setTokens(access: string, refresh: string): void {
    loaded = true;
    accessToken = access;
    refreshToken = refresh;
    safeSet(ACCESS_KEY, access);
    safeSet(REFRESH_KEY, refresh);
  },
  clear(): void {
    loaded = true;
    accessToken = null;
    refreshToken = null;
    safeSet(ACCESS_KEY, null);
    safeSet(REFRESH_KEY, null);
  },
};
