import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BotsService } from '../src/ai/bots.service';
import { BotsController } from '../src/ai/bots.controller';
import { AiChatService, type AiStreamSink } from '../src/ai/ai-chat.service';
import { AiCryptoService } from '../src/ai/ai-crypto.service';
import type { AiConfigService } from '../src/ai/ai-config.service';
import { clearContextSchema, translateSchema, createBotSchema } from '../src/ai/bots.dto';
import { BOT_USER_ID, BOT_MESSAGE_PREFIX } from '../src/ai/bot.constants';
import { ROLES_KEY } from '../src/common/decorators';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { ChannelAccessService } from '../src/common/guards/channel-access.service';
import type { RealtimeService } from '../src/common/realtime/realtime.service';
import type { AppConfig } from '../src/config/config.module';
import type { AuthUser } from '../src/common/types/context';

const SECRET = 'test-bot-secret-0123456789abcdefghij';
const API_KEY = 'sk-bot-SECRET-5678';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const BOT_ID = '33333333-3333-4333-8333-333333333333';
const BOT2_ID = '44444444-4444-4444-8444-444444444444';
const CHANNEL_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-10-24T05:00:00.000Z');

const configStub = { ai: { configSecret: SECRET, usingDevConfigSecret: false } } as unknown as AppConfig;

function cryptoService(): AiCryptoService {
  return new AiCryptoService(configStub);
}

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: OWNER_ID,
    handle: 'founder',
    displayName: '建立者',
    globalRole: 'owner',
    status: 'active',
    sessionId: 's1',
    mutedUntil: null,
    avatarFileId: null,
    statusPrefix: null,
    ...overrides,
  };
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: BOT_ID,
    systemPrompt: '你是翻译官',
    model: 'mock-gpt',
    apiKeyEncrypted: cryptoService().encrypt(API_KEY),
    enabled: true,
    createdAt: NOW,
    deletedAt: null,
    user: {
      id: BOT_ID,
      handle: 'bot_translator_abc123',
      displayName: '翻译官',
      avatarFileId: null,
      isBot: true,
      status: 'active',
    },
    ...overrides,
  };
}

function botMember(user: Record<string, unknown>, enabled = true) {
  return {
    user: {
      id: BOT_ID,
      handle: 'bot_translator_abc123',
      displayName: '翻译官',
      avatarFileId: null,
      isBot: true,
      status: 'active',
      botProfile: {
        systemPrompt: '你是翻译官',
        model: 'mock-gpt',
        apiKeyEncrypted: cryptoService().encrypt(API_KEY),
        enabled,
        deletedAt: null,
      },
      ...user,
    },
  };
}

function channelAccessStub() {
  return { assert: vi.fn(async () => ({ channel: { name: '素材工坊' } })) };
}

