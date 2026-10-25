# 文明环带 Phase A · 身份分面完成报告

日期：2026-10-24  
范围：A｜身份分面（数据库迁移、surface 字段、`is_internal` 触发器、handoff 权限守卫）  
未进入：B（组织与证章）、C（环带壳与内容）

## 1. 结论

A 阶段已完成并通过真实 API + 真实 PostgreSQL 验证：

- 内部/环带会话分面，默认 internal 守卫已生效。
- `users.tags` / `is_internal` / `account_origin` 已落库；`is_internal` 由触发器和 CHECK 双重强制。
- 现有真人账号回填 `[极光科技]`；机器人不回填。
- 内部 → 环带、环带 → 内部都走 60 秒单次交接码。
- 外网账号可注册、可登录环带，但无法登录内部、无法调用内部 API。
- 内部 API 按 `surface='internal'` 过滤频道/会话/朋友圈/搜索，防止后续环带数据混入。

## 2. Schema 变更

### 2.1 新增枚举

- `Surface`：`internal` / `belt`
- `ChannelSurface`：`internal` / `belt` / `bridge`
- `PostBoard`：`moments` / `bulletin` / `bounty` / `daily` / `telegraph`

### 2.2 `users`

新增：

- `tags text[] not null default '{}'`
- `is_internal boolean not null default false`
- `account_origin Surface not null default 'internal'`

数据库约束：

```sql
CHECK (is_internal = ('[极光科技]' = ANY(tags)))
```

并配套 `BEFORE INSERT OR UPDATE OF tags` 触发器同步 `is_internal`。  
索引：`users_tags_gin_idx`、`users_is_internal_idx`、`users_account_origin_idx`。

### 2.3 `sessions`

新增 `surface Surface not null default 'internal'`。  
索引：`(user_id, surface, revoked_at)`。

### 2.4 `channels`

新增 `surface ChannelSurface not null default 'internal'`。  
索引：`(surface, kind, position)`。

> 说明：`channels.dm_key` 仍是全局唯一。等 Phase D 引入环带 DM / bridge DM 时再改为 `(dm_key, surface)` 部分唯一；A 阶段没有环带 DM，先不动，避免无谓破坏现有幂等逻辑。

### 2.5 `posts`

新增：

- `surface Surface not null default 'internal'`
- `board PostBoard not null default 'moments'`

索引：`(surface, board, created_at desc)`。

## 3. 迁移与回填

迁移文件：[0009_identity_surface/migration.sql](../../server/prisma/migrations/0009_identity_surface/migration.sql)

回填结果（真实库）：

- 17 个频道全部 `surface='internal'`
- 5 条朋友圈全部 `surface='internal' / board='moments'`
- 现有真人账号 tags=`['[极光科技]']`、is_internal=true
- 机器人 tags=`[]`、is_internal=false
- 旧 sessions 全部 `surface='internal'`

## 4. 守卫与 handoff

### 4.1 默认 internal 守卫

新增 `SurfaceGuard`，注册在 `JwtAuthGuard` 之后、`RolesGuard` 之前：

- 未标注 `@Surface` 的受保护路由默认按 internal 处理。
- internal 路由必须同时满足：
  - `session.surface === 'internal'`
  - `user.isInternal === true`
- `@Surface('belt')` 只接受 belt 会话。
- `@Surface('bridge')` 预留给跨环带 DM。
- `is_internal` 每次从数据库回查，不信任 JWT 里的旧值。

关键文件：

- [surface.guard.ts](../../server/src/common/guards/surface.guard.ts)
- [jwt-auth.guard.ts](../../server/src/common/guards/jwt-auth.guard.ts)
- [context.ts](../../server/src/common/types/context.ts)

### 4.2 交接端点

| 端点 | 作用 | 守卫 |
|---|---|---|
| `POST /api/v1/access/belt/handoff` | 内部签发环带交接码 | internal + is_internal |
| `POST /api/v1/belt/auth/handoff/exchange` | 环带兑换交接码 | 公开 + 单次码 |
| `POST /api/v1/belt/access/internal/check` | 环带申请登入帝江号 | belt + is_internal |
| `POST /api/v1/auth/handoff/exchange` | 内部兑换交接码 | 公开 + 单次码 |

安全细节：

