# 契约冻结版 v1 · O.M.V 帝江号 · 全域广播

> 本文件是唯一事实源（Single Source of Truth）。设计文档、迁移 SQL、NestJS 实现、UI 静态稿、验收用例都以此为准。
> 任何偏离必须先改本文件并升版本号。

- 版本：v1.0（冻结）
- 冻结时间：2026-10-22
- 代号：DIJIANG / 帝江号
- 协议叙事：终末地工业《第三协议·协作条款》

---

## 0. 术语与命名

| 中文 | 英文 / 代码 | 说明 |
| --- | --- | --- |
| 全域广播 | broadcast | 整个社区（单租户实例） |
| 频道 | channel | 广播下的分组；公开 / 私密 |
| 信号 | signal | 一条消息（含线程内回复） |
| 卡片 | card | 素材 / 灵感 / 投票 / 任务 / 作品 的统一模型 |
| 素材库 | archive | 频道级文件库，卡片视图 kind=material |
| 灵感墙 | ideaboard | 看板视图 kind=idea |
| 作品墙 | showcase | 画廊视图 kind=artwork |
| 档案员 | archivist | 频道 moderator 的界面称呼 |
| 协议官 | protocol officer | 全站 admin 的界面称呼 |
| 建立者 | founder | 全站 owner 的界面称呼 |

代码、数据库、API 一律用英文标识；界面文案用上表中文。叙事口吻为“工业协议 / 调度记录”，不写风格词。

---

## 1. 枚举

```ts
GlobalRole   = 'owner' | 'admin' | 'member'
UserStatus   = 'active' | 'suspended'
ChannelRole  = 'member' | 'moderator'
Visibility   = 'public' | 'private'
NotifyLevel  = 'all' | 'mentions' | 'none'
MessageKind  = 'text' | 'image' | 'file' | 'card' | 'system'
CardKind     = 'material' | 'idea' | 'vote' | 'task' | 'artwork'
CardStatus   = 'open' | 'done' | 'closed' | 'archived'
TaskStatus   = 'todo' | 'doing' | 'done'
FileKind     = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other'
FileStatus   = 'pending' | 'ready' | 'rejected' | 'deleted'
PreviewStatus= 'none' | 'pending' | 'ready' | 'failed'
NotificationType = 'mention' | 'thread_reply' | 'card_assigned' | 'card_due'
                 | 'vote_closed' | 'invite_accepted' | 'system'
PushStatus   = 'pending' | 'sent' | 'failed' | 'skipped'
Platform     = 'web' | 'android'
```

---

## 2. 表结构（18 张）

所有表默认 `id uuid default gen_random_uuid()`，除特别说明。所有时间 `timestamptz`。软删除仅用于 messages / cards / files。启用扩展：`citext`、`pg_trgm`、`pgcrypto`。

### 2.1 users
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| handle | citext UNIQUE | 登录名，3–24，`^[a-z0-9_]+$` |
| display_name | varchar(40) | 显示名 |
| password_hash | text | argon2id |
| avatar_file_id | uuid NULL → files.id | |
| global_role | GlobalRole | default member |
| status | UserStatus | default active |
| muted_until | timestamptz NULL | 全站禁言截止 |
| created_at / updated_at / last_seen_at | timestamptz | |

索引：`UNIQUE(handle)`；`(status)`。

### 2.2 user_settings（1:1）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| user_id | uuid PK → users.id ON DELETE CASCADE | |
| locale | varchar(8) | default `zh-CN` |
| theme | text | `light|dark|system`，default system |
| notify_level | NotifyLevel | 全站默认，default all |
| dnd_enabled | bool | default false |
| dnd_start / dnd_end | time | 免打扰时段（本地时区） |
| timezone | text | IANA，default `Asia/Shanghai` |
| push_web / push_android | bool | default true |
| digest_window | int | 聚合窗口秒，default 300 |
| updated_at | timestamptz | |

