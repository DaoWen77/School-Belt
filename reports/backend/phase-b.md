# 文明环带 Phase B · 组织与证章完成报告

日期：2026-10-25  
范围：B｜组织系统、组织私有频道、全局身份证章、Owner 审批  
未进入：C（环带壳与内容）

## 1. 结论

B 阶段完成并通过真实 API + 真实 PostgreSQL + 真实浏览器验证：

- 普通内部用户可以申请组织，全站 Owner 审批。
- 审批通过自动创建 `[组织名] 议事厅` 私有频道。
- 组织 Owner 获得 `[组织名]Official`，成员获得 `[组织名]`。
- 组织 Owner 保留 `[极光科技]` 系统证章；全站 Owner 显示 `[极光科技]Official`。
- 全站 Owner 不能申请/加入组织，也不能读组织频道消息。
- 组织频道只对 active 组织成员可见；非成员返回 404。
- 组织内支持加入审批、建私有频道、转让 Owner、解散。
- 证章已接入消息、侧边栏、Header、成员列表、设置页。

## 2. Schema 变更

迁移：[0010_organizations/migration.sql](../../server/prisma/migrations/0010_organizations/migration.sql)

新增枚举：

- `OrgStatus`：`pending / active / rejected / suspended / dissolved`
- `OrgMemberRole`：`owner / admin / member`
- `OrgMemberStatus`：`pending / invited / active / left / rejected / banned`

新增表：

### organizations

| 字段 | 说明 |
|---|---|
| `id` | uuid |
| `name` | citext；pending/active/suspended 下部分唯一 |
| `slug` | citext unique |
| `summary` | varchar(400) |
| `status` | 默认 pending |
| `owner_id` | 申请人 / 组织 Owner |
| `reviewed_by` / `reviewed_at` / `reject_reason` | 全站 Owner 审批 |
| `dissolved_at` | 解散时间 |

约束：

- `organizations_owner_pending_active_key`：一个 owner 只能有一个 pending/active 组织。
- `organizations_name_pending_active_key`：同名组织只在该状态下唯一；拒绝/解散后可重新申请。
- `name` 2–24 字符，`summary` 1–400 字符。

### organization_members

| 字段 | 说明 |
|---|---|
| `organization_id` / `user_id` | 唯一 |
| `role` | owner/admin/member |
| `status` | pending/invited/active/left/rejected/banned |
| `request_note` | 申请附言 |
| `invited_by` / `reviewed_by` | 邀请/审批人 |
| `requested_at` / `reviewed_at` / `joined_at` / `left_at` | 生命周期 |

约束：

- `organization_members_user_active_key`：一个用户同时只能有一个 active 组织。
- `organization_members_org_user_key`：组织内一人一行。

### channels

新增 `organization_id uuid null`：

- 非空必须是 `internal + private`。
- 组织频道只对 active 组织成员开放。
- 全站 Owner/Admin 不是成员时同样 404。

