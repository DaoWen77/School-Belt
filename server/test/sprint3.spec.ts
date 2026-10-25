import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AiCryptoService } from '../src/ai/ai-crypto.service';
import { AiConfigService } from '../src/ai/ai-config.service';
import { AiChatService, type AiStreamSink } from '../src/ai/ai-chat.service';
import { AiController } from '../src/ai/ai.controller';
import { BOT_MESSAGE_PREFIX, BOT_USER_ID } from '../src/ai/bot.constants';
import { ROLES_KEY } from '../src/common/decorators';
import type { AppConfig } from '../src/config/config.module';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { ChannelAccessService } from '../src/common/guards/channel-access.service';
import type { RealtimeService } from '../src/common/realtime/realtime.service';
import type { AuthUser } from '../src/common/types/context';

const SECRET = 'test-ai-config-secret-0123456789abcdef';
const API_KEY = 'sk-test-sprint3-SECRET-1234';
const CHANNEL_ID = '77777777-7777-4777-8777-777777777777';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-24T04:00:00.000Z');

const configStub = {
  ai: { configSecret: SECRET, usingDevConfigSecret: false },
} as unknown as AppConfig;

function cryptoService(): AiCryptoService {
  return new AiCryptoService(configStub);
}

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: OWNER_ID,
    handle: 'owner',
    displayName: '协议官',
    globalRole: 'owner',
    status: 'active',
    sessionId: 's1',
    mutedUntil: null,
    avatarFileId: null,
    statusPrefix: null,
    ...overrides,
  };
}

// ── 本地 mock OpenAI（127.0.0.1:4010/v1，仅测试用）──────────────────────────
let mockServer: http.Server;
let lastChatBody: { model?: string; messages?: Array<{ role: string; content: string }>; stream?: boolean } | null = null;

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const ok = req.headers.authorization === `Bearer ${API_KEY}`;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ok ? { object: 'list', data: [{ id: 'mock-gpt' }] } : { error: { message: 'bad key' } }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        lastChatBody = JSON.parse(raw) as typeof lastChatBody;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const text = '协议官汇报：态势平稳，建议按计划推进。';
        for (const piece of text.match(/[\s\S]{1,6}/g) ?? []) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => mockServer.listen(4010, '127.0.0.1', () => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

function fakePrismaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'default',
    baseUrl: 'http://127.0.0.1:4010/v1',
    model: 'mock-gpt',
    apiKeyEncrypted: cryptoService().encrypt(API_KEY),
    updatedBy: OWNER_ID,
    updatedAt: NOW,
    ...overrides,
  };
}

function configService(prisma: unknown): AiConfigService {
  return new AiConfigService(prisma as PrismaService, cryptoService());
}

describe('AES-256-GCM 配置加密', () => {
  it('加密/解密往返，密文格式 v1:iv:tag:cipher，且不含明文', () => {
    const crypto = cryptoService();
    const encrypted = crypto.encrypt(API_KEY);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(encrypted.split(':')).toHaveLength(4);
    expect(encrypted).not.toContain(API_KEY);
    expect(crypto.decrypt(encrypted)).toBe(API_KEY);
    expect(crypto.mask(API_KEY)).toBe(`****${API_KEY.slice(-4)}`);
  });

  it('篡改密文 / 篡改 tag / 换密钥都会失败（且错误不含明文）', () => {
    const crypto = cryptoService();
    const encrypted = crypto.encrypt(API_KEY);
    const [version, iv, tag, cipher] = encrypted.split(':');
    const flip = (value: string): string =>
      `${value.slice(0, -2)}${value.endsWith('AA') ? 'BB' : 'AA'}`;

    expect(() => crypto.decrypt([version, iv, tag, flip(cipher)].join(':'))).toThrow(/解密失败/);
    expect(() => crypto.decrypt([version, iv, flip(tag), cipher].join(':'))).toThrow(/解密失败/);
    const other = new AiCryptoService({ ai: { configSecret: 'x'.repeat(48), usingDevConfigSecret: false } } as unknown as AppConfig);
    expect(() => other.decrypt(encrypted)).toThrow(/解密失败/);
    try {
      crypto.decrypt('v1:bad');
    } catch (error) {
      expect((error as Error).message).not.toContain(API_KEY);
    }
  });
});