### 2.3 devices
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid → users.id ON DELETE CASCADE | |
| platform | Platform | |
| name | varchar(60) | 设备名 |
| push_provider | text | `webpush|fcm` |
| push_token | text | Web Push endpoint / FCM token |
| push_keys | jsonb | `{p256dh, auth}`（webpush） |
| last_active_at / created_at | timestamptz | |

索引：`(user_id)`；`UNIQUE(platform, push_token)`。

### 2.4 sessions（refresh token 轮换）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid → users.id ON DELETE CASCADE | |
| token_hash | text UNIQUE | sha256(refresh token) |
| device_id | uuid NULL → devices.id | |
| ip | inet | |
| user_agent | text | |
| expires_at / revoked_at / created_at | timestamptz | |
| rotated_from | uuid NULL | 轮换链 |

索引：`(user_id, revoked_at)`；`UNIQUE(token_hash)`。

### 2.5 invites
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| code_hash | text UNIQUE | sha256(大写邀请码) |
| code_prefix | varchar(8) | 前 4 位，便于管理台识别 |
| created_by | uuid → users.id | |
| role | GlobalRole | 注册后角色，仅 member/admin |
| max_uses | int | default 1 |
| uses | int | default 0 |
| expires_at | timestamptz | default now()+7d |
| revoked_at | timestamptz NULL | |
| note | varchar(80) | 用途备注 |
| created_at | timestamptz | |

索引：`(created_by)`；`(expires_at)`。

### 2.6 channels
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| name | varchar(60) | |
| slug | citext UNIQUE | |
| topic | varchar(200) | |
| visibility | Visibility | default public |
| position | int | 侧栏排序 |
| created_by | uuid → users.id | |
| archived_at | timestamptz NULL | |
| created_at / updated_at | timestamptz | |

### 2.7 channel_members（复合主键）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| channel_id | uuid → channels.id ON DELETE CASCADE | |
| user_id | uuid → users.id ON DELETE CASCADE | |
| role | ChannelRole | default member |
| notify_level | NotifyLevel | 覆盖全站设置 |
| muted_until | timestamptz NULL | 频道内禁言 |
| last_read_seq | bigint | default 0，已读游标 |
| last_read_at | timestamptz | |
| joined_at | timestamptz | |

PK `(channel_id, user_id)`；索引 `(user_id)`。

### 2.8 messages
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | bigint GENERATED ALWAYS AS IDENTITY PK | 全域单调，即游标 |
| channel_id | uuid → channels.id | |
| sender_id | uuid → users.id | |
| kind | MessageKind | |
| body | text | ≤8000 字符；轻量 Markdown |
| client_msg_id | uuid | 幂等键（客户端生成） |
| parent_id | bigint NULL → messages.id | 线程内父信号 |
| thread_root_id | bigint NULL → messages.id | 线程根；根消息为 NULL |
| reply_to_id | bigint NULL → messages.id | 引用任意信号 |
| card_id | uuid NULL → cards.id | kind=card 时 |
| mentions | uuid[] | 被 @ 的用户 |
| thread_reply_count | int | 仅根消息维护，default 0 |
| last_reply_at | timestamptz NULL | 仅根消息维护 |
| edited_at / deleted_at | timestamptz NULL | |
| deleted_by | uuid NULL | |
| created_at | timestamptz | |
| search_vector | tsvector | 生成列，`to_tsvector('simple', coalesce(body,''))` |

约束：
- `UNIQUE(channel_id, sender_id, client_msg_id)`（幂等）
- `CHECK (kind IN (...))` 略，用枚举
- `CHECK (parent_id IS NULL OR thread_root_id IS NOT NULL)`
- 根消息 `thread_root_id IS NULL`；回复 `thread_root_id = 根 id` 且 `parent_id` 指向根（单层线程）

索引：
- `(channel_id, id DESC)` —— 主频道分页
- `(thread_root_id, id)` —— 线程分页
- `(sender_id, id DESC)`
- `GIN(search_vector)`
- `GIN(body gin_trgm_ops)` —— 中文子串兜底
- `GIN(mentions)` —— 我的提及
- `(card_id)`

