import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface IdentityUser {
  id: string;
  tags: string[];
  globalRole: 'owner' | 'admin' | 'member';
  displayOrganizationId?: string | null;
}

export interface OrganizationIdentityChoice {
  organizationId: string;
  organizationName: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date | null;
}

const ROLE_WEIGHT: Record<OrganizationIdentityChoice['role'], number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/** 组织身份排序：组织 Owner > 组织管理员 > 普通成员；同权重按加入时间。 */
export function compareOrganizationIdentity(a: OrganizationIdentityChoice, b: OrganizationIdentityChoice): number {
  const byRole = ROLE_WEIGHT[b.role] - ROLE_WEIGHT[a.role];
  if (byRole !== 0) return byRole;
  const aJoined = a.joinedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bJoined = b.joinedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aJoined !== bJoined) return aJoined - bJoined;
  return a.organizationName.localeCompare(b.organizationName, 'zh-CN');
}

/** 显式选择优先；选择失效时回退权重最高的 active 组织。 */
export function pickOrganizationIdentity<T extends OrganizationIdentityChoice>(
  choices: readonly T[],
  preferredId: string | null | undefined,
): T | null {
  if (choices.length === 0) return null;
  if (preferredId) {
    const preferred = choices.find((choice) => choice.organizationId === preferredId);
    if (preferred) return preferred;
  }
  return [...choices].sort(compareOrganizationIdentity)[0] ?? null;
}

export function organizationPrefix(choice: OrganizationIdentityChoice): string {
  return `[${choice.organizationName}]${choice.role === 'owner' ? 'Official' : ''}`;
}

/**
 * 身份证章的唯一计算源。
 *
 * 证章顺序：系统身份在前，组织身份在后。
 * - 有 `[站长]` 标签 → `[站长]`；全站 Owner 追加 `Official`
 * - 多组织：优先 users.display_organization_id；未选择/失效时按
 *   组织 Owner > 组织管理员 > 普通成员 → 加入时间 自动选择**一个**组织前缀。
 *
 * 组织前缀不写回 users.tags，避免标签与组织成员行双写漂移。
 */
@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  /** 纯函数：不查库，供认证结果 / 测试 / 列表批量构建使用 */
  static systemPrefixes(user: Pick<IdentityUser, 'tags' | 'globalRole'>): string[] {
    if (!user.tags.includes('[站长]')) return [];
    return [user.globalRole === 'owner' ? '[站长]Official' : '[站长]'];
  }

  async prefixesFor(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tags: true, globalRole: true, displayOrganizationId: true },
    });
    if (!user) return [];
    const map = await this.prefixesForMany([user]);
    return map[userId] ?? IdentityService.systemPrefixes(user);
  }

  /**
   * 批量查询，避免成员列表 / 用户目录 N+1。
   * 每个用户返回：系统前缀 + 当前展示组织前缀（最多一个组织前缀）。
   */
  async prefixesForMany(users: readonly IdentityUser[]): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    if (users.length === 0) return result;

    for (const user of users) {
      result[user.id] = IdentityService.systemPrefixes(user);
    }
    const ids = [...new Set(users.map((user) => user.id))];
    const [memberships, displayRows] = await Promise.all([
      this.prisma.organizationMember.findMany({
        where: {
          userId: { in: ids },
          status: 'active',
          organization: { status: 'active' },
        },
        select: {
          userId: true,
          organizationId: true,
          role: true,
          joinedAt: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayOrganizationId: true },
      }),
    ]);

    const displayByUser = new Map(displayRows.map((row) => [row.id, row.displayOrganizationId]));
    const choicesByUser = new Map<string, OrganizationIdentityChoice[]>();
    for (const membership of memberships) {
      const list = choicesByUser.get(membership.userId) ?? [];
      list.push({
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        role: membership.role,
        joinedAt: membership.joinedAt,
      });
      choicesByUser.set(membership.userId, list);
    }

    for (const user of users) {
      const choices = choicesByUser.get(user.id) ?? [];
      const selected = pickOrganizationIdentity(choices, displayByUser.get(user.id));
      if (selected) result[user.id] = [...(result[user.id] ?? []), organizationPrefix(selected)];
    }
    return result;
  }
}