describe('AI 配置：admin 权限 + key 永不回传', () => {
  it('普通成员访问配置接口 → FORBIDDEN（服务层兜底）', async () => {
    const prisma = { aiSetting: { findUnique: vi.fn(async () => fakePrismaRow()) } };
    await expect(configService(prisma).adminGet(authUser({ globalRole: 'member' }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('GET 配置只返回 keyMasked，响应 JSON 不含明文 key', async () => {
    const prisma = { aiSetting: { findUnique: vi.fn(async () => fakePrismaRow()) } };
    const view = await configService(prisma).adminGet(authUser());
    expect(view.configured).toBe(true);
    expect(view.keyMasked).toBe(`****${API_KEY.slice(-4)}`);
    expect(JSON.stringify(view)).not.toContain(API_KEY);
    expect(view).not.toHaveProperty('apiKey');
    expect(view).not.toHaveProperty('apiKeyEncrypted');
  });

  it('PUT 带 apiKey：落库为 v1 密文，返回值不含 key；省略 apiKey 时保留旧密文', async () => {
    const upsert = vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
      ...fakePrismaRow(),
      ...args.create,
    }));
    const prisma = { aiSetting: { findUnique: vi.fn(async () => null), upsert } };
    const service = configService(prisma);

    const created = await service.adminPut(authUser(), {
      baseUrl: 'http://127.0.0.1:4010/v1',
      model: 'mock-gpt',
      apiKey: API_KEY,
    });
    const createData = upsert.mock.calls[0]?.[0].create as { apiKeyEncrypted: string };
    expect(createData.apiKeyEncrypted.startsWith('v1:')).toBe(true);
    expect(cryptoService().decrypt(createData.apiKeyEncrypted)).toBe(API_KEY);
    expect(JSON.stringify(created)).not.toContain(API_KEY);

    const oldEncrypted = cryptoService().encrypt('sk-old-key-9999');
    const upsert2 = vi.fn(async (args: { create: Record<string, unknown> }) => ({ ...fakePrismaRow({ apiKeyEncrypted: oldEncrypted }), ...args.create }));
    const prisma2 = { aiSetting: { findUnique: vi.fn(async () => fakePrismaRow({ apiKeyEncrypted: oldEncrypted })), upsert: upsert2 } };
    await configService(prisma2).adminPut(authUser(), { baseUrl: 'http://127.0.0.1:4010/v1', model: 'm2' });
    const sent = upsert2.mock.calls[0]?.[0].create as { apiKeyEncrypted: string; baseUrl: string; model: string };
    expect(sent.apiKeyEncrypted).toBe(oldEncrypted);
    expect(sent.model).toBe('m2');
  });

  it('POST /ai/test 调 mock /models：成功 200；错误 key 401 且错误里没有 key', async () => {
    const ok = configService({ aiSetting: { findUnique: vi.fn(async () => fakePrismaRow()) } });
    const okResult = await ok.adminTest(authUser());
    expect(okResult).toMatchObject({ ok: true, status: 200 });
    expect(okResult.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(okResult)).not.toContain(API_KEY);

    const bad = configService({
      aiSetting: {
        findUnique: vi.fn(async () => fakePrismaRow({ apiKeyEncrypted: cryptoService().encrypt('sk-wrong-0000') })),
      },
    });
    const badResult = await bad.adminTest(authUser());
    expect(badResult.ok).toBe(false);
    expect(badResult.status).toBe(401);
    expect(JSON.stringify(badResult)).not.toContain('sk-wrong-0000');
  });

  it('未配置时 GET/PUT 视图 configured=false，test 返回明确错误', async () => {
    const prisma = { aiSetting: { findUnique: vi.fn(async () => null), upsert: vi.fn() } };
    const service = configService(prisma);
    const view = await service.adminGet(authUser());
    expect(view).toMatchObject({ configured: false, keyMasked: null });
    const tested = await service.adminTest(authUser());
    expect(tested.ok).toBe(false);
    expect(tested.error).toContain('AI 未配置');
  });

  it('控制器用 @Roles(owner,admin) 标记管理接口', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AiController.prototype.getConfig) as string[];
    expect(roles).toEqual(['owner', 'admin']);
    expect(Reflect.getMetadata(ROLES_KEY, AiController.prototype.putConfig)).toEqual(['owner', 'admin']);
    expect(Reflect.getMetadata(ROLES_KEY, AiController.prototype.test)).toEqual(['owner', 'admin']);
  });
});

