# Sprint 7.1 · 环带个人中心与组织中心

日期：2026-10-25  
范围：外网用户资料（S3 头像/昵称）、组织中心、组织 Owner 审批与私有频道。

## Schema / 迁移

新增：

- [0016_organization_surface](../prisma/migrations/0016_organization_surface/migration.sql)
  - `organizations.surface`：`internal | belt`，历史组织默认 internal。
- [0017_org_belt_channels](../prisma/migrations/0017_org_belt_channels/migration.sql)
  - 组织私密频道 CHECK 放宽为 `surface IN ('internal','belt')`；
  - 仍强制 `visibility='private'`。

当前 **17 个迁移全部应用**。

## 后端

### 外网个人资料

- `GET /api/v1/belt/me`：补齐 `avatarFileId / statusPrefix`。
- `PATCH /api/v1/belt/me`：昵称、状态前缀、头像 fileId。
- `POST /api/v1/belt/files/avatar/presign`：头像 S3 直传签名，`channelId=null`。
- `POST /api/v1/belt/files/:id/complete`：复用文件魔数校验。
- `GET /api/v1/belt/files/:id/url`：头像签名 URL。

### 外网组织中心

- `GET /belt/organizations/mine`：多组织 active 列表 + pending application/join。
- `POST /belt/organizations`：发起组织申请（进入全站 Owner 审批流）。
- `POST /belt/organizations/:id/join`：申请加入。
- `GET /belt/organizations/:id/requests`：Owner/Admin 查看加入申请。
- `PATCH /belt/organizations/:id/requests/:userId`：通过/拒绝。
- `POST /belt/organizations/:id/channels`：创建组织私有频道。
- `GET /belt/organizations/:id/channels`：频道列表。
- `GET /belt/channels` 现在按组织成员过滤；组织私有频道只对成员可见。
- `GET /belt/channels/:id/messages` / `POST` 增加组织成员校验。
- `/ws/belt` 入房同样过滤私有组织频道，避免越权订阅。
- 组织频道继承组织 `surface`；环带组织频道为 `surface='belt'`。

## 前端

### `/belt/profile`

- 真实 S3 头像上传 + 预览。
- 昵称、状态前缀编辑。
- 显示已加入组织及角色。
- 390px 下修正了侧栏导航导致的横向溢出。

### `/belt/organizations`

- 当前已加入组织、角色、成员数、私有频道。
- 组织 Owner/Admin：
  - 加入申请审批（通过/拒绝）
  - 创建私有频道
  - 点击频道进入 `/belt/channel?channelId=…`
- 普通用户：
  - 发起组织申请
  - 查看待审批状态

导航新增 `06 个人中心`、`07 组织中心`。

## 验证

真实 API + PostgreSQL + S3：

```text
APPLIED ... pending
APPROVED active belt
JOIN_REQUESTED pending
OWNER_MINE {"channels":1,"pending":1}
AVATAR_NOTICE true
AVATAR_IMG 1
OWNER_PANEL true true
CHANNEL_CREATED true
REQUEST_CLEARED true
ORG_CHANNELS ["[星环社…] 议事厅","星环编辑室…"]
MEMBER_CHANNEL_VISIBLE true
SPRINT71_RESULT={"ok":true,...}
```

构建/测试：

```text
server build / typecheck -> exit 0
server tests             -> 18 files / 176 tests passed
web build                -> ✓ Compiled successfully
```

另外修正了 Sprint4 活动统计测试在 UTC 午夜边界的偶发失败（固定 UTC 正午时间）。

## 截图

- [个人中心](../frontend/sprint71-belt-profile-390.png)
- [组织中心 · Owner 审批与建频道](../frontend/sprint71-belt-organizations-390.png)
- [组织中心 · 审批/频道创建后](../frontend/sprint71-belt-organizations-after-390.png)

## 未完成

- Sprint 7.2：RSS 全文、category Tab、点赞/回波/转发。
- Sprint 7.3：IoT device bind/summary。
- Sprint 7.4：Webhook 插件系统。

测试组织、频道、外网账号已清理，org/user 计数为 0。
