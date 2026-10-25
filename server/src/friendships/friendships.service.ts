import { Injectable, Logger } from '@nestjs/common';
import type { ChannelSurface, Friendship, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdentityService } from '../common/identity/identity.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { BeltRealtimeService } from '../belt/belt-realtime.service';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { dmKeyOf, dmSlugOf } from '../conversations/conversation-rules';
import type { AuthUser } from '../common/types/context';
import type { CreateFriendRequestDto, RespondFriendDto } from './friendships.dto';

export interface FriendUserView {
  id: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  prefixes: string[];
}

export interface FriendshipView {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted' | 'rejected' | 'blocked' | 'removed';
  surface: 'internal' | 'belt' | 'bridge';
  contextPostId: string | null;
  requestNote: string | null;
  dmChannelId: string | null;
  requestedAt: string;
  respondedAt: string | null;
  peer: FriendUserView;
}

@Injectable()
export class FriendshipsService {
  private readonly logger = new Logger(FriendshipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly realtime: RealtimeService,
    private readonly beltRealtime: BeltRealtimeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser): Promise<{
    friends: FriendshipView[];
    incoming: FriendshipView[];
    outgoing: FriendshipView[];
    blocked: FriendshipView[];
  }> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: actor.id }, { addresseeId: actor.id }],
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    const views = await this.views(rows, actor.id);
    return {
      friends: views.filter((row) => row.status === 'accepted'),
      incoming: views.filter((row) => row.status === 'pending' && row.addresseeId === actor.id),
      outgoing: views.filter((row) => row.status === 'pending' && row.requesterId === actor.id),
      blocked: views.filter((row) => row.status === 'blocked'),
    };
  }

  async request(actor: AuthUser, dto: CreateFriendRequestDto): Promise<FriendshipView> {
    const target = await this.prisma.user.findUnique({
      where: { handle: dto.handle.replace(/^@/, '').trim().toLowerCase() },
      select: {
        id: true,
        handle: true,
        displayName: true,
        status: true,
        accountOrigin: true,
        isBot: true,
      },
    });
    if (!target) throw new AppError(ErrorCode.VALIDATION_FAILED, '用户不存在', { field: 'handle' });
    if (target.id === actor.id) throw new AppError(ErrorCode.VALIDATION_FAILED, '不能向自己发起好友申请');
    if (target.status === 'suspended') throw new AppError(ErrorCode.FORBIDDEN, '目标账号已被封禁');
    if (target.isBot) throw new AppError(ErrorCode.FORBIDDEN, 'Bot 不接受好友申请');

    const contextPostId = dto.contextPostId ?? null;
    const surface = await this.resolveSurface(actor, target, contextPostId);

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: actor.id, addresseeId: target.id },
          { requesterId: target.id, addresseeId: actor.id },
        ],
      },
    });

    if (existing?.status === 'accepted') {
      throw new AppError(ErrorCode.FRIENDSHIP_CONFLICT, '你们已经是好友');
    }
    if (existing?.status === 'blocked') {
      throw new AppError(ErrorCode.FRIENDSHIP_CONFLICT, '链路已被阻断，无法发起申请');
    }
    if (existing?.status === 'pending') {
      if (existing.requesterId === actor.id) {
        return (await this.views([existing], actor.id))[0]!;
      }
      throw new AppError(ErrorCode.FRIENDSHIP_CONFLICT, '对方已经向你发出申请，请直接处理');
    }

    let row: Friendship;
    if (existing) {
      row = await this.prisma.friendship.update({
        where: { id: existing.id },
        data: {
          requesterId: actor.id,
          addresseeId: target.id,
          status: 'pending',
          surface,
          contextPostId,
          requestNote: dto.note ?? null,
          requestedAt: new Date(),
          respondedAt: null,
          blockedBy: null,
        },
      });
    } else {
      try {
        row = await this.prisma.friendship.create({
          data: {
            requesterId: actor.id,
            addresseeId: target.id,
            status: 'pending',
            surface,
            contextPostId,
            requestNote: dto.note ?? null,
          },
        });
      } catch (error) {
        if (!PrismaService.isUniqueViolation(error)) throw error;
        const raced = await this.prisma.friendship.findFirst({
          where: {
            OR: [
              { requesterId: actor.id, addresseeId: target.id },
              { requesterId: target.id, addresseeId: actor.id },
            ],
          },
        });
        if (!raced) throw error;
        return (await this.views([raced], actor.id))[0]!;
      }
    }

    await this.audit.record({
      actorId: actor.id,
      action: AuditAction.FRIEND_REQUEST,
      targetKind: 'user',
      targetId: target.id,
      meta: { surface, contextPostId },
    });
    this.logger.log(`好友申请：${actor.handle} -> ${target.handle} (${surface})`);
    return (await this.views([row], actor.id))[0]!;
  }

  async respond(actor: AuthUser, friendshipId: string, dto: RespondFriendDto): Promise<FriendshipView> {
    const friendship = await this.find(friendshipId);
    const isAddressee = friendship.addresseeId === actor.id;
    const isParticipant = isAddressee || friendship.requesterId === actor.id;
    if (!isParticipant) throw new AppError(ErrorCode.FRIENDSHIP_NOT_FOUND);
    if (dto.action !== 'block' && !isAddressee) {
      throw new AppError(ErrorCode.FORBIDDEN, '只有接收方可以同意或拒绝申请');
    }
    if (friendship.status !== 'pending' && dto.action !== 'block') {
      throw new AppError(ErrorCode.FRIENDSHIP_CONFLICT, '该申请已不在待处理状态');
    }

    if (dto.action === 'reject') {
      const updated = await this.prisma.friendship.update({
        where: { id: friendship.id },
        data: { status: 'rejected', respondedAt: new Date() },
      });
      await this.audit.record({
        actorId: actor.id,
        action: AuditAction.FRIEND_REJECT,
        targetKind: 'friendship',
        targetId: friendship.id,
      });
      return (await this.views([updated], actor.id))[0]!;
    }

    if (dto.action === 'block') {
      const updated = await this.prisma.friendship.update({
        where: { id: friendship.id },
        data: {
          status: 'blocked',
          blockedBy: actor.id,
          respondedAt: new Date(),
        },
      });
      await this.audit.record({
        actorId: actor.id,
        action: AuditAction.FRIEND_BLOCK,
        targetKind: 'friendship',
        targetId: friendship.id,
      });
      return (await this.views([updated], actor.id))[0]!;
    }

    const dmChannelId = await this.prisma.withTransaction(async (tx) => {
      const channelId = await this.ensureDm(tx, friendship);
      await tx.friendship.update({
        where: { id: friendship.id },
        data: {
          status: 'accepted',
          respondedAt: new Date(),
          dmChannelId: channelId,
        },
      });
      return channelId;
    });

    const updated = await this.find(friendship.id);
    const view = (await this.views([updated], actor.id))[0]!;
    this.emitConversation(updated, dmChannelId);
    await this.audit.record({
      actorId: actor.id,
      action: AuditAction.FRIEND_ACCEPT,
      targetKind: 'friendship',
      targetId: friendship.id,
      meta: { dmChannelId, surface: updated.surface },
    });
    return view;
  }

  async remove(actor: AuthUser, friendshipId: string): Promise<{ removed: true }> {
    const friendship = await this.find(friendshipId);
    if (friendship.requesterId !== actor.id && friendship.addresseeId !== actor.id) {
      throw new AppError(ErrorCode.FRIENDSHIP_NOT_FOUND);
    }
    await this.prisma.friendship.update({
      where: { id: friendship.id },
      data: { status: 'removed', respondedAt: new Date() },
    });
    await this.audit.record({
      actorId: actor.id,
      action: AuditAction.FRIEND_REMOVE,
      targetKind: 'friendship',
      targetId: friendship.id,
    });
    return { removed: true };
  }

  /** 内部 DM / bridge DM 发消息前的硬校验；群聊不走这里 */
  async assertDmWritable(userId: string, channelId: string): Promise<void> {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        dmChannelId: channelId,
        status: 'accepted',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { id: true },
    });
    if (!friendship) throw new AppError(ErrorCode.FRIENDSHIP_REQUIRED);
  }

  async assertAcceptedForChannel(userId: string, channelId: string): Promise<boolean> {
    const row = await this.prisma.friendship.findFirst({
      where: {
        dmChannelId: channelId,
        status: 'accepted',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  private async resolveSurface(
    actor: AuthUser,
    target: { id: string; accountOrigin: 'internal' | 'belt' },
    contextPostId: string | null,
  ): Promise<ChannelSurface> {
    const actorOrigin = actor.accountOrigin;
    if (actorOrigin === target.accountOrigin) {
      if (actorOrigin === 'internal') {
        if (actor.sessionSurface !== 'internal') {
          throw new AppError(ErrorCode.CROSS_SURFACE_DENIED, '内部账号之间的链路请在帝江号内建立');
        }
        return 'internal';
      }
      if (actor.sessionSurface !== 'belt') {
        throw new AppError(ErrorCode.CROSS_SURFACE_DENIED, '外环链路必须从文明环带会话发起');
      }
      return 'belt';
    }

    // 跨面：只允许从悬赏委托发起
    if (!contextPostId) {
      throw new AppError(ErrorCode.CROSS_SURFACE_DENIED);
    }
    if (actor.sessionSurface !== 'belt') {
      throw new AppError(ErrorCode.CROSS_SURFACE_DENIED, '跨环带链路必须从文明环带会话发起');
    }
    const post = await this.prisma.post.findFirst({
      where: {
        id: contextPostId,
        surface: 'belt',
        board: 'bounty',
        status: 'published',
        deletedAt: null,
      },
      select: { id: true, authorId: true },
    });
    if (!post || post.authorId !== target.id) {
      throw new AppError(ErrorCode.CROSS_SURFACE_DENIED, '悬赏上下文与目标用户不匹配');
    }
    return 'bridge';
  }

  private async find(id: string): Promise<Friendship> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError(ErrorCode.FRIENDSHIP_NOT_FOUND);
    }
    const row = await this.prisma.friendship.findUnique({ where: { id } });
    if (!row) throw new AppError(ErrorCode.FRIENDSHIP_NOT_FOUND);
    return row;
  }

  private async ensureDm(tx: Prisma.TransactionClient, friendship: Friendship): Promise<string> {
    if (friendship.dmChannelId) {
      await tx.channelMember.createMany({
        data: [
          { channelId: friendship.dmChannelId, userId: friendship.requesterId, role: 'member' },
          { channelId: friendship.dmChannelId, userId: friendship.addresseeId, role: 'member' },
        ],
        skipDuplicates: true,
      });
      return friendship.dmChannelId;
    }

    const dmKey = dmKeyOf(friendship.requesterId, friendship.addresseeId);
    const existing = await tx.channel.findFirst({
      where: { dmKey, surface: friendship.surface },
      select: { id: true },
    });
    const channelId =
      existing?.id ??
      (
        await tx.channel.create({
          data: {
            name: '',
            slug: dmSlugOf(dmKey, friendship.surface),
            topic: null,
            visibility: 'private',
            kind: 'dm',
            surface: friendship.surface,
            dmKey,
            position: 0,
            createdBy: friendship.requesterId,
          },
          select: { id: true },
        })
      ).id;

    await tx.channelMember.createMany({
      data: [
        { channelId, userId: friendship.requesterId, role: 'member' },
        { channelId, userId: friendship.addresseeId, role: 'member' },
      ],
      skipDuplicates: true,
    });
    return channelId;
  }

  private emitConversation(friendship: Friendship, dmChannelId: string): void {
    const payload = {
      conversation: {
        id: dmChannelId,
        kind: 'dm',
        surface: friendship.surface,
      },
    };
    // 内部客户端只在 internal 侧有 socket；belt 侧用 belt:conversation。
    this.realtime.emitToUser(friendship.requesterId, 'conversation:created', payload.conversation);
    this.realtime.emitToUser(friendship.addresseeId, 'conversation:created', payload.conversation);
    this.beltRealtime.emitToBeltUser(friendship.requesterId, 'belt:conversation', payload);
    this.beltRealtime.emitToBeltUser(friendship.addresseeId, 'belt:conversation', payload);
  }

  private async views(rows: Friendship[], actorId: string): Promise<FriendshipView[]> {
    if (rows.length === 0) return [];
    const peerIds = rows.map((row) => (row.requesterId === actorId ? row.addresseeId : row.requesterId));
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(peerIds)] } },
      select: { id: true, handle: true, displayName: true, avatarFileId: true, tags: true, globalRole: true },
    });
    const prefixes = await this.identity.prefixesForMany(users);
    const userMap = new Map(users.map((user) => [user.id, user]));
    return rows.map((row) => {
      const peerId = row.requesterId === actorId ? row.addresseeId : row.requesterId;
      const peer = userMap.get(peerId);
      return {
        id: row.id,
        requesterId: row.requesterId,
        addresseeId: row.addresseeId,
        status: row.status,
        surface: row.surface,
        contextPostId: row.contextPostId,
        requestNote: row.requestNote,
        dmChannelId: row.dmChannelId,
        requestedAt: row.requestedAt.toISOString(),
        respondedAt: row.respondedAt?.toISOString() ?? null,
        peer: {
          id: peerId,
          handle: peer?.handle ?? '',
          displayName: peer?.displayName ?? '未知成员',
          avatarFileId: peer?.avatarFileId ?? null,
          prefixes: prefixes[peerId] ?? [],
        },
      };
    });
  }
}