## 3. API

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/api/v1/organizations/mine` | 内部用户 |
| GET | `/api/v1/organizations` | 内部用户 |
| POST | `/api/v1/organizations` | 内部用户（非全站 Owner） |
| GET | `/api/v1/organizations/:id` | 内部用户；私密数据仅 active 成员 |
| POST | `/api/v1/organizations/:id/join` | 内部用户（非全站 Owner） |
| GET | `/api/v1/organizations/:id/requests` | 组织 Owner/管理员 |
| PATCH | `/api/v1/organizations/:id/requests/:userId` | 组织 Owner/管理员 |
| POST | `/api/v1/organizations/:id/leave` | 组织成员（Owner 除外） |
| POST | `/api/v1/organizations/:id/transfer` | 组织 Owner |
| POST | `/api/v1/organizations/:id/dissolve` | 组织 Owner |
| GET | `/api/v1/organizations/:id/channels` | 组织 active 成员 |
| POST | `/api/v1/organizations/:id/channels` | 组织 Owner/管理员 |
| DELETE | `/api/v1/organizations/:id/channels/:channelId` | 组织 Owner/管理员 |
| GET | `/api/v1/organizations/pending` | 全站 Owner |
| PATCH | `/api/v1/organizations/:id/review` | 全站 Owner |

关键行为：

- 审批通过事务内更新组织/成员，并创建默认私有频道、加入组织 Owner 为 moderator。
- 成员审批通过后加入该组织全部私有频道。
- 退出组织时删除该组织频道的成员行；解散时归档全部组织频道。
- 组织频道创建后自动加入全部 active 成员，并通知 WS `channel:created`。
- 全站 Owner 不能申请/加入组织；只能审批和看元数据。

## 4. 身份证章

新增 `IdentityService`（全局 CommonModule）：

- 系统证章：`tags` 含 `[极光科技]` → `[极光科技]`；全站 Owner → `[极光科技]Official`。
- 组织证章：active 组织成员 → `[组织名]`；组织 Owner → `[组织名]Official`。
- 顺序：系统在前，组织在后。
- 不写回 `users.tags`，避免和成员行双写漂移。

投影已接入：

- `/me`、`/users`、`/conversations/users` 都返回 `prefixes`。
- 前端 `ApiUser` / `UserLite` / `ConversationMember` / `Member` 增加 `prefixes`。
- 消息、侧边栏、Header、成员列表、设置页统一使用 `IdentityBadges`。
- `statusPrefix` 仍作为自定义状态，不再冒充身份证章。

视觉：

- 全站 Owner：酸黄实底、墨色字、细扫描；只在 Header/个人页循环，消息列表只做一次性盖章。
- 组织 Owner：透明底 + 左侧酸黄块。
- 组织成员 / 自定义状态：灰/透明 chip，不与官方证章混淆。
- reduced-motion 下所有证章动画关闭。

## 5. 构建与测试

后端：

```text
pnpm build      -> exit 0
pnpm typecheck  -> exit 0
pnpm test       -> 17 files / 173 tests passed
```

前端：

```text
pnpm build
✓ Compiled successfully
/settings  11.6 kB
```

真实链路：

```text
PHASE_B_RESULT={"ok":true,"checks":48}
```

UI 证据：

```text
OWNER_BADGES ["[极光科技]Official", ...]
OWNER_ORG_HAS_PENDING true
MEMBER_ORG_HAS_PREFIX true
MEMBER_ORG_HAS_CHANNEL true
SIDEBAR_HAS_ORG_CHANNEL true
PHASE_B_UI_RESULT={"ok":true,...}
```

运行态：

- API `http://127.0.0.1:3000`，`/readyz` 200
- Web `http://127.0.0.1:3100`，200
- 10 个迁移全部应用，`prisma migrate status` up to date

## 6. 截图

- [Owner Header：全局 `[极光科技]Official`](../frontend/phase-b-owner-header-1440.png)
- [Owner 组织审批面板](../frontend/phase-b-owner-org-panel-1440.png)
- [组织 Owner 面板：`[组织]Official` + 私有频道 + 成员](../frontend/phase-b-member-org-panel-1440.png)
- [侧边栏组织频道：ORG + 私密](../frontend/phase-b-org-channel-sidebar-1440.png)
- [设置页 Owner 审批全页](../frontend/phase-b-owner-org-review-1440.png)
- [设置页组织 Owner 全页](../frontend/phase-b-member-org-1440.png)

## 7. 已知边界

- 组织审批/加入目前没有站内通知，UI 依赖设置页刷新；C 阶段可接通知中心。
- 组织 logo 字段已预留，但 B 阶段没有上传入口。
- 组织频道自动加入全部 active 成员；没有“单频道选择性加入”UI。满足“仅组织成员可见/加入”，但不是细粒度频道成员管理。
- `invited` 状态已在表中预留，B 阶段只实现申请制，没有邀请制入口。
- 消息列表的证章依赖 `/users` 目录结果；当前 9 个用户无问题。用户规模变大后应把 `prefixes` 直接并入消息 sender 投影。
- `channels.dm_key` 仍是全局唯一；Phase D 引入环带 DM / bridge DM 时改为 `(dm_key, surface)`。
- 组织改名未开放；`organizations.name` 变更需要单独审计/审批流程。