### 2.9 reactions
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| message_id | bigint NULL → messages.id ON DELETE CASCADE | |
| card_id | uuid NULL → cards.id ON DELETE CASCADE | |
| user_id | uuid → users.id ON DELETE CASCADE | |
| emoji | varchar(32) | 单个 emoji |
| created_at | timestamptz | |

约束：`CHECK (num_nonnulls(message_id, card_id) = 1)`。
唯一：`UNIQUE(user_id, emoji, message_id) WHERE message_id IS NOT NULL`；`UNIQUE(user_id, emoji, card_id) WHERE card_id IS NOT NULL`。
索引：`(message_id)`；`(card_id)`。

### 2.10 files
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| owner_id | uuid → users.id | |
| channel_id | uuid NULL → channels.id | 素材库归属 |
| bucket | text | |
| storage_key | text UNIQUE | |
| original_name | varchar(255) | |
| mime | varchar(120) | 服务端嗅探结果 |
| kind | FileKind | |
| size_bytes | bigint | 服务端 HEAD 校验 |
| checksum_sha256 | char(64) NULL | 可选 |
| width / height | int NULL | 图片/视频 |
| duration_ms | int NULL | 音视频 |
| preview_key | text NULL | 缩略图对象键 |
| preview_status | PreviewStatus | default none |
| status | FileStatus | default pending |
| created_at | timestamptz | |

索引：`(channel_id, kind, created_at DESC)`；`(owner_id)`；`(status)`。

### 2.11 attachments
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| file_id | uuid → files.id ON DELETE CASCADE | |
| message_id | bigint NULL → messages.id ON DELETE CASCADE | |
| card_id | uuid NULL → cards.id ON DELETE CASCADE | |
| position | int | |
| created_at | timestamptz | |

约束：`CHECK (num_nonnulls(message_id, card_id) = 1)`。
唯一：`UNIQUE(file_id, message_id) WHERE message_id IS NOT NULL`；`UNIQUE(file_id, card_id) WHERE card_id IS NOT NULL`。
索引：`(message_id)`；`(card_id)`。

### 2.12 pins
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| channel_id | uuid → channels.id ON DELETE CASCADE | |
| message_id | bigint → messages.id ON DELETE CASCADE | |
| pinned_by | uuid → users.id | |
| created_at | timestamptz | |

PK `(channel_id, message_id)`；索引 `(channel_id, created_at DESC)`。

### 2.13 cards（素材/灵感/投票/任务/作品统一模型）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| channel_id | uuid → channels.id ON DELETE CASCADE | |
| kind | CardKind | |
| title | varchar(120) | |
| body | text | ≤4000 |
| color | varchar(16) | 灵感墙色标：`amber|teal|rose|violet|slate` |
| tags | text[] | 素材库标签 |
| position | double precision | 拖拽排序，default 1000 |
| status | CardStatus | default open |
| task_status | TaskStatus NULL | 仅 kind=task |
| due_at | timestamptz NULL | 任务截止 |
| closed_at | timestamptz NULL | 投票截止 / 归档 |
| message_id | bigint NULL → messages.id | 卡片在频道流里的消息 |
| source_card_id | uuid NULL → cards.id | 由哪张卡转换而来 |
| created_by | uuid → users.id | |
| data | jsonb | 投票配置等，default '{}' |
| created_at / updated_at / deleted_at | timestamptz | |

索引：`(channel_id, kind, position)`；`(channel_id, created_at DESC)`；`GIN(tags)`；`(message_id)`；`(source_card_id)`。
`data` 约定：
- vote：`{ multi: bool, anonymous: bool, closesAt: ISO|null, quorum?: int }`
- artwork：`{ coverFileId, caption }`
- material：`{ fileCount }`（真实计数，冗余便于列表渲染）