// ── SSE 链路 ─────────────────────────────────────────────────────────────
function botMessageRow(data: Record<string, unknown>) {
  return {
    id: 9001n,
    channelId: CHANNEL_ID,
    senderId: BOT_USER_ID,
    kind: 'text',
    body: String(data.body ?? ''),
    clientMsgId: String(data.clientMsgId ?? ''),
    parentId: null,
    threadRootId: null,
    replyToId: null,
    cardId: null,
    mentions: [],
    threadReplyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date('2026-10-24T04:00:01.000Z'),
  };
}

function chatService() {
  const tx = {
    message: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => botMessageRow(data)) },
    channel: { update: vi.fn(async () => ({ id: CHANNEL_ID })) },
  };
  const prisma = {
    message: {
      findMany: vi.fn(async () => [
        { senderId: 'user-1', body: '昨天的排查结论' },
        { senderId: BOT_USER_ID, body: '[DIJIANG/OS] 已记录' },
      ]),
      count: vi.fn(async () => 3),
      groupBy: vi.fn(async () => [{ senderId: 'user-1' }, { senderId: 'user-2' }]),
    },
    card: { findMany: vi.fn(async () => [{ taskStatus: 'done' }, { taskStatus: 'todo' }]) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const channelAccess = { assert: vi.fn(async () => ({ channel: { name: '素材工坊' } })) };
  const realtime = { emitToChannel: vi.fn() };
  const config = {
    runtimeSettings: vi.fn(async () => ({
      baseUrl: 'http://127.0.0.1:4010/v1',
      model: 'mock-gpt',
      apiKey: API_KEY,
    })),
  };
  const service = new AiChatService(
    prisma as unknown as PrismaService,
    channelAccess as unknown as ChannelAccessService,
    realtime as unknown as RealtimeService,
    config as unknown as AiConfigService,
  );
  return { service, tx, prisma, channelAccess, realtime, config };
}

function collectEvents(): { sink: AiStreamSink; events: Array<{ name: string; data: unknown }> } {
  const events: Array<{ name: string; data: unknown }> = [];
  return { sink: { event: (name, data) => events.push({ name, data }) }, events };
}

describe('POST /ai/chat（SSE）', () => {
  it('流式 delta → 落库 bot 消息（事务更新 last_message_at）→ done，且广播 message:new', async () => {
    const { service, tx, prisma, channelAccess, realtime } = chatService();
    const { sink, events } = collectEvents();

    await service.streamChat(
      authUser(),
      { channelId: CHANNEL_ID, body: '今天先做什么' },
      sink,
      new AbortController().signal,
    );

    expect(channelAccess.assert).toHaveBeenCalledWith(CHANNEL_ID, expect.anything(), 'read');
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: CHANNEL_ID, deletedAt: null },
        take: 20,
      }),
    );
    const deltas = events.filter((item) => item.name === 'delta');
    expect(deltas.length).toBeGreaterThan(0);
    expect(JSON.stringify(deltas)).toContain('协议官汇报');
    const done = events.find((item) => item.name === 'done')?.data as { messageId: string; seq: string };
    expect(done).toMatchObject({ messageId: '9001', seq: '9001' });

    const created = tx.message.create.mock.calls[0]?.[0] as { data: { senderId: string; body: string; kind: string } };
    expect(created.data.senderId).toBe(BOT_USER_ID);
    expect(created.data.kind).toBe('text');
    expect(created.data.body.startsWith(BOT_MESSAGE_PREFIX)).toBe(true);
    expect(created.data.body).toContain('协议官汇报');
    expect(tx.channel.update).toHaveBeenCalledWith({
      where: { id: CHANNEL_ID },
      data: { lastMessageAt: expect.any(Date) },
    });
    expect(realtime.emitToChannel).toHaveBeenCalledWith(
      CHANNEL_ID,
      'message:new',
      expect.objectContaining({ message: expect.objectContaining({ id: '9001' }) }),
    );
    expect(JSON.stringify(events)).not.toContain(API_KEY);
  });

  it('客户端已断开（signal aborted）时不落库、不发 done', async () => {
    const { service, tx } = chatService();
    const { sink, events } = collectEvents();
    const controller = new AbortController();
    controller.abort();

    await service.streamChat(authUser(), { channelId: CHANNEL_ID, body: '在吗' }, sink, controller.signal);

    expect(tx.message.create).not.toHaveBeenCalled();
    expect(events.some((item) => item.name === 'done')).toBe(false);
  });
});

