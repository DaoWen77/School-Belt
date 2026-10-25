import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ChannelAccessService } from '../common/guards/channel-access.service';
import type { AuthUser } from '../common/types/context';
import { AiCryptoService } from './ai-crypto.service';
import { AiConfigService } from './ai-config.service';
import { BOT_USER_ID } from './bot.constants';
import type { CreateBotDto, UpdateBotDto } from './bots.dto';

export interface BotView {
  id: string;
  handle: string;
  name: string;
  avatarFileId: string | null;
  model: string | null;
  systemPrompt: string;
  enabled: boolean;
  keyMasked: string | null;
  createdAt: string;
}

export interface ChannelBotView {
  id: string;
  name: string;
  avatarFileId: string | null;
  enabled: boolean;
}

/** 已解析、可用于对话的 Bot（仅服务端内部使用，含密文 key） */
export interface BotIdentity {
  id: string;
  name: string;
  systemPrompt: string;
  model: string | null;
  apiKeyEncrypted: string | null;
  enabled: boolean;
}

const PROFILE_SELECT = {
  userId: true,
  systemPrompt: true,
  model: true,
  apiKeyEncrypted: true,
  enabled: true,
  createdAt: true,
  deletedAt: true,
  user: {
    select: { id: true, handle: true, displayName: true, avatarFileId: true, isBot: true, status: true },
  },
} as const;

const BOT_MEMBER_SELECT = {
  user: {
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarFileId: true,
      isBot: true,
      status: true,
      botProfile: {
        select: {
          systemPrompt: true,
          model: true,
          apiKeyEncrypted: true,
          enabled: true,
          deletedAt: true,
        },
      },
    },
  },
} as const;

type ProfileRow = {
  userId: string;
  systemPrompt: string;
  model: string | null;
  apiKeyEncrypted: string | null;
  enabled: boolean;
  createdAt: Date;
  deletedAt: Date | null;
  user: {
    id: string;
    handle: string;
    displayName: string;
    avatarFileId: string | null;
    isBot: boolean;
    status: string;
  };
};

/**
 * 多 Bot 管理（Sprint5）。
 * - 身份复用 users.is_bot=true；bot_profiles 存人设/模型/加密 Key；
 * - CRUD **仅 owner**（admin 也 403；RolesGuard + assertOwner 双保险）；
 * - Key 只以 AES-256-GCM 密文存 DB，任何响应只回 `keyMasked`；
 * - Bot 是否可用由“频道成员关系 + bot_profiles.enabled + user.status”共同决定。
 */