### 2.14 card_assignees
`card_id uuid`、`user_id uuid`、`assigned_by uuid`、`assigned_at`；PK `(card_id, user_id)`；索引 `(user_id)`。

### 2.15 vote_options
`id uuid`、`card_id uuid`、`label varchar(80)`、`position int`；`UNIQUE(card_id, position)`；索引 `(card_id)`。

### 2.16 vote_ballots
`id uuid`、`card_id uuid`、`option_id uuid → vote_options.id ON DELETE CASCADE`、`user_id uuid`、`created_at`；
`UNIQUE(card_id, option_id, user_id)`；索引 `(card_id)`、`(user_id)`。
匿名投票：不存展示映射，仅聚合计数；管理员也无法反查（接口层不返回 user_id）。

### 2.17 notifications
`id uuid`、`user_id uuid`、`type NotificationType`、`channel_id uuid NULL`、`message_id bigint NULL`、`card_id uuid NULL`、`title varchar(120)`、`body varchar(300)`、`payload jsonb`、`read_at timestamptz NULL`、`pushed_at`、`push_status PushStatus default pending`、`created_at`。
索引：`(user_id, read_at, created_at DESC)`；`(created_at)` 用于清理。

### 2.18 audit_logs
`id bigint IDENTITY`、`actor_id uuid NULL`、`action varchar(64)`、`target_kind varchar(32)`、`target_id text`、`meta jsonb`、`ip inet`、`created_at`。
索引：`(created_at DESC)`；`(actor_id, created_at DESC)`。

---

## 3. 游标与单调序

- 全域单序：`messages.id`（BIGINT IDENTITY）。
- 游标 = base64url(`seq:<id>`)；**不透明字符串**，客户端不得解析。
- 分页：`id < cursor` 向历史；`id > cursor` 向新（补拉）。
- 已读：`channel_members.last_read_seq = max(seq)`。
- 未读计数：`count(*) WHERE channel_id=? AND id > last_read_seq AND deleted_at IS NULL AND sender_id<>me`；50 人规模直接查询，配 `(channel_id, id)` 索引，不做 Redis 计数缓存。
- 补拉上限：单次 `limit ≤ 100`，默认 50。

---

## 4. 权限矩阵

| 操作 | owner | admin | member | 非成员 |
| --- | --- | --- | --- | --- |
| 读公开频道消息 | ✅ | ✅ | ✅ | ❌ |
| 读私密频道消息 | 仅本人是成员 | 仅本人是成员 | 仅本人是成员 | ❌ |
| 发消息 | ✅ | ✅ | 需频道成员 | ❌ |
| 编辑自己的消息 | ✅ | ✅ | ✅ | ❌ |
| 删除他人消息 | ✅ | ✅ | 仅频道 moderator | ❌ |
| 置顶 | ✅ | ✅ | 仅频道 moderator | ❌ |
| 建频道 | ✅ | ✅ | ❌ | ❌ |
| 管理频道成员 | ✅ | ✅ | 仅频道 moderator（不可移除 moderator） | ❌ |
| 创建邀请 | ✅ | ✅ | ❌ | ❌ |
| 封禁用户 / 改全站角色 | ✅ | 仅 member↔admin | ❌ | ❌ |
| 创建卡片 / 投票 / 任务 | ✅ | ✅ | 需频道成员 | ❌ |
| 删除他人卡片 | ✅ | ✅ | 仅频道 moderator 或卡片作者 | ❌ |
| 查看私密频道元数据 | ✅（列表可见名称，不可读消息） | ✅ | 仅成员 | ❌ |

规则：
1. 权限判定顺序：登录 → 全站封禁 → 频道可见性 → 频道成员 → 禁言 → 业务规则。
2. 私密频道内容对 owner/admin **默认不可见**（避免“管理员偷看”），仅在显式加入成员后可见。
3. moderator 是频道级角色，不可跨频道。
4. 禁言只拦“写”（发消息、建卡、投票、上传），不拦“读”。
5. 全站 owner 唯一；转让需显式接口，MVP 只允许 DB 运维操作。

