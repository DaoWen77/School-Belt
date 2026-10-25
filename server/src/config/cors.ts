import { networkInterfaces } from 'node:os';

/**
 * HTTP / Socket.IO 共用的 CORS 策略（局域网可访问）。
 *
 * 支持三种条目：
 *   1. 精确 origin：`http://localhost:3100`、`https://dijiang.example.com`
 *   2. 私网通配：`http://192.168.1.*:3100`、`http://192.168.*:*`、`http://10.*:3000`
 *   3. `.local` 通配：`http://*.local:3100`（mDNS 主机名）
 *
 * 安全约束：
 *   - 禁止裸 `*`（包括 `http://*`、`http://*:*`）；
 *   - 通配 host 只允许私网段（10.* / 192.168.* / 172.16-31.*）或 `*.local`；
 *   - 通配 host 的网段部分必须是具体值（`192.168.*.*` 可以，`*.*.*.*` / `192.*.*.*` 不行）。
 *
 * `LAN_ORIGINS_AUTO=true` 时，若显式列表里没有私网地址，会自动探测本机 IPv4 私网地址，
 * 追加 `http://<ip>:3100` 与 `http://<ip>:3000`，换 WiFi/IP 后无需改配置。
 */

export interface CorsPolicy {
  /** 精确 origin（已归一化：小写 host、无尾部斜杠） */
  exact: string[];
  /** 通配 origin 编译出的正则 */
  patterns: RegExp[];
  /** 自动探测到的局域网 origin（用于启动日志） */
  lanOrigins: string[];
  /** 判定一个浏览器 Origin 是否放行；无 Origin（服务端/原生客户端）一律放行 */
  allowed: (origin?: string | null) => boolean;
}

export interface CorsPolicyOptions {
  /** 是否自动追加本机私网 IPv4 origin（env LAN_ORIGINS_AUTO） */
  autoLan?: boolean;
  /** 自动追加时使用的端口，默认 [3100, 3000] */
  ports?: readonly number[];
}

const ORIGIN_ENTRY = /^(https?):\/\/([^/:?#\s]+)(?::(\d{1,5}|\*))?$/;

const OCTET = '(?:\\d{1,3})';

/** 判断完整 IPv4 是否私网地址（10/8、172.16-31、192.168/16） */
export function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** 探测本机 IPv4 私网地址（排除回环与链路本地 169.254） */
export function detectLanIps(): string[] {
  const found = new Set<string>();
  const interfaces = networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      if (isPrivateIpv4(address.address)) found.add(address.address);
    }
  }
  return [...found];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 校验通配 host 是否被允许，并返回编译后的 host 正则片段 */
function compileWildcardHost(host: string): string {
  if (host === '*') {
    throw new Error('CORS_ORIGINS 禁止裸通配 "*"，请写具体私网段（如 http://192.168.1.*:3100）');
  }

  if (host.startsWith('*.')) {
    const suffix = host.slice(1); // ".local"
    if (!suffix.endsWith('.local')) {
      throw new Error(`CORS_ORIGINS 通配 host 只允许 *.local：${host}`);
    }
    return `[a-z0-9-]+${escapeRegex(suffix)}`;
  }

  const octets = host.split('.');
  if (octets.length !== 4 || octets.some((octet) => octet !== '*' && !/^\d{1,3}$/.test(octet))) {
    throw new Error(`CORS_ORIGINS 通配 host 必须是 IPv4 形式（如 192.168.1.*）：${host}`);
  }
  const [a, b] = octets as [string, string, string, string];
  // 网段部分必须具体：10.* / 192.168.* / 172.16-31.*，否则会匹配到公网
  const allowedPrefix =
    a === '10' ||
    (a === '192' && b === '168') ||
    (a === '172' && /^\d{1,3}$/.test(b) && Number(b) >= 16 && Number(b) <= 31);
  if (!allowedPrefix) {
    throw new Error(
      `CORS_ORIGINS 通配 host 只允许私网段（10.* / 192.168.* / 172.16-31.*）：${host}`,
    );
  }

  return octets
    .map((octet) => (octet === '*' ? OCTET : escapeRegex(octet)))
    .join('\\.');
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

function parseEntry(rawEntry: string): { exact?: string; pattern?: RegExp } {
  const entry = rawEntry.trim();
  if (!entry) return {};
  const match = ORIGIN_ENTRY.exec(entry);
  if (!match) {
    throw new Error(
      `CORS_ORIGINS 非法条目 "${entry}"：只接受 scheme://host[:port]，不要带路径或查询串`,
    );
  }
  const scheme = (match[1] ?? 'http').toLowerCase();
  const host = (match[2] ?? '').toLowerCase();
  const port = match[3] ?? '';
  const hasWildcard = host.includes('*') || port === '*';

  if (!hasWildcard) {
    return { exact: `${scheme}://${host}${port ? `:${port}` : ''}` };
  }

  if (port === '*' && host.includes('*') === false) {
    // 精确 host + 通配端口：只允许本机/私网 host
    const allowedHost =
      host === 'localhost' || host === '127.0.0.1' || isPrivateIpv4(host);
    if (!allowedHost) {
      throw new Error(`CORS_ORIGINS 端口通配只允许 localhost 或私网 IP：${entry}`);
    }
  }

  const hostPattern = host.includes('*') ? compileWildcardHost(host) : escapeRegex(host);
  const portPattern = port === '*' ? '\\d{1,5}' : escapeRegex(port);
  const pattern = new RegExp(
    `^${scheme}://${hostPattern}${portPattern ? `:${portPattern}` : ''}$`,
    'i',
  );
  return { pattern };
}

export function buildCorsPolicy(rawOrigins: string, options: CorsPolicyOptions = {}): CorsPolicy {
  const exact = new Set<string>();
  const patterns: RegExp[] = [];

  for (const entry of (rawOrigins ?? '').split(',')) {
    const parsed = parseEntry(entry);
    if (parsed.exact) exact.add(parsed.exact);
    if (parsed.pattern) patterns.push(parsed.pattern);
  }

  // 显式配置里是否已经包含私网地址（决定要不要自动探测）
  const hasExplicitLan = [...exact].some((origin) => {
    try {
      return isPrivateIpv4(new URL(origin).hostname);
    } catch {
      return false;
    }
  });

  const lanOrigins: string[] = [];
  if (options.autoLan !== false && !hasExplicitLan) {
    const ports = options.ports ?? [3100, 3000];
    for (const ip of detectLanIps()) {
      for (const port of ports) {
        const origin = `http://${ip}:${port}`;
        exact.add(origin);
        lanOrigins.push(origin);
      }
    }
  }

  const exactList = [...exact];
  const allowed = (origin?: string | null): boolean => {
    if (!origin) return true; // Node 客户端 / 同源请求没有 Origin
    const normalized = normalizeOrigin(origin);
    if (normalized === 'null') return false;
    if (exact.has(normalized)) return true;
    return patterns.some((pattern) => pattern.test(normalized));
  };

  return { exact: exactList, patterns, lanOrigins, allowed };
}

/** 供启动日志展示（RegExp → 字符串） */
export function describeCorsPolicy(policy: CorsPolicy): {
  exact: string[];
  patterns: string[];
  lanOrigins: string[];
} {
  return {
    exact: policy.exact,
    patterns: policy.patterns.map((pattern) => pattern.source),
    lanOrigins: policy.lanOrigins,
  };
}