function botsService(prisma: unknown, config: unknown = { globalDefaults: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:4010/v1', model: 'mock-gpt', apiKey: API_KEY })) }) {
  const channelAccess = channelAccessStub();
  const service = new BotsService(
    prisma as PrismaService,
    cryptoService(),
    config as AiConfigService,
    channelAccess as unknown as ChannelAccessService,
  );
  return { service, channelAccess, config };
}

// 本地 mock OpenAI（随机端口，仅测试用）
let mockServer: http.Server;
let mockBase = '';

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-gpt' }] }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        void raw;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const piece of ['翻译', '结果', '：已完成']) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (mockServer.address() as AddressInfo).port;
  mockBase = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

describe('多 Bot 权限：仅 owner（admin 也 403）', () => {
  it('admin 调 BotsService.list → FORBIDDEN', async () => {
    const { service } = botsService({ botProfile: { findMany: vi.fn() } });
    await expect(service.list(authUser({ globalRole: 'admin', id: ADMIN_ID }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('BotsController 类级 @Roles(owner)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, BotsController)).toEqual(['owner']);
  });

  it('owner 列表：返回 keyMasked，响应不含明文 key', async () => {
    const prisma = { botProfile: { findMany: vi.fn(async () => [profileRow()]) } };
    const { service } = botsService(prisma);
    const result = await service.list(authUser());
    expect(result.bots[0]).toMatchObject({
      id: BOT_ID,
      name: '翻译官',
      keyMasked: `****${API_KEY.slice(-4)}`,
      enabled: true,
    });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });
});

describe('Bot CRUD（事务 + 加密 + 不回传 key）', () => {
  it('创建：users(is_bot) + bot_profiles 同事务；apiKey 落库为 v1 密文', async () => {
    const userCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: BOT_ID }));
    const profileCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...profileRow(),
      systemPrompt: data.systemPrompt,
      model: data.model,
      apiKeyEncrypted: data.apiKeyEncrypted,
      user: { ...profileRow().user, displayName: '翻译官' },
    }));
    const tx = { user: { create: userCreate }, botProfile: { create: profileCreate } };
    const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
    const { service } = botsService(prisma);

    const view = await service.create(authUser(), {
      name: '翻译官',
      systemPrompt: '你是翻译官',
      model: 'mock-gpt',
      apiKey: API_KEY,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(userCreate.mock.calls[0]?.[0].data).toMatchObject({
      handle: expect.stringMatching(/^bot_/),
      displayName: '翻译官',
      passwordHash: '!bot',
      isBot: true,
      globalRole: 'member',
    });
    const encrypted = profileCreate.mock.calls[0]?.[0].data.apiKeyEncrypted as string;
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(cryptoService().decrypt(encrypted)).toBe(API_KEY);
    expect(JSON.stringify(view)).not.toContain(API_KEY);
    expect(view.keyMasked).toBe(`****${API_KEY.slice(-4)}`);
  });

  it('更新：apiKey 省略时保留旧密文，响应不含 key', async () => {
    const oldEncrypted = cryptoService().encrypt('sk-old-9999');
    const findFirst = vi.fn(async () => profileRow({ apiKeyEncrypted: oldEncrypted }));
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...profileRow({ apiKeyEncrypted: data.apiKeyEncrypted }),
      systemPrompt: data.systemPrompt,
      enabled: data.enabled,
    }));
    const tx = { user: { update: vi.fn() }, botProfile: { update } };
    const prisma = {
      botProfile: { findFirst },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const { service } = botsService(prisma);
    const view = await service.update(authUser(), BOT_ID, { systemPrompt: '新提示词', enabled: false });
    expect(update.mock.calls[0]?.[0].data.apiKeyEncrypted).toBe(oldEncrypted);
    expect(view.systemPrompt).toBe('新提示词');
    expect(view.enabled).toBe(false);
    expect(JSON.stringify(view)).not.toContain('sk-old-9999');
  });

  it('删除：事务软删 profile + user.status=suspended（历史保留）', async () => {
    const findFirst = vi.fn(async () => profileRow());
    const profileUpdate = vi.fn();
    const userUpdate = vi.fn();
    const tx = { botProfile: { update: profileUpdate }, user: { update: userUpdate } };
    const prisma = {
      botProfile: { findFirst },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const { service } = botsService(prisma);
    const result = await service.remove(authUser(), BOT_ID);
    expect(result).toEqual({ id: BOT_ID, deleted: true });
    expect(profileUpdate).toHaveBeenCalledWith({
      where: { userId: BOT_ID },
      data: { deletedAt: expect.any(Date), enabled: false },
    });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: BOT_ID }, data: { status: 'suspended' } });
  });

  it('DTO：name ≤40、systemPrompt ≤8000；translate 必须带 messageId', () => {
    expect(createBotSchema.safeParse({ name: 'x'.repeat(40), systemPrompt: 'y'.repeat(8000) }).success).toBe(true);
    expect(createBotSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
    expect(createBotSchema.safeParse({ name: 'ok', systemPrompt: 'y'.repeat(8001) }).success).toBe(false);
    expect(clearContextSchema.safeParse({ channelId: CHANNEL_ID }).success).toBe(true);
    expect(translateSchema.safeParse({ channelId: CHANNEL_ID }).success).toBe(false);
    expect(translateSchema.safeParse({ channelId: CHANNEL_ID, messageId: '123' }).success).toBe(true);
  });
});