@Injectable()
export class BotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AiCryptoService,
    private readonly config: AiConfigService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  private assertOwner(user: AuthUser): void {
    if (user.globalRole !== 'owner') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅创建者可管理 Bot');
    }
  }

  async list(user: AuthUser): Promise<{ bots: BotView[] }> {
    this.assertOwner(user);
    const rows = (await this.prisma.botProfile.findMany({
      where: { deletedAt: null, user: { isBot: true } },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      select: PROFILE_SELECT,
    })) as ProfileRow[];
    return { bots: rows.map((row) => this.toView(row)) };
  }

  /** 事务创建：users(is_bot=true, password_hash='!bot') + bot_profiles */
  async create(user: AuthUser, dto: CreateBotDto): Promise<BotView> {
    this.assertOwner(user);
    const handle = buildHandle(dto.name);
    const encrypted = dto.apiKey ? this.crypto.encrypt(dto.apiKey) : null;

    const row = (await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          handle,
          displayName: dto.name,
          passwordHash: '!bot',
          globalRole: 'member',
          status: 'active',
          isBot: true,
          avatarFileId: dto.avatarFileId ?? null,
        },
        select: { id: true },
      });
      return tx.botProfile.create({
        data: {
          userId: created.id,
          systemPrompt: dto.systemPrompt ?? '',
          model: dto.model ?? null,
          apiKeyEncrypted: encrypted,
          enabled: true,
          createdBy: user.id,
        },
        select: PROFILE_SELECT,
      });
    })) as ProfileRow;

    return this.toView(row);
  }

  /** 事务更新 users + bot_profiles；apiKey 省略/空串=保留旧值 */
  async update(user: AuthUser, botId: string, dto: UpdateBotDto): Promise<BotView> {
    this.assertOwner(user);
    const existing = await this.findProfile(botId);
    if (!existing) throw new AppError(ErrorCode.BOT_NOT_FOUND, 'Bot 不存在', { botId });

    const encrypted =
      dto.apiKey !== undefined && dto.apiKey.length > 0
        ? this.crypto.encrypt(dto.apiKey)
        : existing.apiKeyEncrypted;

    const row = (await this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined || dto.avatarFileId !== undefined) {
        await tx.user.update({
          where: { id: botId },
          data: {
            ...(dto.name !== undefined ? { displayName: dto.name } : {}),
            ...(dto.avatarFileId !== undefined ? { avatarFileId: dto.avatarFileId } : {}),
          },
        });
      }
      return tx.botProfile.update({
        where: { userId: botId },
        data: {
          ...(dto.systemPrompt !== undefined ? { systemPrompt: dto.systemPrompt } : {}),
          ...(dto.model !== undefined ? { model: dto.model } : {}),
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          apiKeyEncrypted: encrypted,
        },
        select: PROFILE_SELECT,
      });
    })) as ProfileRow;

    return this.toView(row);
  }

  /** 事务软删 profile + 禁用 user（保留历史消息与频道成员关系） */
  async remove(user: AuthUser, botId: string): Promise<{ id: string; deleted: true }> {
    this.assertOwner(user);
    const existing = await this.findProfile(botId);
    if (!existing) throw new AppError(ErrorCode.BOT_NOT_FOUND, 'Bot 不存在', { botId });

    await this.prisma.$transaction(async (tx) => {
      await tx.botProfile.update({
        where: { userId: botId },
        data: { deletedAt: new Date(), enabled: false },
      });
      await tx.user.update({ where: { id: botId }, data: { status: 'suspended' } });
    });
    return { id: botId, deleted: true };
  }

  /** POST /bots/:id/test：用 Bot 的 model/key（空回退全局），8s 超时 */
  async test(user: AuthUser, botId: string): Promise<{ ok: boolean; latencyMs: number; status: number; error?: string }> {
    this.assertOwner(user);
    const profile = await this.findProfile(botId);
    if (!profile) throw new AppError(ErrorCode.BOT_NOT_FOUND, 'Bot 不存在', { botId });

    const startedAt = Date.now();
    let settings: { baseUrl: string; model: string; apiKey: string };
    try {
      settings = await this.effectiveSettings({
        id: botId,
        name: profile.user.displayName,
        systemPrompt: profile.systemPrompt,
        model: profile.model,
        apiKeyEncrypted: profile.apiKeyEncrypted,
        enabled: profile.enabled,
      });
    } catch (error) {
      return { ok: false, latencyMs: 0, status: 0, error: (error as Error).message };
    }

    try {
      const response = await fetch(`${settings.baseUrl}/models`, {
        headers: { authorization: `Bearer ${settings.apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      return {
        ok: response.ok,
        latencyMs: Date.now() - startedAt,
        status: response.status,
        ...(response.ok ? {} : { error: `上游返回 HTTP ${response.status}` }),
      };
    } catch (error) {
      const reason = (error as Error).name === 'TimeoutError' ? '连接超时（8s）' : '无法连接 AI 服务';
      return { ok: false, latencyMs: Date.now() - startedAt, status: 0, error: reason };
    }
  }

  /** GET /channels/:id/bots：频道成员可读；只返回未删除 profile 的 Bot 成员 */
  async listChannelBots(user: AuthUser, channelId: string): Promise<{ bots: ChannelBotView[] }> {
    await this.channelAccess.assert(channelId, user, 'read');
    const members = await this.prisma.channelMember.findMany({
      where: {
        channelId,
        user: { isBot: true, botProfile: { is: { deletedAt: null } } },
      },
      orderBy: [{ joinedAt: 'asc' }],
      select: BOT_MEMBER_SELECT,
    });
    return {
      bots: members.map((member) => ({
        id: member.user.id,
        name: member.user.displayName,
        avatarFileId: member.user.avatarFileId,
        enabled: member.user.botProfile?.enabled ?? false,
      })),
    };
  }

  /**
   * 解析对话要用的 Bot：
   * - 指定 botId → 必须是该频道 is_bot 成员 + profile 未删 + enabled；
   * - 省略 → 从 body 的 `@名称` 匹配频道 Bot 成员（最长名称优先），否则回退默认 Bot。
   */
  async resolveBot(
    channelId: string,
    botId?: string,
    body?: string,
  ): Promise<BotIdentity> {
    if (botId) {
      const identity = await this.loadChannelBot(channelId, botId);
      if (!identity) throw new AppError(ErrorCode.BOT_NOT_FOUND, 'Bot 不存在或未加入该频道', { botId });
      this.assertUsable(identity);
      return identity;
    }

    const members = await this.listChannelBotIdentities(channelId);
    if (body) {
      const matched = members
        .filter((bot) => body.includes(`@${bot.name}`))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (matched) {
        this.assertUsable(matched);
        return matched;
      }
    }
    const fallback = members.find((bot) => bot.id === BOT_USER_ID) ?? members[0];
    if (!fallback) {
      throw new AppError(ErrorCode.BOT_NOT_FOUND, '该频道没有可用的 Bot，请先把 Bot 加入频道');
    }
    this.assertUsable(fallback);
    return fallback;
  }

  /** 合并 Bot 配置与全局 ai_settings：Bot 的 model/key 优先，空则回退全局 */
  async effectiveSettings(bot: BotIdentity): Promise<{ baseUrl: string; model: string; apiKey: string }> {
    const global = await this.config.globalDefaults();
    let apiKey: string | null = null;
    if (bot.apiKeyEncrypted) {
      try {
        apiKey = this.crypto.decrypt(bot.apiKeyEncrypted);
      } catch {
        apiKey = null;
      }
    }
    apiKey = apiKey ?? global.apiKey;
    const model = bot.model ?? global.model;
    if (!global.baseUrl || !model || !apiKey) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Bot 或全局 AI 配置不完整（需要 baseUrl + model + apiKey）',
      );
    }
    return { baseUrl: global.baseUrl, model, apiKey };
  }

  /** clear 只写水位，不删消息 */
  async clearContext(
    user: AuthUser,
    channelId: string,
    botId?: string,
  ): Promise<{ cleared: true }> {
    await this.channelAccess.assert(channelId, user, 'read');
    const bot = await this.resolveBot(channelId, botId);
    const now = new Date();
    await this.prisma.aiChannelContext.upsert({
      where: { channelId_botId: { channelId, botId: bot.id } },
      create: { channelId, botId: bot.id, clearedAt: now, updatedAt: now },
      update: { clearedAt: now, updatedAt: now },
    });
    return { cleared: true };
  }

  private assertUsable(bot: BotIdentity): void {
    if (!bot.enabled) throw new AppError(ErrorCode.BOT_DISABLED, 'Bot 已禁用', { botId: bot.id });
  }

  private async findProfile(botId: string): Promise<ProfileRow | null> {
    return (await this.prisma.botProfile.findFirst({
      where: { userId: botId, deletedAt: null, user: { isBot: true } },
      select: PROFILE_SELECT,
    })) as ProfileRow | null;
  }

  private async loadChannelBot(channelId: string, botId: string): Promise<BotIdentity | null> {
    const member = await this.prisma.channelMember.findFirst({
      where: { channelId, userId: botId, user: { isBot: true } },
      select: BOT_MEMBER_SELECT,
    });
    return member ? toIdentity(member.user) : null;
  }

  private async listChannelBotIdentities(channelId: string): Promise<BotIdentity[]> {
    const members = await this.prisma.channelMember.findMany({
      where: {
        channelId,
        user: { isBot: true, botProfile: { is: { deletedAt: null } } },
      },
      orderBy: [{ joinedAt: 'asc' }],
      select: BOT_MEMBER_SELECT,
    });
    return members
      .map((member) => toIdentity(member.user))
      .filter((bot): bot is BotIdentity => bot !== null);
  }

  private toView(row: ProfileRow): BotView {
    return {
      id: row.userId,
      handle: row.user.handle,
      name: row.user.displayName,
      avatarFileId: row.user.avatarFileId,
      model: row.model,
      systemPrompt: row.systemPrompt,
      enabled: row.enabled,
      keyMasked: row.apiKeyEncrypted ? this.maskedKey(row.apiKeyEncrypted) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private maskedKey(encrypted: string): string {
    try {
      return this.crypto.mask(this.crypto.decrypt(encrypted));
    } catch {
      return '****';
    }
  }
}

function toIdentity(user: {
  id: string;
  displayName: string;
  status: string;
  botProfile: {
    systemPrompt: string;
    model: string | null;
    apiKeyEncrypted: string | null;
    enabled: boolean;
    deletedAt: Date | null;
  } | null;
}): BotIdentity | null {
  if (!user.botProfile || user.botProfile.deletedAt) return null;
  return {
    id: user.id,
    name: user.displayName,
    systemPrompt: user.botProfile.systemPrompt,
    model: user.botProfile.model,
    apiKeyEncrypted: user.botProfile.apiKeyEncrypted,
    enabled: user.botProfile.enabled && user.status === 'active',
  };
}

/** 生成 bot handle：bot_<ascii slug>_<6 hex>；中文名没有 ascii 时退化为 agent */
export function buildHandle(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12);
  return `bot_${slug || 'agent'}_${randomBytes(3).toString('hex')}`;
}