---

## 5. 邀请码生命周期

`created`（仅哈希入库，明文只返回一次）→ `active`（未撤销 / 未过期 / `uses < max_uses`）→ `exhausted` | `expired` | `revoked`。
- 默认：1 次、7 天、角色 member。
- 注册 = 单事务：校验邀请 → 创建用户 → `uses+1`（`UPDATE ... WHERE uses < max_uses` 原子）→ 创建 session。
- 撤销立即生效；已注册用户不受影响。
- 频率：同一 IP 10 分钟内最多 5 次尝试；失败不区分“不存在/已过期/已用尽”，统一 `INVITE_INVALID`。

---

## 6. WebSocket 事件（namespace `/ws`）

连接：`io("/ws", { auth: { token }, transports: ["websocket"] })`；握手中间件校验 access token，失败 `connect_error` 带 `AUTH_INVALID`。

### 客户端 → 服务端（均带 ack 回调，5s 超时）
| 事件 | payload | ack |
| --- | --- | --- |
| `channel:join` | `{ channelId }` | `{ ok, channelId }` |
| `channel:leave` | `{ channelId }` | `{ ok }` |
| `message:send` | `{ channelId, clientMsgId, kind, body, parentId?, replyToId?, attachmentIds?, card? }` | `{ ok, message }` / `{ ok:false, code, message }` |
| `message:read` | `{ channelId, seq }` | `{ ok }` |
| `typing` | `{ channelId, state: "start"\|"stop" }` | `{ ok }` |
| `thread:join` | `{ rootId }` | `{ ok }` |
| `thread:leave` | `{ rootId }` | `{ ok }` |
| `presence:ping` | `{}` | `{ ok, serverTime }` |

### 服务端 → 客户端
| 事件 | payload |
| --- | --- |
| `ready` | `{ user, serverTime, channels: [{id,name,lastReadSeq,unread}] }` |
| `message:new` | `{ message }` |
| `message:updated` | `{ message }` |
| `message:deleted` | `{ messageId, channelId }` |
| `reaction:updated` | `{ messageId, cardId?, counts: {emoji:n}, mine: string[] }` |
| `receipt:update` | `{ channelId, userId, lastReadSeq }` |
| `presence:update` | `{ userId, status: "online"\|"offline", lastSeenAt }` |
| `card:created` / `card:updated` / `card:deleted` | `{ card }` / `{ cardId, channelId }` |
| `vote:updated` | `{ cardId, counts: {optionId:n}, total, voters }`（匿名投票 voters=[]） |
| `channel:created` / `channel:updated` | `{ channel }` |
| `member:updated` | `{ channelId, userId, role, notifyLevel }` |
| `notification:new` | `{ notification }` |
| `error` | `{ code, message, requestId }` |
| `rtc:signal`（预留） | 恒返回 `NOT_IMPLEMENTED`，见 §11 |

Ack 语义：服务端**持久化成功后才 ack**；客户端超时用同一 `clientMsgId` 重发，服务端命中唯一键返回已存消息（`dup: true`）。

---

## 7. REST 端点

统一前缀 `/api/v1`。鉴权：`Authorization: Bearer <access>`；access 15 分钟，refresh 30 天。

### auth / me
- `POST /auth/register`（公开，body 含 inviteCode）
- `POST /auth/login`（公开）
- `POST /auth/refresh`（公开，refresh token）
- `POST /auth/logout`（登录）
- `GET /me`、`PATCH /me`、`POST /me/password`
- `GET /me/settings`、`PATCH /me/settings`
- `POST /me/devices`、`DELETE /me/devices/:id`

### invites（owner/admin）
- `POST /invites`、`GET /invites`、`DELETE /invites/:id`（撤销）
- `GET /invites/:code/preview`（公开，返回是否有效 + 邀请人显示名，不返回敏感信息）