describe('频道 Bot 成员 + 解析（BOT_NOT_FOUND / BOT_DISABLED）', () => {
  it('GET /channels/:id/bots：过滤 is_bot 成员并带 enabled', async () => {
    const findMany = vi.fn(async () => [botMember({ id: BOT_ID, displayName: '翻译官' }), botMember({ id: BOT2_ID, displayName: '总结官' }, false)]);
    const { service } = botsService({ channelMember: { findMany } });
    const result = await service.listChannelBots(authUser(), CHANNEL_ID);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channelId: CHANNEL_ID,
          user: { isBot: true, botProfile: { is: { deletedAt: null } } },
        },
      }),
    );
    expect(result.bots).toEqual([
      { id: BOT_ID, name: '翻译官', avatarFileId: null, enabled: true },
      { id: BOT2_ID, name: '总结官', avatarFileId: null, enabled: false },
    ]);
  });

  it('显式 botId 不在频道 → BOT_NOT_FOUND；profile disabled → BOT_DISABLED', async () => {
    const missing = botsService({ channelMember: { findFirst: vi.fn(async () => null) } });
    await expect(missing.service.resolveBot(CHANNEL_ID, BOT_ID)).rejects.toMatchObject({
      code: 'BOT_NOT_FOUND',
    });

    const disabled = botsService({
      channelMember: { findFirst: vi.fn(async () => botMember({ id: BOT_ID }, false)) },
    });
    await expect(disabled.service.resolveBot(CHANNEL_ID, BOT_ID)).rejects.toMatchObject({
      code: 'BOT_DISABLED',
    });
  });

  it('省略 botId：从 @名称 匹配（最长优先），无匹配回退默认 Bot', async () => {
    const members = [
      botMember({ id: BOT_ID, displayName: 'AI' }),
      botMember({ id: BOT2_ID, displayName: 'AI助手' }),
    ];
    const prisma = { channelMember: { findMany: vi.fn(async () => members) } };
    const { service } = botsService(prisma);

    const matched = await service.resolveBot(CHANNEL_ID, undefined, '@AI助手 帮我翻译');
    expect(matched.id).toBe(BOT2_ID);

    const fallbackPrisma = {
      channelMember: {
        findMany: vi.fn(async () => [botMember({ id: BOT_USER_ID, displayName: '默认' })]),
      },
    };
    const fallback = await botsService(fallbackPrisma).service.resolveBot(CHANNEL_ID, undefined, '没有提及');
    expect(fallback.id).toBe(BOT_USER_ID);

    await expect(
      botsService({ channelMember: { findMany: vi.fn(async () => []) } }).service.resolveBot(
        CHANNEL_ID,
        undefined,
        '没有 bot',
      ),
    ).rejects.toMatchObject({ code: 'BOT_NOT_FOUND' });
  });

  it('同步回退全局：Bot 无 model/key 时用全局默认', async () => {
    const globalDefaults = vi.fn(async () => ({ baseUrl: mockBase, model: 'global-model', apiKey: 'global-key' }));
    const { service } = botsService({}, { globalDefaults });
    const settings = await service.effectiveSettings({
      id: BOT_ID,
      name: '翻译官',
      systemPrompt: '',
      model: null,
      apiKeyEncrypted: null,
      enabled: true,
    });
    expect(settings).toEqual({ baseUrl: mockBase, model: 'global-model', apiKey: 'global-key' });

    const missingConfig = vi.fn(async () => ({ baseUrl: null, model: null, apiKey: null }));
    await expect(
      botsService({}, { globalDefaults: missingConfig }).service.effectiveSettings({
        id: BOT_ID,
        name: '翻译官',
        systemPrompt: '',
        model: null,
        apiKeyEncrypted: null,
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('POST /ai/clear：只改上下文水位', () => {
  it('upsert cleared_at，不删除任何消息', async () => {
    const upsert = vi.fn(async () => ({ channelId: CHANNEL_ID, botId: BOT_ID }));
    const deleteMany = vi.fn();
    const { service } = botsService({
      aiChannelContext: { upsert },
      message: { deleteMany },
    });
    vi.spyOn(service, 'resolveBot').mockResolvedValue({
      id: BOT_ID,
      name: '翻译官',
      systemPrompt: '',
      model: null,
      apiKeyEncrypted: null,
      enabled: true,
    });

    const result = await service.clearContext(authUser(), CHANNEL_ID, BOT_ID);
    expect(result).toEqual({ cleared: true });
    expect(upsert).toHaveBeenCalledWith({
      where: { channelId_botId: { channelId: CHANNEL_ID, botId: BOT_ID } },
      create: { channelId: CHANNEL_ID, botId: BOT_ID, clearedAt: expect.any(Date), updatedAt: expect.any(Date) },
      update: { clearedAt: expect.any(Date), updatedAt: expect.any(Date) },
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

// ── AiChatService：按 Bot 落库 + 上下文过滤 + translate ─────────────────────
function messageRow(data: Record<string, unknown>, senderId: string) {
  return {
    id: 7001n,
    channelId: CHANNEL_ID,
    senderId,
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
    createdAt: new Date('2026-10-24T05:00:01.000Z'),
  };
}

function chatHarness(clearedAt: Date | null = NOW) {
  const bot = {
    resolveBot: vi.fn(async () => ({
      id: BOT_ID,
      name: '翻译官',
      systemPrompt: '你是翻译官',
      model: 'mock-gpt',
      apiKeyEncrypted: null,
      enabled: true,
    })),
    effectiveSettings: vi.fn(async () => ({ baseUrl: mockBase, model: 'mock-gpt', apiKey: 'k' })),
  };
  const tx = {
    message: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => messageRow(data, String(data.senderId))) },
    channel: { update: vi.fn(async () => ({ id: CHANNEL_ID })) },
  };
  const prisma = {
    message: {
      findMany: vi.fn(async () => [{ senderId: 'u1', body: '早先消息' }]),
      findUnique: vi.fn(async () => ({
        id: 7000n,
        channelId: CHANNEL_ID,
        body: 'Hello world',
        deletedAt: null,
      })),
    },
    aiChannelContext: { findUnique: vi.fn(async () => ({ clearedAt })) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const realtime = { emitToChannel: vi.fn() };
  const service = new AiChatService(
    prisma as unknown as PrismaService,
    channelAccessStub() as unknown as ChannelAccessService,
    realtime as unknown as RealtimeService,
    {} as AiConfigService,
    bot as unknown as BotsService,
  );
  return { service, prisma, tx, realtime, bot };
}

function collect(): { sink: AiStreamSink; events: Array<{ name: string; data: unknown }> } {
  const events: Array<{ name: string; data: unknown }> = [];
  return { sink: { event: (name, data) => events.push({ name, data }) }, events };
}

describe('POST /ai/chat（多 Bot）：senderId=Bot + 上下文水位', () => {
  it('落库 senderId=该 Bot；history 按 cleared_at 过滤；SSE delta/done', async () => {
    const { service, prisma, tx, realtime } = chatHarness(new Date('2026-10-24T00:00:00.000Z'));
    const { sink, events } = collect();

    await service.streamChat(
      authUser(),
      { channelId: CHANNEL_ID, body: '翻译 hello', botId: BOT_ID },
      sink,
      new AbortController().signal,
    );

    const historyArgs = prisma.message.findMany.mock.calls[0]?.[0] as {
      where: { channelId: string; deletedAt: null; createdAt?: { gte: Date } };
    };
    expect(historyArgs.where.channelId).toBe(CHANNEL_ID);
    expect(historyArgs.where.createdAt?.gte).toEqual(new Date('2026-10-24T00:00:00.000Z'));

    const created = tx.message.create.mock.calls[0]?.[0] as { data: { senderId: string; body: string } };
    expect(created.data.senderId).toBe(BOT_ID);
    expect(created.data.body.startsWith(BOT_MESSAGE_PREFIX)).toBe(true);
    expect(realtime.emitToChannel).toHaveBeenCalledWith(CHANNEL_ID, 'message:new', expect.anything());
    expect(events.filter((item) => item.name === 'delta').length).toBeGreaterThan(0);
    expect(events.find((item) => item.name === 'done')).toBeTruthy();
  });

  it('POST /ai/translate：消息不存在/跨频道 → VALIDATION_FAILED', async () => {
    const { service } = chatHarness(null);
    (service as unknown as { prisma: { message: { findUnique: ReturnType<typeof vi.fn> } } }).prisma.message.findUnique.mockResolvedValueOnce(null);
    await expect(
      (async () => {
        const { sink } = collect();
        await service.streamTranslate(
          authUser(),
          { channelId: CHANNEL_ID, messageId: '999', botId: BOT_ID },
          sink,
          new AbortController().signal,
        );
      })(),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
