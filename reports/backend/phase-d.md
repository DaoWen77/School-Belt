# 文明环带 Phase D · 好友链路与 DM 完成报告

日期：2026-10-25  
范围：D｜好友申请、同意/拒绝/拉黑、DM 创建门槛、跨环带 bridge DM、悬赏联络  
未进入：E（RSS / Outbox / System Bot 卡片）

## 1. 结论

D 阶段完成并通过真实 API + PostgreSQL + 浏览器验证：

- 所有 DM 必须先有 accepted 好友链路；未同意时直接建 DM 返回 403 `FRIENDSHIP_REQUIRED`。
- 同意后才创建 DM，并出现在发起方/接收方侧边栏。
- 群聊完全不受好友限制。
- 悬赏【建立联络】会发起带 `contextPostId` 的好友申请。
- 内部 ↔ 外部的跨面申请只允许从悬赏上下文发起，生成 `surface='bridge'` DM。
- bridge DM 双方可读写：内部走 `/channels/:id/messages`，外环走 `/belt/conversations/:id/messages`。
- 解除好友后 DM 变只读；再次发送返回 403。
- `channels.dm_key` 唯一性改为 `(dm_key, surface)`。

## 2. 数据库

主迁移：[0012_friendships/migration.sql](../../server/prisma/migrations/0012_friendships/migration.sql)  
修复迁移：[0013_friend_backfill_repair/migration.sql](../../server/prisma/migrations/0013_friend_backfill_repair/migration.sql)

新增 `FriendshipStatus`：

`pending / accepted / rejected / blocked / removed`

新增 `friendships`：

- `requester_id` / `addressee_id`
- `status`
- `surface`：`internal / belt / bridge`
- `context_post_id`：悬赏上下文
- `request_note`
- `dm_channel_id` unique
- `blocked_by`
- `requested_at / responded_at / created_at / updated_at`

约束：

- `UNIQUE (LEAST(requester_id, addressee_id), GREATEST(...))`：一对用户只有一条关系。
- `dm_channel_id` 唯一。
- `channels.dm_key` 从全局唯一改为 `(dm_key, surface)` 部分唯一。
- 历史 2 人 DM 回填 accepted 好友关系。
- 0013 修复旧测试数据中“3 人 DM + bot”导致的错误回填：先剔除坏好友行，再移除多人 DM 中的 bot，最后只回填严格 2 人 DM。

验证后当前库为 3 条正确的历史 accepted 关系；无 bridge 频道、无 D 测试悬赏、无测试外网账号。

## 3. 后端

