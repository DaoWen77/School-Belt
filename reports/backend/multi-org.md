# 扩展模块 1 · 多组织身份

日期：2026-10-25  
范围：移除单 active 组织约束、增加展示组织选择、前端身份切换。

## Schema

迁移：[0015_multi_organization](../prisma/migrations/0015_multi_organization/migration.sql)

- 删除 `organization_members_user_active_key`（一个用户只能有一个 active 组织）。
- `users.display_organization_id uuid NULL`，FK `organizations(id) ON DELETE SET NULL`。
- 保留 `organization_members (organization_id, user_id)` 唯一，防同组织重复行。
- 保留 `organizations_owner_pending_active_key`：同一 owner 仍只能有一个在册组织。

Prisma：

```prisma
model User {
  displayOrganizationId String? @map("display_organization_id") @db.Uuid
  @@index([displayOrganizationId])
}
```

## 身份选择

`IdentityService`：

- 系统前缀仍为第一段。
- 组织前缀只显示**一个**：
  - 优先 `users.display_organization_id`；
  - 失效/未选择时按组织 `owner > admin > member`，同权重按加入时间。
- 组织 Owner 前缀带 `Official`。
- 批量接口仍避免 N+1，额外批量读取用户展示组织。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/me/organizations` | 可展示组织列表、默认、当前 |
| PATCH | `/api/v1/me/display-organization` | `{ organizationId: uuid \| null }` |

后端同时移除了 `OrganizationsService` 中的 `assertNoActiveMembership`，允许同时拥有多个 active 组织成员行；仍保留“一个 owner 只能有一个在册组织”的限制。

## 前端

设置 → 资料 → 【当前展示身份】：

- 下拉选项：自动（权重最高）+ 每个 active 组织。
- 切换后调用 PATCH，服务端写入 `display_organization_id`。
- 页面重载后，设置页、侧边栏、消息前缀统一使用新组织前缀。
- 无组织时显示空态。

## 验证

真实 API + PostgreSQL：

```text
PREFIX_BEFORE ["[极光科技]","[测绘组…]Official"]
PREFIX_AFTER  ["[极光科技]","[新闻部…]"]
WORKSPACE_PREFIX_B true
MULTI_ORG_RESULT={"ok":true,...}
```

构建：

```text
server pnpm build      -> exit 0
server pnpm typecheck  -> exit 0
server pnpm test       -> 18 files / 176 tests passed
web pnpm build         -> ✓ Compiled successfully
```

数据库：15 个迁移全部应用。测试组织与成员行已删除，chen 的展示组织已恢复 null。

## 截图

- [切换前：默认组织 Owner 身份](../frontend/multi-org-before-switch.png)
- [切换后：新闻部成员身份](../frontend/multi-org-after-switch.png)

## 未执行

新闻塔 category/Bento 重构尚未落库；等待数据结构与预置源确认。  
Webhook 插件系统、ESP32 device API 尚未开发。