### users / presence
- `GET /users`（登录）、`GET /users/:id`（登录）
- `GET /presence`（登录，批量查在线）

### channels
- `GET /channels`（登录，返回可见频道 + 未读 + 成员数）
- `POST /channels`（owner/admin）
- `GET /channels/:id`（成员）
- `PATCH /channels/:id`（owner/admin 或频道 moderator）
- `DELETE /channels/:id`（owner/admin，归档）
- `GET /channels/:id/members`（成员）
- `POST /channels/:id/members`（owner/admin 或 moderator）
- `PATCH /channels/:id/members/:userId`（角色 / 免打扰 / 禁言）
- `DELETE /channels/:id/members/:userId`（同上）
- `POST /channels/:id/read`（成员，body `{ seq }`）
- `GET /channels/:id/pins`（成员）

### messages / threads / reactions
- `GET /channels/:id/messages?cursor=&limit=50&direction=older|newer`（成员）
- `POST /channels/:id/messages`（成员；REST 兜底，与 WS 同语义）
- `GET /messages/:id`（成员）
- `PATCH /messages/:id`（作者，15 分钟内）
- `DELETE /messages/:id`（作者 / moderator / admin）
- `GET /messages/:id/thread?cursor=&limit=50`（成员）
- `POST /messages/:id/reactions`（成员，body `{ emoji }`）
- `DELETE /messages/:id/reactions/:emoji`（成员）
- `POST /messages/:id/pin` / `DELETE /messages/:id/pin`（moderator）
- `POST /messages/:id/convert`（成员，body `{ kind: "task"|"vote"|"idea" }`，从消息建卡）

### files
- `POST /files/presign`（成员，body `{ channelId, filename, mime, size }`）
- `POST /files/:id/complete`（成员，body `{ checksum? }`）
- `GET /files/:id/url?variant=original|preview`（成员，返回 15 分钟签名 URL）
- `GET /channels/:id/files?kind=&tag=&cursor=`（成员，素材库原始列表）

### cards
- `GET /channels/:id/cards?kind=&cursor=&limit=`（成员）
- `POST /cards`（成员，body `{ channelId, kind, title, body?, color?, tags?, data?, fileIds?, assigneeIds?, dueAt? }`）
- `GET /cards/:id`（成员）
- `PATCH /cards/:id`（作者 / moderator）
- `DELETE /cards/:id`（作者 / moderator）
- `POST /cards/reorder`（成员，body `{ channelId, kind, items: [{id, position}] }`）
- `POST /cards/:id/vote`（成员，body `{ optionIds: string[] }`；单选/多选由 data.multi 决定）
- `GET /cards/:id/results`（成员）
- `POST /cards/:id/assign`（成员，body `{ userIds: string[] }`）
- `POST /cards/:id/convert`（成员，body `{ kind }`）
- `POST /cards/:id/close`（作者 / moderator）

### search
- `GET /search?q=&channelId=&type=message|card&cursor=`（登录；按可见性过滤）
- `GET /channels/:id/search?q=`（成员）

### notifications
- `GET /notifications?cursor=&unread=true`（登录）
- `POST /notifications/read`（登录，body `{ ids?: string[], all?: boolean }`）
- `GET /notifications/unread-count`（登录）

### ops
- `GET /healthz`（公开，进程存活）
- `GET /readyz`（公开，PG + Redis + S3 就绪）
- `GET /metrics`（内网，Prometheus）

---

## 8. 错误码