- Redis 存 60 秒单次码，Lua `GET + DEL` 原子消费。
- `next` 只允许目标面站内路径，防开放重定向。
- 交接码绑定 User-Agent 哈希。
- 拒绝事件写 `audit_logs`：`belt.access.denied`。
- 交接成功写 `handoff.issue` / `handoff.exchange`。

关键文件：

- [handoff.service.ts](../../server/src/auth/handoff.service.ts)
- [handoff.controller.ts](../../server/src/auth/handoff.controller.ts)
- [belt-auth.controller.ts](../../server/src/auth/belt-auth.controller.ts)

### 4.3 认证面

- 内部邀请注册：自动写入 `[极光科技]`、`account_origin=internal`。
- 环带自助注册：`POST /api/v1/belt/auth/register`，不消耗内部邀请码，`account_origin=belt`、tags 为空。
- 内部登录：密码通过后检查 `is_internal`；不满足返回 `403 PROTOCOL_DENIED`。
- 环带登录：允许内部/外网账号，但只签发 belt 会话。
- refresh 按会话面校验，内部 refresh 不能换环带会话，反之亦然。
- `/ws` 命名空间只接受 internal + is_internal 会话；环带 WS 留到 C。
- `displayName` / `statusPrefix` 增加反冒充校验：禁止方括号、`极光科技`、`Official` 等保留词。

## 5. 查询隔离

已加过滤：

- 频道可见性：`surface='internal'`
- 频道解析：非 internal 一律 `CHANNEL_NOT_FOUND`
- 会话列表：`surface='internal'`
- 会话解析/解散：`surface='internal'`
- 私聊/群聊创建：`surface='internal'`，且成员必须是内部账号
- 朋友圈列表/发帖/点赞/评论：`surface='internal'` + `board='moments'`
- 搜索可见频道：只取 internal
- 内部用户目录：只列 `isInternal=true`
- 内部会话可加成员：拒绝环带账号

## 6. 构建与测试

### 构建

```text
$ cd server && pnpm build
$ tsc -p tsconfig.build.json
exit 0

$ pnpm typecheck
$ tsc -p tsconfig.json --noEmit
exit 0
```

### 单测

```text
Test Files  17 passed (17)
Tests       173 passed (173)
```

### 真实链路验证

脚本：[phase-a.e2e.mjs](../../server/test/phase-a.e2e.mjs)

```text
PHASE_A_RESULT={"ok":true,"checks":25}
```

覆盖：

1. 内部登录、内部 `/channels` 200
2. 内部 → 环带 handoff 201
3. 环带兑换 200，用户仍 isInternal=true
4. belt token 调内部 `/channels` → 403 SURFACE_MISMATCH
5. 内部账号从环带登入 → check 200 → internal handoff 200 → 内部/`channels` 200
6. 外网注册 201，isInternal=false，accountOrigin=belt
7. 外网内部登录 → 403 PROTOCOL_DENIED
8. 外网环带登录 200
9. 外网登入帝江号 → 403 PROTOCOL_DENIED
10. DB 触发器：写入 `[极光科技]` → is_internal=true
11. DB 触发器：移除标签 → is_internal=false
12. 标签撤销后旧内部 token 立即 403 INTERNAL_ONLY
13. 交接码第二次兑换 401 HANDOFF_INVALID
14. refresh：内部 refresh 200；同一 refresh 调环带 refresh → 403 SURFACE_MISMATCH

### 运行态

- API：`http://127.0.0.1:3000`，`/readyz` 200（postgres/s3/redis 全 true）
- Web：`http://localhost:3100`，200
- 实际浏览器仍在正常拉取频道消息（服务日志可见），说明内部聊天未被 A 阶段破坏。

## 7. 已知边界 / 留给后续阶段

- 组织、好友、RSS、桥接表尚未创建（B/D/E）。
- 环带 `/belt` 页面尚未创建（C）。
- 环带 WS 命名空间尚未创建（C）。
- `channels.dm_key` 的 `(dm_key, surface)` 唯一约束留到 D。
- Owner `[极光科技]Official` 的全局证章与特效留到 B。
- 标签授予/撤销管理端点尚未提供；A 阶段通过内部邀请注册/数据库回填建立标签。
- `/users` 与 `/conversations/users` 暂时只列内部账号；B/C 需要时再补环带用户目录。