describe('POST /ai/report（SSE + 7 天统计）', () => {
  it('统计条件正确、prompt 走协议官叙事、落库 bot 消息', async () => {
    const { service, prisma, tx, realtime } = chatService();
    const { sink, events } = collectEvents();

    await service.streamReport(
      authUser(),
      { channelId: CHANNEL_ID },
      sink,
      new AbortController().signal,
    );

    const countArgs = prisma.message.count.mock.calls[0]?.[0] as {
      where: { channelId: string; deletedAt: null; createdAt: { gte: Date } };
    };
    expect(countArgs.where.channelId).toBe(CHANNEL_ID);
    expect(countArgs.where.deletedAt).toBeNull();
    const windowMs = Date.now() - countArgs.where.createdAt.gte.getTime();
    expect(windowMs).toBeGreaterThanOrEqual(6.9 * 24 * 3600 * 1000);
    expect(windowMs).toBeLessThanOrEqual(7.1 * 24 * 3600 * 1000);

    const cardArgs = prisma.card.findMany.mock.calls[0]?.[0] as {
      where: { channelId: string; kind: string; deletedAt: null };
    };
    expect(cardArgs.where).toMatchObject({ channelId: CHANNEL_ID, kind: 'task', deletedAt: null });

    const prompt = (lastChatBody?.messages ?? []).map((item) => item.content).join('\n');
    expect(prompt).toContain('巡检播报');
    expect(prompt).toContain('消息数：3');
    expect(prompt).toContain('活跃用户数：2');
    expect(prompt).toContain('任务总数：2，已完成：1，完成率：50%');
    expect(prompt).toContain('终末地工业高级协议官');

    expect(events.filter((item) => item.name === 'delta').length).toBeGreaterThan(0);
    expect(events.find((item) => item.name === 'done')).toBeTruthy();
    expect(tx.message.create).toHaveBeenCalledTimes(1);
    expect(tx.channel.update).toHaveBeenCalledTimes(1);
    expect(realtime.emitToChannel).toHaveBeenCalledWith(CHANNEL_ID, 'message:new', expect.anything());
  });

  it('未配置（runtimeSettings 抛错）时 SSE 由控制器转 error 事件；服务层抛 VALIDATION_FAILED', async () => {
    const { service } = chatService();
    const { sink } = collectEvents();
    const config = (service as unknown as { config: { runtimeSettings: () => Promise<unknown> } }).config;
    config.runtimeSettings = async () => {
      const { AppError } = await import('../src/common/errors/app-error');
      const { ErrorCode } = await import('../src/common/errors/error-codes');
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'AI 未配置');
    };
    await expect(
      service.streamReport(authUser(), { channelId: CHANNEL_ID }, sink, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
