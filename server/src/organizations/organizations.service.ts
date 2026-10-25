import { Injectable, Logger } from '@nestjs/common';
import type { Organization, OrganizationMember } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeService } from '../common/realtime/realtime.service';
import { AuditAction, AuditService } from '../common/audit/audit.service';
import { IdentityService } from '../common/identity/identity.service';
import type { AuthUser } from '../common/types/context';
import type {
  CreateOrganizationDto,
  CreateOrgChannelDto,
  JoinOrganizationDto,
  ReviewMemberDto,
  ReviewOrganizationDto,
  TransferOrganizationDto,
} from './organizations.dto';

export interface OrgMemberView {
  userId: string;
  handle: string;
  displayName: string;
  avatarFileId: string | null;
  role: 'owner' | 'admin' | 'member';
  status: 'pending' | 'invited' | 'active' | 'left' | 'rejected' | 'banned';
  prefixes: string[];
  requestNote: string | null;
  requestedAt: string;
  joinedAt: string | null;
}

export interface OrgChannelView {
  id: string;
  name: string;
  topic: string | null;
  visibility: 'public' | 'private';
  memberCount: number;
  archived: boolean;
  createdAt: string;
}

export interface OrganizationView {
  id: string;
  name: string;
  summary: string;
  status: 'pending' | 'active' | 'rejected' | 'suspended' | 'dissolved';
  surface: 'internal' | 'belt' | 'bridge';
  isPublic: boolean;
  joinType: 'open' | 'apply' | 'invite';
  ownerId: string;
  ownerHandle: string | null;
  ownerDisplayName: string | null;
  ownerPrefixes: string[];
  myRole: 'owner' | 'admin' | 'member' | null;
  myStatus: 'pending' | 'invited' | 'active' | 'left' | 'rejected' | 'banned' | null;
  memberCount: number;
  channels?: OrgChannelView[];
  members?: OrgMemberView[];
  pendingRequests?: OrgMemberView[];
  createdAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
}

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  // ── 用户侧 ────────────────────────────────────────────────────────────────

  async getMine(user: AuthUser): Promise<{
    organization: OrganizationView | null;
    pendingApplication: OrganizationView | null;
    pendingJoin: OrganizationView | null;
  }> {
    const active = await this.prisma.organizationMember.findFirst({
      where: {
        userId: user.id,
        status: 'active',
        organization: { status: 'active', surface: user.sessionSurface },
      },
      select: { organizationId: true },
    });
    if (active) {
      return {
        organization: await this.get(user, active.organizationId),
        pendingApplication: null,
        pendingJoin: null,
      };
    }

    const pendingApplication = await this.prisma.organization.findFirst({
      where: { ownerId: user.id, status: 'pending', surface: user.sessionSurface },
      select: { id: true },
    });
    const pendingJoin = await this.prisma.organizationMember.findFirst({
      where: {
        userId: user.id,
        status: { in: ['pending', 'invited'] },
        organization: { surface: user.sessionSurface },
      },
      select: { organizationId: true },
    });
    return {
      organization: null,
      pendingApplication: pendingApplication
        ? await this.get(user, pendingApplication.id)
        : null,
      pendingJoin: pendingJoin ? await this.get(user, pendingJoin.organizationId) : null,
    };
  }

  /** Sprint 7.1：环带个人组织中心，可同时展示多个 active 组织。 */
  async getMineAll(user: AuthUser): Promise<{
    organizations: OrganizationView[];
    pendingApplication: OrganizationView | null;
    pendingJoin: OrganizationView | null;
  }> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId: user.id,
        status: 'active',
        organization: { status: 'active', surface: user.sessionSurface },
      },
      select: { organizationId: true },
      orderBy: { joinedAt: 'asc' },
    });
    const organizations = await Promise.all(
      memberships.map((membership) => this.get(user, membership.organizationId)),
    );
    const pendingApplication = await this.prisma.organization.findFirst({
      where: { ownerId: user.id, status: 'pending', surface: user.sessionSurface },
      select: { id: true },
    });
    const pendingJoin = await this.prisma.organizationMember.findFirst({
      where: {
        userId: user.id,
        status: { in: ['pending', 'invited'] },
        organization: { surface: user.sessionSurface },
      },
      select: { organizationId: true },
    });
    return {
      organizations,
      pendingApplication: pendingApplication ? await this.get(user, pendingApplication.id) : null,
      pendingJoin: pendingJoin ? await this.get(user, pendingJoin.organizationId) : null,
    };
  }

  async list(user: AuthUser): Promise<{
    organizations: Array<
      Pick<OrganizationView, 'id' | 'name' | 'summary' | 'status' | 'surface' | 'memberCount' | 'myRole' | 'myStatus' | 'createdAt'>
    >;
  }> {
    const rows = await this.prisma.organization.findMany({
      where: { status: 'active', surface: user.sessionSurface, isPublic: true },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        summary: true,
        status: true,
        surface: true,
        isPublic: true,
        joinType: true,
        createdAt: true,
        _count: { select: { members: { where: { status: 'active' } } } },
        members: { where: { userId: user.id }, select: { role: true, status: true } },
      },
    });
    return {
      organizations: rows.map((row) => ({
        id: row.id,
        name: row.name,
        summary: row.summary,
        status: row.status,
        surface: row.surface,
        isPublic: row.isPublic,
        joinType: row.joinType,
        memberCount: row._count.members,
        myRole: (row.members[0]?.role as OrganizationView['myRole']) ?? null,
        myStatus: (row.members[0]?.status as OrganizationView['myStatus']) ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async get(user: AuthUser, organizationId: string): Promise<OrganizationView> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        owner: { select: { id: true, handle: true, displayName: true, tags: true, globalRole: true } },
        members: {
          where: { status: { in: ['active', 'pending', 'invited'] } },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }, { requestedAt: 'asc' }],
          include: {
            user: { select: { id: true, handle: true, displayName: true, avatarFileId: true } },
          },
        },
        _count: { select: { members: { where: { status: 'active' } } } },
      },
    });
    if (!org) throw new AppError(ErrorCode.ORGANIZATION_NOT_FOUND);

    const mine = org.members.find((member) => member.user.id === user.id) ?? null;
    const isActive = mine?.status === 'active';
    const isAdmin = isActive && (mine.role === 'owner' || mine.role === 'admin');
    const canSeePrivate = isActive;

    const base: OrganizationView = {
      id: org.id,
      name: org.name,
      summary: org.summary,
      status: org.status,
      surface: org.surface,
      isPublic: org.isPublic,
      joinType: org.joinType,
      ownerId: org.ownerId,
      ownerHandle: org.owner.handle,
      ownerDisplayName: org.owner.displayName,
      ownerPrefixes: await this.identity.prefixesFor(org.ownerId),
      myRole: (mine?.role as OrganizationView['myRole']) ?? null,
      myStatus: (mine?.status as OrganizationView['myStatus']) ?? null,
      memberCount: org._count.members,
      createdAt: org.createdAt.toISOString(),
      reviewedAt: org.reviewedAt?.toISOString() ?? null,
      rejectReason: org.rejectReason,
    };
    if (!canSeePrivate) return base;

    const memberViews = await this.memberViews(org.members);
    const channels = await this.channelViews(org.id);
    return {
      ...base,
      members: memberViews.filter((member) => member.status === 'active'),
      channels,
      ...(isAdmin
        ? { pendingRequests: memberViews.filter((member) => member.status === 'pending') }
        : {}),
    };
  }

  async apply(user: AuthUser, dto: CreateOrganizationDto): Promise<OrganizationView> {
    this.assertNotGlobalOwner(user, '全站 Owner 不参与组织，以保持私密频道边界');
    const owned = await this.prisma.organization.findFirst({
      where: { ownerId: user.id, status: { in: ['pending', 'active'] } },
      select: { id: true },
    });
    if (owned) {
      throw new AppError(ErrorCode.ORGANIZATION_CONFLICT, '你已有待审或在册组织');
    }
    const pending = await this.prisma.organizationMember.findFirst({
      where: { userId: user.id, status: { in: ['pending', 'invited'] } },
      select: { id: true },
    });
    if (pending) {
      throw new AppError(ErrorCode.ORGANIZATION_CONFLICT, '你已有待处理的组织申请');
    }
    const nameTaken = await this.prisma.organization.findFirst({
      where: { name: dto.name, status: { in: ['pending', 'active', 'suspended'] } },
      select: { id: true },
    });
    if (nameTaken) {
      throw new AppError(ErrorCode.ORGANIZATION_CONFLICT, '该组织名已被占用', { field: 'name' });
    }

    const org = await this.prisma.withTransaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: dto.name,
          slug: `org-${randomUUID().slice(0, 8)}`,
          isPublic: dto.isPublic ?? true,
          joinType: dto.joinType ?? 'apply',
          summary: dto.summary,
          status: 'pending',
          surface: user.sessionSurface,
          ownerId: user.id,
        },
      });
      await tx.organizationMember.create({
        data: {
          organizationId: created.id,
          userId: user.id,
          role: 'owner',
          status: 'pending',
        },
      });
      return created;
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ORG_APPLY,
      targetKind: 'organization',
      targetId: org.id,
      meta: { name: org.name },
    });
    return this.get(user, org.id);
  }

  async join(user: AuthUser, organizationId: string, dto: JoinOrganizationDto): Promise<OrganizationView> {
    this.assertNotGlobalOwner(user, '全站 Owner 不加入组织，以保持私密频道边界');
    const org = await this.orgOrThrow(organizationId);
    if (org.status !== 'active' || org.surface !== user.sessionSurface) {
      throw new AppError(ErrorCode.ORGANIZATION_CONFLICT, '该组织当前不接受加入申请');
    }
    const existing = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    if (existing?.status === 'active' || existing?.status === 'pending' || existing?.status === 'invited') {
      throw new AppError(ErrorCode.ORGANIZATION_CONFLICT, '你已在该组织中或已有待处理申请');
    }
    if (existing?.status === 'banned') {
      throw new AppError(ErrorCode.FORBIDDEN, '你已被该组织封禁');
    }
    if (org.joinType === 'invite') {
      throw new AppError(ErrorCode.FORBIDDEN, '该组织仅限邀请加入');
    }
    const immediate = org.joinType === 'open';
    const now = new Date();

    await this.prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      create: {
        organizationId,
        userId: user.id,
        role: 'member',
        status: immediate ? 'active' : 'pending',
        requestNote: dto.note ?? null,
        joinedAt: immediate ? now : null,
      },
      update: {
        role: 'member',
        status: immediate ? 'active' : 'pending',
        joinedAt: immediate ? now : null,
        requestNote: dto.note ?? null,
        requestedAt: now,
        reviewedAt: immediate ? now : null,
        reviewedBy: null,
        leftAt: null,
      },
    });

    if (immediate) {
      const channels = await this.prisma.channel.findMany({
        where: { organizationId, archivedAt: null },
        select: { id: true },
      });
      if (channels.length > 0) {
        await this.prisma.channelMember.createMany({
          data: channels.map((channel) => ({ channelId: channel.id, userId: user.id, role: 'member' })),
          skipDuplicates: true,
        });
      }
    }
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ORG_JOIN_REQUEST,
      targetKind: 'organization',
      targetId: organizationId,
      meta: { note: dto.note ?? null },
    });
    return this.get(user, organizationId);
  }

  async leave(user: AuthUser, organizationId: string): Promise<{ left: true }> {
    const member = await this.assertActiveMember(user, organizationId);
    if (member.role === 'owner') {
      throw new AppError(ErrorCode.ORGANIZATION_CONFLICT, '组织 Owner 需先转让或解散组织');
    }
    const channels = await this.prisma.channel.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true },
    });
    await this.prisma.withTransaction(async (tx) => {
      await tx.organizationMember.update({
        where: { id: member.id },
        data: { status: 'left', leftAt: new Date() },
      });
      await tx.channelMember.deleteMany({
        where: { userId: user.id, channelId: { in: channels.map((channel) => channel.id) } },
      });
      await tx.user.updateMany({
        where: { id: user.id, displayOrganizationId: organizationId },
        data: { displayOrganizationId: null },
      });
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ORG_LEAVE,
      targetKind: 'organization',
      targetId: organizationId,
    });
    return { left: true };
  }

  async transfer(
    user: AuthUser,
    organizationId: string,
    dto: TransferOrganizationDto,
  ): Promise<OrganizationView> {
    const member = await this.assertOrgOwner(user, organizationId);
    if (dto.userId === user.id) throw new AppError(ErrorCode.VALIDATION_FAILED, '不能转让给自己');
    const target = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: dto.userId } },
      include: { user: { select: { handle: true } } },
    });
    if (!target || target.status !== 'active') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, '目标必须是该组织的在册成员');
    }
    const channels = await this.prisma.channel.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true },
    });
    await this.prisma.withTransaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { ownerId: dto.userId },
      });
      await tx.organizationMember.update({
        where: { id: member.id },
        data: { role: 'admin' },
      });
      await tx.organizationMember.update({
        where: { id: target.id },
        data: { role: 'owner' },
      });
      for (const channel of channels) {
        await tx.channelMember.updateMany({
          where: { channelId: channel.id, userId: dto.userId },
          data: { role: 'moderator' },
        });
      }
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ORG_TRANSFER,
      targetKind: 'organization',
      targetId: organizationId,
      meta: { to: target.user.handle },
    });
    return this.get(user, organizationId);
  }

  async dissolve(user: AuthUser, organizationId: string): Promise<{ dissolved: true }> {
    await this.assertOrgOwner(user, organizationId);
    const channels = await this.prisma.channel.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true },
    });
    await this.prisma.withTransaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { status: 'dissolved', dissolvedAt: new Date() },
      });
      await tx.organizationMember.updateMany({
        where: { organizationId, status: 'active' },
        data: { status: 'left', leftAt: new Date() },
      });
      await tx.channel.updateMany({
        where: { organizationId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      await tx.user.updateMany({
        where: { displayOrganizationId: organizationId },
        data: { displayOrganizationId: null },
      });
    });
    this.realtime.broadcast('channel:updated', {
      channels: channels.map((channel) => ({ id: channel.id, archived: true })),
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ORG_DISSOLVE,
      targetKind: 'organization',
      targetId: organizationId,
    });
    return { dissolved: true };
  }

  // ── 全站 Owner 审批 ───────────────────────────────────────────────────────

  async listPending(user: AuthUser): Promise<{ organizations: OrganizationView[] }> {
    this.assertGlobalOwner(user);
    const rows = await this.prisma.organization.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const organizations = await Promise.all(rows.map((row) => this.get(user, row.id)));
    return { organizations };
  }

  async review(
    user: AuthUser,
    organizationId: string,
    dto: ReviewOrganizationDto,
  ): Promise<OrganizationView> {
    this.assertGlobalOwner(user);
    const org = await this.orgOrThrow(organizationId);
    if (org.status !== 'pending') {
      throw new AppError(ErrorCode.ORGANIZATION_CONFLICT, '该组织已不在待审状态');
    }

    if (dto.action === 'reject') {
      await this.prisma.withTransaction(async (tx) => {
        await tx.organization.update({
          where: { id: organizationId },
          data: {
            status: 'rejected',
            reviewedBy: user.id,
            reviewedAt: new Date(),
            rejectReason: dto.reason ?? null,
          },
        });
        await tx.organizationMember.updateMany({
          where: { organizationId, status: 'pending' },
          data: { status: 'rejected', reviewedBy: user.id, reviewedAt: new Date() },
        });
      });
      await this.audit.record({
        actorId: user.id,
        action: AuditAction.ORG_REVIEW,
        targetKind: 'organization',
        targetId: organizationId,
        meta: { action: 'reject', reason: dto.reason ?? null },
      });
      return this.get(user, organizationId);
    }

    const channel = await this.prisma.withTransaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { status: 'active', reviewedBy: user.id, reviewedAt: new Date() },
      });
      await tx.organizationMember.updateMany({
        where: { organizationId, status: 'pending' },
        data: {
          status: 'active',
          reviewedBy: user.id,
          reviewedAt: new Date(),
          joinedAt: new Date(),
        },
      });
      const created = await tx.channel.create({
        data: {
          name: `[${org.name}] 议事厅`,
          slug: `${org.slug}-hall`,
          topic: `${org.name} 的内部议事频道`,
          visibility: 'private',
          kind: 'channel',
          surface: user.sessionSurface,
          organizationId,
          position: 0,
          createdBy: org.ownerId,
        },
      });
      await tx.channelMember.create({
        data: { channelId: created.id, userId: org.ownerId, role: 'moderator' },
      });
      return created;
    });
    this.realtime.broadcast('channel:created', {
      channel: { id: channel.id, name: channel.name, slug: channel.slug, visibility: 'private' },
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ORG_REVIEW,
      targetKind: 'organization',
      targetId: organizationId,
      meta: { action: 'approve', channelId: channel.id },
    });
    return this.get(user, organizationId);
  }

  // ── 组织内成员审批 ────────────────────────────────────────────────────────

  async listJoinRequests(user: AuthUser, organizationId: string): Promise<{ requests: OrgMemberView[] }> {
    await this.assertOrgAdmin(user, organizationId);
    const rows = await this.prisma.organizationMember.findMany({
      where: { organizationId, status: 'pending' },
      orderBy: { requestedAt: 'asc' },
      include: {
        user: { select: { id: true, handle: true, displayName: true, avatarFileId: true } },
      },
    });
    return { requests: await this.memberViews(rows) };
  }

  async reviewJoinRequest(
    user: AuthUser,
    organizationId: string,
    targetUserId: string,
    dto: ReviewMemberDto,
  ): Promise<{ reviewed: true }> {
    await this.assertOrgAdmin(user, organizationId);
    const target = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });
    if (!target || target.status !== 'pending') {
      throw new AppError(ErrorCode.ORGANIZATION_CONFLICT, '该申请已不在待审状态');
    }

    if (dto.action === 'reject') {
      await this.prisma.organizationMember.update({
        where: { id: target.id },
        data: {
          status: 'rejected',
          reviewedBy: user.id,
          reviewedAt: new Date(),
          requestNote: target.requestNote,
        },
      });
    } else {
      const channels = await this.prisma.channel.findMany({
        where: { organizationId, archivedAt: null },
        select: { id: true },
      });
      await this.prisma.withTransaction(async (tx) => {
        await tx.organizationMember.update({
          where: { id: target.id },
          data: {
            status: 'active',
            reviewedBy: user.id,
            reviewedAt: new Date(),
            joinedAt: new Date(),
          },
        });
        await tx.channelMember.createMany({
          data: channels.map((channel) => ({
            channelId: channel.id,
            userId: targetUserId,
            role: 'member' as const,
          })),
          skipDuplicates: true,
        });
      });
    }
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ORG_JOIN_REVIEW,
      targetKind: 'organization',
      targetId: organizationId,
      meta: { userId: targetUserId, action: dto.action, reason: dto.reason ?? null },
    });
    return { reviewed: true };
  }

  // ── 组织频道 ──────────────────────────────────────────────────────────────

  async listChannels(user: AuthUser, organizationId: string): Promise<{ channels: OrgChannelView[] }> {
    await this.assertActiveMember(user, organizationId);
    return { channels: await this.channelViews(organizationId) };
  }

  async createChannel(
    user: AuthUser,
    organizationId: string,
    dto: CreateOrgChannelDto,
  ): Promise<OrgChannelView> {
    await this.assertOrgAdmin(user, organizationId);
    const org = await this.orgOrThrow(organizationId);
    if (org.status !== 'active') {
      throw new AppError(ErrorCode.ORGANIZATION_CONFLICT, '组织不在册，不能创建频道');
    }
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId, status: 'active' },
      select: { userId: true, role: true },
    });
    const channel = await this.prisma.withTransaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          name: dto.name,
          slug: `${org.slug}-${randomUUID().slice(0, 6)}`,
          topic: dto.topic ?? null,
          visibility: 'private',
          kind: 'channel',
          surface: org.surface,
          organizationId,
          position: 100,
          createdBy: user.id,
        },
      });
      await tx.channelMember.createMany({
        data: members.map((member) => ({
          channelId: created.id,
          userId: member.userId,
          role: member.role === 'member' ? ('member' as const) : ('moderator' as const),
        })),
        skipDuplicates: true,
      });
      return created;
    });
    this.realtime.broadcast('channel:created', {
      channel: { id: channel.id, name: channel.name, slug: channel.slug, visibility: 'private' },
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ORG_CHANNEL_CREATE,
      targetKind: 'channel',
      targetId: channel.id,
      meta: { organizationId, name: channel.name },
    });
    return this.channelView(channel, members.length);
  }

  async archiveChannel(
    user: AuthUser,
    organizationId: string,
    channelId: string,
  ): Promise<{ archived: true }> {
    const org = await this.orgOrThrow(organizationId);
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    const isOrgAdmin = Boolean(
      member?.status === 'active' && (member.role === 'owner' || member.role === 'admin'),
    );
    if (org.ownerId !== user.id && !isOrgAdmin) {
      throw new AppError(ErrorCode.FORBIDDEN, '仅组织 Owner/管理员可删除私有频道');
    }
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!channel) throw new AppError(ErrorCode.CHANNEL_NOT_FOUND, '组织频道不存在');
    await this.prisma.channel.update({
      where: { id: channelId },
      data: { archivedAt: new Date() },
    });
    this.realtime.broadcast('channel:updated', { channel: { id: channelId, archived: true } });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ORG_CHANNEL_ARCHIVE,
      targetKind: 'channel',
      targetId: channelId,
      meta: { organizationId },
    });
    return { archived: true };
  }

  // ── 内部工具 ──────────────────────────────────────────────────────────────

  private assertGlobalOwner(user: AuthUser): void {
    if (user.globalRole !== 'owner') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅全站 Owner 可审批组织');
    }
  }

  private assertNotGlobalOwner(user: AuthUser, message: string): void {
    if (user.globalRole === 'owner') throw new AppError(ErrorCode.FORBIDDEN, message);
  }

  private async orgOrThrow(id: string): Promise<Organization> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError(ErrorCode.ORGANIZATION_NOT_FOUND);
    }
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new AppError(ErrorCode.ORGANIZATION_NOT_FOUND);
    return org;
  }

  private async assertActiveMember(
    user: AuthUser,
    organizationId: string,
  ): Promise<OrganizationMember> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    if (!member || member.status !== 'active') {
      throw new AppError(ErrorCode.ORGANIZATION_NOT_FOUND);
    }
    return member;
  }

  private async assertOrgAdmin(
    user: AuthUser,
    organizationId: string,
  ): Promise<OrganizationMember> {
    const member = await this.assertActiveMember(user, organizationId);
    if (member.role !== 'owner' && member.role !== 'admin') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅组织 Owner/管理员可执行该操作');
    }
    return member;
  }

  private async assertOrgOwner(
    user: AuthUser,
    organizationId: string,
  ): Promise<OrganizationMember> {
    const member = await this.assertActiveMember(user, organizationId);
    if (member.role !== 'owner') {
      throw new AppError(ErrorCode.FORBIDDEN, '仅组织 Owner 可执行该操作');
    }
    return member;
  }

  private async memberViews(
    rows: Array<
      OrganizationMember & {
        user: { id: string; handle: string; displayName: string; avatarFileId: string | null };
      }
    >,
  ): Promise<OrgMemberView[]> {
    // 组织证章依赖成员行，系统证章依赖 users.tags/global_role；一起批量查，避免 N+1。
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((row) => row.user.id) } },
      select: { id: true, tags: true, globalRole: true },
    });
    const fullPrefixes = await this.identity.prefixesForMany(users);
    return rows.map((row) => ({
      userId: row.user.id,
      handle: row.user.handle,
      displayName: row.user.displayName,
      avatarFileId: row.user.avatarFileId,
      role: row.role,
      status: row.status,
      prefixes: fullPrefixes[row.user.id] ?? [],
      requestNote: row.requestNote,
      requestedAt: row.requestedAt.toISOString(),
      joinedAt: row.joinedAt?.toISOString() ?? null,
    }));
  }

  private async channelViews(organizationId: string): Promise<OrgChannelView[]> {
    const rows = await this.prisma.channel.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        topic: true,
        visibility: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
    });
    return rows.map((row) => this.channelView(row, row._count.members));
  }

  private channelView(
    row: { id: string; name: string; topic: string | null; visibility: 'public' | 'private'; createdAt: Date },
    memberCount: number,
  ): OrgChannelView {
    return {
      id: row.id,
      name: row.name,
      topic: row.topic,
      visibility: row.visibility,
      memberCount,
      archived: false,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
