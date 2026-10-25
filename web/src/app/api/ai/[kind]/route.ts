export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeBase(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/**
 * 同源 AI 代理的兜底 API 地址：按浏览器发来的 Host 推导 :3000。
 * 构建期注入的 localhost 在局域网访问时必须被忽略。
 */
function fallbackBase(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || requestUrl.host;
  if (!host) return null;
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || requestUrl.protocol.replace(':', '') || 'http';
  if (protocol !== 'http' && protocol !== 'https') return null;

  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];
  if (!hostname) return null;
  const port = host.startsWith('[')
    ? host.slice(host.indexOf(']') + 1).replace(/^:/, '')
    : host.split(':')[1] ?? '';
  const apiPort = port && port !== '3000' ? '3000' : port;
  return `${protocol}://${hostname}${apiPort ? `:${apiPort}` : ''}`;
}

/**
 * AI SSE 同源代理（仅前端侧兜底）：
 * 后端 AI 控制器使用 reply.hijack 直接写 SSE，跨域时 CORS 头可能缺失；
 * 这里把 POST /api/ai/:kind 同源转发到 API，并原样流回 ReadableStream。
 * 浏览器可传 x-dj-api-base 指定自定义 API（仅 http/https），否则用环境变量。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string }> },
): Promise<Response> {
  const { kind } = await context.params;
  if (!['chat', 'report', 'summarize', 'translate', 'clear'].includes(kind)) {
    return Response.json({ ok: false, error: { code: 'NOT_FOUND', message: '未知 AI 端点' } }, { status: 404 });
  }
  const authorization = request.headers.get('authorization') ?? '';
  const body = await request.text();
  const requestedBase = normalizeBase(request.headers.get('x-dj-api-base'));
  const envBaseRaw = normalizeBase(process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE);
  const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const requestHostname = requestHost.startsWith('[')
    ? requestHost.slice(0, requestHost.indexOf(']') + 1)
    : requestHost.split(':')[0];
  const envBase =
    envBaseRaw && !(isLoopbackHost(new URL(envBaseRaw).hostname) && !isLoopbackHost(requestHostname))
      ? envBaseRaw
      : null;
  const base = requestedBase ?? envBase ?? fallbackBase(request);
  if (!base) {
    return Response.json(
      { ok: false, error: { code: 'AI_PROXY_FAILED', message: '无法推导 API 地址' } },
      { status: 502 },
    );
  }
  try {
    const upstream = await fetch(`${base}/api/v1/ai/${kind}`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body,
      signal: request.signal,
    });
    const headers = new Headers();
    for (const name of ['content-type', 'cache-control', 'x-accel-buffering', 'connection']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return Response.json(
      { ok: false, error: { code: 'AI_PROXY_FAILED', message: error instanceof Error ? error.message : 'AI 代理失败' } },
      { status: 502 },
    );
  }
}