新增 `FriendshipsModule`：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/friendships` | 好友/收到/发出/阻断 |
| POST | `/api/v1/friendships/requests` | 内部好友申请 |
| PATCH | `/api/v1/friendships/:id` | accept / reject / block |
| DELETE | `/api/v1/friendships/:id` | 解除 |
| GET | `/api/v1/belt/friendships` | 环带好友列表 |
| POST | `/api/v1/belt/friendships/requests` | 环带好友申请 |
| PATCH | `/api/v1/belt/friendships/:id` | 环带 accept/reject/block |
| DELETE | `/api/v1/belt/friendships/:id` | 环带解除 |
| GET | `/api/v1/belt/conversations` | 环带/bridge 私聊列表 |
| GET | `/api/v1/belt/conversations/:id/messages` | 环带/bridge 消息 |
| POST | `/api/v1/belt/conversations/:id/messages` | 发送 |

规则：

- 内部账号之间：internal 好友；必须从内部会话发起。
- 外网账号之间：belt 好友；必须从环带会话发起。
- 跨面：必须带 `contextPostId`，且帖子必须是 `surface='belt' / board='bounty' / author=目标用户`。
- 同意事务内创建 DM；桥接 DM 的 `surface='bridge'`。
- `MessagesService` 对所有 DM 发消息增加 `assertDmWritable`，group/channel 不受影响。
- `ChannelAccessService` 允许 bridge DM 的 accepted 好友成员读写；普通组织/环带频道仍按原规则。
- bridge 内部侧消息会补投到 belt WS 用户房间；外环侧消息会补投到内部 `message:new`，实现双向实时。

## 4. 前端

### 内部

- 设置新增【好友】Tab：
  - 精确 handle 申请
  - 收到 / 发出 / 已建立 / 阻断
  - 同意、拒绝、阻断、解除
- 原“新建私聊”改为“发起好友链路”：
  - 不再直接创建会话
  - 发送后提示等待对方同意
- 内部侧边栏：
  - 新 DM 只有同意后才出现
  - bridge DM 显示 `BRIDGE · @handle`
- bridge DM 使用现有内部消息界面；好友关系失效后发送被拦截。

### 环带

- 新增 `/belt/direct` 和导航第 06 项【私聊链路】。
- 页面包含：
  - 好友申请（精确 handle）
  - 收到申请：同意 / 拒绝
  - 已建立私聊列表
  - bridge/belt 标记
  - 私聊消息面板
- 悬赏详情【建立联络】现在真实发起：
  - 带 `contextPostId`
  - 成功显示“链路申请已发出”
  - 对方同意后才出现私聊
- 环带 WS 增加 `belt:dm:message` / `belt:conversation` 事件。

## 5. 验证

### 构建

```text
server pnpm build      -> exit 0
server pnpm typecheck  -> exit 0
server pnpm test       -> 17 files / 173 tests passed

web pnpm build
✓ Compiled successfully
/belt/direct   129 kB first load
/settings      123 kB
```

### 真实 API

```text
PHASE_D_RESULT={"ok":true,"checks":29}
```

覆盖：

- 未同意前直接建 DM → 403 FRIENDSHIP_REQUIRED
- 内部申请 → incoming → 同意 → DM 双方可见
- 好友 DM 发送成功
- 解除好友后发送 → 403
- 悬赏上下文跨面申请 → surface=bridge
- 内部同意 bridge → DM 双方可见
- 外环发消息 → 内部可读
- 内部发消息 → 外环可读

### UI

```text
INCOMING_VISIBLE true
ACCEPTED_TEXT true
INTERNAL_DM_ID ba679947-...
INTERNAL_DM_VISIBLE true
CONTACT_REQUESTED true
INTERNAL_BRIDGE_VISIBLE true
BELT_DIRECT_VISIBLE true
BELT_BRIDGE_VISIBLE true
PHASE_D_UI_RESULT={"ok":true,...}
```

### 截图

- [内部好友申请（设置 → 好友）](../frontend/phase-d-internal-friend-incoming-1440.png)
- [同意后 DM 进入侧边栏](../frontend/phase-d-internal-dm-sidebar-1440.png)
- [悬赏详情建立联络](../frontend/phase-d-bounty-contact-1440.png)
- [内部侧 bridge DM](../frontend/phase-d-internal-bridge-sidebar-1440.png)
- [环带私聊链路页](../frontend/phase-d-belt-direct-1440.png)

## 6. 运行态

- API `3000`、Web `3100`、PG `55432`、Redis `6379`、S3 `9000`
- `/readyz` 200
- 13 个迁移全部应用
- 测试产生的 DM、bridge、悬赏、外网账号已清理

## 7. 已知边界

- 好友申请没有站内通知；内部/环带页面通过重新进入设置或私聊页看到。
- 环带私聊实时是“发送方本地追加 + WS 事件”；内部侧已有 `message:new`，外环侧接 `belt:dm:message`。
- 没有好友搜索目录；按精确 handle 申请，降低外网骚扰。
- 群聊继续走原成员权限，不受好友关系限制。
- 解除好友后 DM 不物理删除，仅变只读；当前 UI 会从活跃列表移除。
- 跨面申请的唯一入口是悬赏；普通跨面好友搜索被 `CROSS_SURFACE_DENIED` 拦截。
- 没有消息通知、未读数、好友申请红点；这些留给 E 之后的体验层。