| code | HTTP/WS | 含义 |
| --- | --- | --- |
| AUTH_REQUIRED | 401 | 未携带凭证 |
| AUTH_INVALID | 401 | 凭证无效 |
| TOKEN_EXPIRED | 401 | access 过期，前端静默 refresh |
| INVITE_INVALID | 400 | 邀请无效（统一口径） |
| FORBIDDEN | 403 | 角色不足 |
| NOT_CHANNEL_MEMBER | 403 | 非频道成员 |
| CHANNEL_NOT_FOUND | 404 | |
| MUTED | 403 | 被禁言，body 带 `until` |
| RATE_LIMITED | 429 | 带 `retryAfterMs` |
| VALIDATION_FAILED | 400 | 字段错误 |
| DUPLICATE_MESSAGE | 200 | ack 返回已存在消息，`dup:true` |
| FILE_TOO_LARGE | 413 | |
| FILE_TYPE_NOT_ALLOWED | 415 | |
| FILE_NOT_READY | 409 | 直传未完成 / 校验未过 |
| VOTE_CLOSED | 409 | |
| NOT_IMPLEMENTED | 501 | 预留能力（RTC 信令） |
| INTERNAL | 500 | 带 requestId |

---

## 9. 限额

| 项 | 值 |
| --- | --- |
| 消息体 | ≤8000 字符；附件 ≤10 个/条 |
| 图片 | ≤20 MB（jpg/png/webp/avif/heic） |
| 视频 | ≤200 MB（mp4/webm） |
| 音频 | ≤50 MB（mp3/m4a/ogg/wav） |
| 文档 | ≤100 MB（pdf/zip/md/txt/docx/pptx/xlsx） |
| 预览 | 图片生成 3 档（160/480/1280），视频抽 1 帧 poster |
| 单频道素材 | 20 GB 软上限（超限提醒，不硬断） |
| 发送频率 | 5 条/秒突发，60 条/分钟/用户 |
| 已读上报 | 客户端节流 500ms，服务端合并 300ms |
| 输入中 | 3000ms 自动过期 |
| 登录 | 5 次/分钟/IP + 10 次/小时/账号 |
| 邀请核验 | 5 次/10 分钟/IP |
| 上传签名 | 20 次/分钟/用户 |

---

## 10. 文件直传流程（与实现对齐）

1. `POST /files/presign` → 校验频道成员、MIME 白名单、大小上限；写 `files(status=pending)`；返回 `{ fileId, uploadUrl, method:"PUT", headers, expiresIn:900 }`。
2. 客户端 `PUT` 到 S3/MinIO（带服务端规定的 `Content-Type`、`Content-Length`；签名含 `content-length-range`）。
3. `POST /files/:id/complete` → 服务端 `HeadObject` 校验大小/类型；读取前 512 字节做魔数嗅探；不一致 → 删除对象 + `rejected`；一致 → 生成预览（异步队列）、`status=ready`、`preview_status`。
4. 发送消息 `attachmentIds` → 校验 file 属于本人或本频道、status=ready → 写 attachments。
5. `GET /files/:id/url?variant=preview` → 15 分钟签名 GET URL；无预览时降级原图。

---

## 11. 预留：音视频信令通道

- 命名空间 `/rtc`，握手同 `/ws`。
- 事件：`rtc:join`、`rtc:offer`、`rtc:answer`、`rtc:ice`、`rtc:leave`（全部预留，**不实现**）。
- 开关：`RTC_SIGNALING_ENABLED=false`（默认）。为 false 时建连直接 `connect_error: NOT_IMPLEMENTED`；REST `POST /rtc/token` 返回 501。
- 设计意图：未来接入 LiveKit / 自建 SFU 时，仅替换 `/rtc` 转发实现，不动 `/ws` 与消息链路。

---

## 12. 验收固定数据

- 2 个公开频道：`#全域播报`（general）、`#素材工坊`（archive）
- 1 个私密频道：`#第三协议`（protocol）
- 角色：1 owner、1 admin、6 member；私密频道仅 2 人
- 素材：≥12 个文件，覆盖 image/pdf/zip；1 个超限 25MB 的 png 用于拒绝用例
- 卡片：material×6、idea×6、vote×2（单/多选各一）、task×4、artwork×3
- 消息：≥500 条，含线程 3 组、提及 5 条、反应 20 个
- 通知：≥30 条，含免打扰时段内 10 条

## 13. 版本变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-10-22 | 冻结首版 |
