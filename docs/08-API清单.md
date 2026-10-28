# 08 · API 清单

> 协议编号：O.M.V-DJ / P-08　｜　版本：v1.0（+ 契约 v1.2 会话扩展增量）　｜　依据：`_contract.md` v1.0 §6 WebSocket 事件、§7 REST 端点、§8 错误码、§11 预留；`_contract-v1.2.md` §B 会话端点、§C 会话事件。
> 管辖：接口逐条落地清单。**本文件不新增、不删除、不重命名任何接口**；契约未列出的请求 / 响应字段标 †，表示按最小可用集实现。
> 计数自检：契约 §7 REST **63** 条 + 契约 v1.2 §B 会话 **8** 条 + Sprint1 新增 **2** 条 + Sprint2 新增 **4** 条 + Sprint3 新增 **5** 条 + Sprint4 新增 **9** 条 + Sprint5 新增 **9** 条 + Phase3 新增 **3** 条 = **103** 条，实现 **104** 条（多出的 1 条为 `GET /me/devices`，属实现补充并已在下表标注）；WS 事件 **28** 条（客户端→服务端 8 + 服务端→客户端 20，含 v1.2 §C 的 3 个会话事件）、错误码 **22** 个，与 §5 核对一致。

---

## 0. 通用约定

| 项 | 值 |
| --- | --- |
| 前缀 | `/api/v1`（WS 除外） |
| 鉴权 | `Authorization: Bearer <access>`；access 15 min，refresh 30 d |
| JSON | camelCase；时间统一 ISO 8601 UTC；id 一律字符串（`messages.id` 为 bigint，序列化为字符串） |
| 分页 | `cursor` 为不透明串 `base64url("seq:<id>")`（见 `03` §4）；`limit` 默认 50、上限 100 |
| 错误体 | `{ code, message, requestId }`，`code` 取自 §4 的 17 个枚举值 |
| 幂等 | `clientMsgId` 为发送幂等键（REST 与 WS 同语义） |
| 鉴权列简写 | `公开` = 免登录；`登录` = 任意 `active` 用户；`成员` = `channel_members` 有行；`会话成员` = 该会话（DM/群聊）的 `channel_members` 有行，owner/admin 不可越权；`moderator` = 频道 moderator 或 owner/admin；`owner·admin` = 全局角色 |
| † | 契约未规定的字段 / 响应体，按最小集实现，不改变语义 |

---

## 1. REST 总表（104 = 契约 63 + 契约 v1.2 会话 8 + Sprint1 2 + Sprint2 4 + Sprint3 5 + Sprint4 9 + Sprint5 9 + Phase3 3 + 实现补充 1）

| # | 方法 | 路径 | 鉴权 | 请求 | 响应 | 错误码 |
| --- | --- | --- | --- | --- | --- | --- |
| | **auth / me（13：契约 11 + `GET /me/devices` + `GET /me/tasks`）** | | | | | |
| 1 | POST | `/auth/register` | 公开 | `{ handle, password, displayName, inviteCode }` † | `{ user, accessToken, refreshToken }` † | INVITE_INVALID, VALIDATION_FAILED, RATE_LIMITED |
| 2 | POST | `/auth/login` | 公开 | `{ handle, password }` † | `{ user, accessToken, refreshToken }` † | AUTH_INVALID, RATE_LIMITED, FORBIDDEN |
| 3 | POST | `/auth/refresh` | 公开 | `{ refreshToken }` † | `{ accessToken, refreshToken }` †（轮换） | AUTH_INVALID, TOKEN_EXPIRED |
| 4 | POST | `/auth/logout` | 登录 | `{ refreshToken? }` † | 204 | AUTH_REQUIRED, AUTH_INVALID |
| 5 | GET | `/me` | 登录 | — | `{ user, settings }` † | AUTH_REQUIRED, TOKEN_EXPIRED |
| 6 | PATCH | `/me` | 登录 | `{ displayName?, avatarFileId?, statusPrefix? }` †（`statusPrefix`：trim、≤24、`null`/空串=清除，未传则不更新） | `{ user }` †（含 `statusPrefix`） | VALIDATION_FAILED, FORBIDDEN |
| 7 | POST | `/me/password` | 登录 | `{ currentPassword, newPassword }` † | 204（撤销其他会话） | AUTH_INVALID, VALIDATION_FAILED |
| 8 | GET | `/me/settings` | 登录 | — | `{ settings }` | AUTH_REQUIRED |
| 9 | PATCH | `/me/settings` | 登录 | 部分 `user_settings` 字段 | `{ settings }` | VALIDATION_FAILED |
| 10 | POST | `/me/devices` | 登录 | `{ platform, name, pushProvider, pushToken, pushKeys? }` † | `{ device }` | VALIDATION_FAILED |
| 10a | GET | `/me/devices` | 登录 | — | `{ devices: [{ id, platform, name, pushProvider, lastActiveAt, createdAt }] }` † | AUTH_REQUIRED |
| 11 | DELETE | `/me/devices/:id` | 登录 | — | 204 | FORBIDDEN, VALIDATION_FAILED |
| 10b | GET | `/me/tasks` | 登录 | — | `{ tasks: [{ cardId, title, taskStatus, dueAt, channelId, channelName, kind, updatedAt }] }` †（Sprint2：本人被指派、`taskStatus != done`、`status=open`、会话未归档；`dueAt asc null last`） | AUTH_REQUIRED |
| | **invites（4）** | | | | | |
| 12 | POST | `/invites` | owner·admin | `{ role?, maxUses?, expiresInDays?, note? }` † | `{ invite, code }`（明文仅此一次） | FORBIDDEN, VALIDATION_FAILED |
| 13 | GET | `/invites` | owner·admin | — | `{ items: [{ id, codePrefix, role, maxUses, uses, expiresAt, revokedAt, note }] }` † | FORBIDDEN |
| 14 | DELETE | `/invites/:id` | owner·admin | — | 204（撤销，立即生效） | FORBIDDEN, VALIDATION_FAILED |
| 15 | GET | `/invites/:code/preview` | 公开 | — | `{ valid, inviterName }` †（不含敏感信息） | INVITE_INVALID, RATE_LIMITED |
| | **users / presence（3）** | | | | | |
| 16 | GET | `/users` | 登录 | — | `{ items: [{ id, handle, displayName, avatarFileId, status, statusPrefix, globalRole, lastSeenAt }] }` †（`status` 供成员管理显示 active/suspended） | AUTH_REQUIRED |
| 17 | GET | `/users/:id` | 登录 | — | `{ user }` | AUTH_REQUIRED, VALIDATION_FAILED |
| 18 | GET | `/presence` | 登录 | （批量查在线，默认全部成员）† | `{ items: [{ userId, status, lastSeenAt }] }` | AUTH_REQUIRED |
| | **channels（11）** | | | | | |
| 19 | GET | `/channels` | 登录 | — | `{ items: [{ id, name, slug, topic, visibility, position, joined, role, lastReadSeq, unread, memberCount }] }` †（owner/admin 额外返回私密频道元数据行：`joined=false`、`unread=0`） | AUTH_REQUIRED |
| 20 | POST | `/channels` | owner·admin | `{ name, slug, topic?, visibility? }` † | `{ channel }` | FORBIDDEN, VALIDATION_FAILED |
| 21 | GET | `/channels/:id` | 成员 | — | `{ channel, member }` † | NOT_CHANNEL_MEMBER, CHANNEL_NOT_FOUND |
| 22 | PATCH | `/channels/:id` | owner·admin 或 moderator | `{ name?, topic?, visibility?, position? }` † | `{ channel }` | FORBIDDEN, VALIDATION_FAILED |
| 23 | DELETE | `/channels/:id` | owner·admin | — | 204（归档，`archived_at`） | FORBIDDEN, CHANNEL_NOT_FOUND |
| 24 | GET | `/channels/:id/members` | 成员 | — | `{ items: [{ userId, role, notifyLevel, mutedUntil, joinedAt }] }` † | NOT_CHANNEL_MEMBER |
| 25 | POST | `/channels/:id/members` | owner·admin 或 moderator | `{ userId, role? }` † | `{ member }` | FORBIDDEN, VALIDATION_FAILED, NOT_CHANNEL_MEMBER |
| 26 | PATCH | `/channels/:id/members/:userId` | owner·admin 或 moderator | `{ role?, notifyLevel?, mutedUntil? }` † | `{ member }` | FORBIDDEN, MUTED, VALIDATION_FAILED |
| 27 | DELETE | `/channels/:id/members/:userId` | owner·admin 或 moderator | — | 204（不可移除 moderator） | FORBIDDEN, VALIDATION_FAILED |
| 28 | POST | `/channels/:id/read` | 成员 | `{ seq }` | `{ lastReadSeq }` † | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| 29 | GET | `/channels/:id/pins` | 成员 | — | `{ items: [message] }` | NOT_CHANNEL_MEMBER |
| | **conversations（8，契约 v1.2 §B）** | | | | | |
| 64 | GET | `/conversations` | 登录 | — | `{ conversations: [{ id, kind, name, members[], peer?, announcement, lastMessageAt, lastMessagePreview, unreadCount, myRole }] }` †（按 `lastMessageAt desc nulls last`；只含 DM + 群聊；`announcement` 仅群聊非空） | AUTH_REQUIRED |
| 65 | GET | `/conversations/users` | 登录 | — | `{ users: [{ id, handle, displayName, avatarFileId }] }` †（排除自己，按 displayName 排序） | AUTH_REQUIRED |
| 66 | GET | `/conversations/:id` | 会话成员 | — | `{ conversation, members }` †（`conversation.announcement` 群公告，非群聊为 null） | CONVERSATION_NOT_FOUND |
| 67 | POST | `/conversations/dm` | 登录 | `{ userId }` | `{ conversation }`（幂等；唯一键冲突读回已有会话） | DM_SELF, VALIDATION_FAILED, FORBIDDEN |
| 68 | POST | `/conversations/group` | 登录 | `{ name, memberIds: string[] }` | 201 `{ conversation }`（memberIds 含自己、去重、≤50；创建者 `moderator`） | VALIDATION_FAILED, FORBIDDEN |
| 69 | PATCH | `/conversations/:id` | 群聊 moderator | `{ name }` | `{ conversation }`（仅群聊可改名） | CONVERSATION_NOT_FOUND, CONVERSATION_KIND_INVALID, FORBIDDEN, VALIDATION_FAILED |
| 70 | POST | `/conversations/:id/members` | 群聊 moderator | `{ userIds: string[] }` | 201 `{ conversation }`（仅群聊可加人） | CONVERSATION_KIND_INVALID, FORBIDDEN, VALIDATION_FAILED, CONVERSATION_NOT_FOUND |
| 71 | DELETE | `/conversations/:id/members/:userId` | 本人 / 群聊 moderator | — | `{ conversationId, userId, reason: "left"\|"removed" }` †（本人=退出；moderator=移除；DM 不可移除对方） | CONVERSATION_KIND_INVALID, FORBIDDEN, CONVERSATION_NOT_FOUND |
| 72 | PATCH | `/conversations/:id/announcement` | 群聊 moderator（`ChannelMember.role='moderator'`） | `{ announcement: string }` †（trim、≤4000；空串=清除；仅 `kind=group`） | `{ conversation }` †（含 `announcement`；同时向成员推 `conversation:updated`） | CONVERSATION_KIND_INVALID, FORBIDDEN, VALIDATION_FAILED, CONVERSATION_NOT_FOUND |
| 73 | DELETE | `/conversations/:id` | 群主（`channels.created_by === 调用者`） | — | `{ archived: true }` †（Prisma 事务内 `archived_at=now()` 软归档；消息/成员保留；向成员推 `conversation:removed`，`reason:"dissolved"`） | CONVERSATION_KIND_INVALID, FORBIDDEN, CONVERSATION_NOT_FOUND |
| | **AI（5，Sprint3）** | | | | | |
| 74 | GET | `/ai/config` | owner·admin | — | `{ configured, baseUrl, model, keyMasked, updatedAt }` †（**绝不含明文 key**，`keyMasked` 仅末 4 位） | FORBIDDEN |
| 75 | PUT | `/ai/config` | owner·admin | `{ baseUrl, model, apiKey? }` †（baseUrl 必须 http(s)；apiKey 省略=保留旧值） | 200 同上（AES-256-GCM 加密落库，响应不含 key） | FORBIDDEN, VALIDATION_FAILED |
| 76 | POST | `/ai/test` | owner·admin | — | 200 `{ ok, latencyMs, status, error? }` †（调 `${baseUrl}/models`，Bearer key，8s 超时；不含 key） | FORBIDDEN |
| 77 | POST | `/ai/chat` | 频道成员 | `{ channelId, body, botId? }` †（`botId` 省略时按 `@名称` 匹配频道 Bot 成员，最长优先，再回退默认 Bot） | **SSE**（`text/event-stream`）：`event: delta {delta,text}` … `event: done {messageId,seq}`；异常 `event: error {code,message}`；落库 bot 消息（senderId=该 Bot 的 user id，body 前缀 `[DIJIANG/OS]`） | NOT_CHANNEL_MEMBER, CHANNEL_NOT_FOUND, BOT_NOT_FOUND, BOT_DISABLED, VALIDATION_FAILED |
| 78 | POST | `/ai/report` | 频道成员 | `{ channelId, botId? }` †（近 7 天统计） | **SSE**（同 chat；prompt 使用“站长助理”叙事；落库该 Bot 消息） | NOT_CHANNEL_MEMBER, CHANNEL_NOT_FOUND, BOT_NOT_FOUND, BOT_DISABLED, VALIDATION_FAILED |
| | **bots / ai 指令（9，Sprint5）** | | | | | |
| 88 | GET | `/bots` | **owner**（admin 也 403） | — | `{ bots: [{ id, handle, name, avatarFileId, model, systemPrompt, enabled, keyMasked, createdAt }] }` †（**无明文 key**） | FORBIDDEN |
| 89 | POST | `/bots` | **owner** | `{ name, avatarFileId?, systemPrompt?, model?, apiKey? }` †（name 1..40；systemPrompt ≤8000） | 201 `{ bot }`（事务创建 users(is_bot=true) + bot_profiles；apiKey AES-256-GCM 加密） | FORBIDDEN, VALIDATION_FAILED |
| 90 | PATCH | `/bots/:id` | **owner** | `{ name?, avatarFileId?, systemPrompt?, model?, apiKey?, enabled? }` †（apiKey 省略/空串=保留） | `{ bot }`（事务更新 users + profile；无明文 key） | FORBIDDEN, BOT_NOT_FOUND, VALIDATION_FAILED |
| 91 | DELETE | `/bots/:id` | **owner** | — | `{ id, deleted: true }` †（软删 profile + user.status=suspended；历史消息保留） | FORBIDDEN, BOT_NOT_FOUND |
| 92 | POST | `/bots/:id/test` | **owner** | — | 200 `{ ok, latencyMs, status, error? }` †（Bot model/key 优先，空回退全局；8s 超时） | FORBIDDEN, BOT_NOT_FOUND |
| 93 | GET | `/channels/:id/bots` | 频道成员 | — | `{ bots: [{ id, name, avatarFileId, enabled }] }` †（该频道 `is_bot=true` 成员） | NOT_CHANNEL_MEMBER, CHANNEL_NOT_FOUND |
| 94 | POST | `/ai/clear` | 频道成员 | `{ channelId, botId? }` | `{ cleared: true }` †（只 upsert `ai_channel_contexts.cleared_at`，**不删聊天记录**） | NOT_CHANNEL_MEMBER, BOT_NOT_FOUND, BOT_DISABLED |
| 95 | POST | `/ai/summarize` | 频道成员 | `{ channelId, botId? }` | **SSE**（最近 50 条消息总结；`event: delta` … `event: done {messageId,seq}`；落库该 Bot 消息） | NOT_CHANNEL_MEMBER, BOT_NOT_FOUND, BOT_DISABLED, VALIDATION_FAILED |
| 96 | POST | `/ai/translate` | 频道成员 | `{ channelId, botId?, messageId }` | **SSE**（翻译指定消息；消息不存在/跨频道/已删 → `VALIDATION_FAILED`；落库该 Bot 消息） | NOT_CHANNEL_MEMBER, BOT_NOT_FOUND, BOT_DISABLED, VALIDATION_FAILED |
| | **Phase3（用户封禁 / 全服公告，3）** | | | | | |
| 97 | PATCH | `/users/:id/status` | owner·admin | `{ status: "active"\|"suspended" }` | `{ user }` †（PublicUser，含 status；不能封自己/owner；写 audit `user.suspend`/`user.activate`） | FORBIDDEN, VALIDATION_FAILED |
| 98 | GET | `/announcements/current` | 登录 | — | `{ announcement: { body, level, updatedAt } \| null }` †（仅 active=true 返回） | AUTH_REQUIRED |
| 99 | PUT | `/announcements` | owner·admin | `{ body, level? }` †（body ≤2000；空串=关闭；level ∈ info/warning/critical） | 200 `{ announcement }`（事务 upsert；写 audit `announcement.update`） | FORBIDDEN, VALIDATION_FAILED |
| | **posts / archive / stats（9，Sprint4）** | | | | | |
| 79 | GET | `/posts` | 登录 | `?limit=20&cursor=` †（limit ≤50；cursor 为不透明复合游标） | `{ posts: [{ id, body, fileIds, createdAt, author:{id,handle,displayName,avatarFileId}, likeCount, commentCount, likedByMe }], nextCursor }` †（`createdAt desc`；软删不可见） | AUTH_REQUIRED, VALIDATION_FAILED |
| 80 | POST | `/posts` | 登录 | `{ body, fileIds? }` †（body 1..4000；fileIds ≤9） | 201 `{ post }`（**Prisma.$transaction** 创建） | AUTH_REQUIRED, VALIDATION_FAILED |
| 81 | DELETE | `/posts/:id` | 作者本人 | — | `{ id, deleted: true }` †（事务软删 `deleted_at`；列表中不可见） | FORBIDDEN, VALIDATION_FAILED |
| 82 | POST | `/posts/:id/like` | 登录 | — | 200 `{ postId, liked:true, likeCount }` †（幂等：重复点赞计数不变） | VALIDATION_FAILED |
| 83 | DELETE | `/posts/:id/like` | 登录 | — | 200 `{ postId, liked:false, likeCount }` †（幂等） | VALIDATION_FAILED |
| 84 | GET | `/posts/:id/comments` | 登录 | `?limit=50` †（≤100） | `{ comments: [{ id, postId, body, createdAt, author }] }` †（createdAt 正序） | VALIDATION_FAILED |
| 85 | POST | `/posts/:id/comments` | 登录 | `{ body }` †（1..2000） | 201 `{ comment }`（含作者信息） | VALIDATION_FAILED |
| 86 | GET | `/archive` | 登录 | — | `{ items: [{ id, kind, title, body, fileIds, channelId, channelName, createdAt }] }` †（kind ∈ material/artwork/idea，≤100；频道未归档 + 当前用户可见） | AUTH_REQUIRED |
| 87 | GET | `/stats/activity` | 登录 | — | `{ metrics: [{key,label,value}], daily: [{date,messages,activeUsers,tasksDone}] }` †（近 7 个 UTC 自然日；metrics 五项） | AUTH_REQUIRED |
| | **messages / threads / reactions（11）** | | | | | |
| 30 | GET | `/channels/:id/messages` | 成员 | `?cursor=&limit=50&direction=older\|newer` | `{ items: [message], hasMore }` † | NOT_CHANNEL_MEMBER, VALIDATION_FAILED, CHANNEL_NOT_FOUND |
| 31 | POST | `/channels/:id/messages` | 成员 | 与 WS `message:send` 同字段（含 `clientMsgId`） | `{ message, dup? }` | NOT_CHANNEL_MEMBER, MUTED, RATE_LIMITED, VALIDATION_FAILED, DUPLICATE_MESSAGE |
| 32 | GET | `/messages/:id` | 成员 | — | `{ message }` | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| 33 | PATCH | `/messages/:id` | 作者（15 min 内） | `{ body }` † | `{ message }` | FORBIDDEN, VALIDATION_FAILED |
| 34 | DELETE | `/messages/:id` | 作者 / moderator | — | 204（软删） | FORBIDDEN, VALIDATION_FAILED |
| 35 | GET | `/messages/:id/thread` | 成员 | `?cursor=&limit=50` | `{ items: [message], hasMore }` † | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| 36 | POST | `/messages/:id/reactions` | 成员 | `{ emoji }` | `{ messageId, counts, mine }` † | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| 37 | DELETE | `/messages/:id/reactions/:emoji` | 成员 | — | 204 | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| 38 | POST | `/messages/:id/pin` | moderator | — | 204 | FORBIDDEN, VALIDATION_FAILED |
| 39 | DELETE | `/messages/:id/pin` | moderator | — | 204 | FORBIDDEN, VALIDATION_FAILED |
| 40 | POST | `/messages/:id/convert` | 成员 | `{ kind: "task" \| "vote" \| "idea" }` | `{ card }` | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| | **files（4）** | | | | | |
| 41 | POST | `/files/presign` | 成员 | `{ channelId, filename, mime, size }` | `{ fileId, uploadUrl, method:"PUT", headers, expiresIn:900 }` | NOT_CHANNEL_MEMBER, FILE_TOO_LARGE, FILE_TYPE_NOT_ALLOWED, RATE_LIMITED |
| 42 | POST | `/files/:id/complete` | 成员 | `{ checksum? }` | `{ file }` | FILE_NOT_READY, FILE_TYPE_NOT_ALLOWED, FORBIDDEN |
| 43 | GET | `/files/:id/url` | 成员 | `?variant=original\|preview` | `{ url, expiresAt }` †（15 min 签名，无预览降级原图） | FORBIDDEN, FILE_NOT_READY, VALIDATION_FAILED |
| 44 | GET | `/channels/:id/files` | 成员 | `?kind=&tag=&cursor=` | `{ items: [file], hasMore }` † | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| | **stickers（3，Sprint2）** | | | | | |
| 44a | POST | `/stickers` | 登录 | `{ fileId, name }` †（name ≤40；文件需 ready + kind=image + 本人） | 200 `{ sticker: { id, fileId, name, createdAt } }`（同一 `(owner,file)` 重复收藏幂等返回已有行） | VALIDATION_FAILED, FORBIDDEN, FILE_TYPE_NOT_ALLOWED, FILE_NOT_READY |
| 44b | GET | `/stickers` | 登录 | — | `{ stickers: [{ id, fileId, name, createdAt }] }`（本人，createdAt desc） | AUTH_REQUIRED |
| 44c | DELETE | `/stickers/:id` | 登录（仅 owner） | — | `{ id }` | FORBIDDEN, VALIDATION_FAILED |
| | **cards（11）** | | | | | |
| 45 | GET | `/channels/:id/cards` | 成员 | `?kind=&cursor=&limit=` | `{ items: [card], hasMore }` † | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| 46 | POST | `/cards` | 成员 | `{ channelId, kind, title, body?, color?, tags?, data?, fileIds?, assigneeIds?, dueAt? }` †（Sprint2：`kind` 新增 `music` / `chart`；`data` 原样存 JSON——music: `{ url, title, artist, coverUrl }`，chart: `{ chartType, series }`，**不做外部网络抓取**） | `{ card }` | NOT_CHANNEL_MEMBER, MUTED, VALIDATION_FAILED |
| 47 | GET | `/cards/:id` | 成员 | — | `{ card, options?, ballots? }` † | NOT_CHANNEL_MEMBER, CHANNEL_NOT_FOUND |
| 48 | PATCH | `/cards/:id` | 作者 / moderator | `{ title?, body?, color?, tags?, status?, taskStatus?, dueAt?, data? }` † | `{ card }` | FORBIDDEN, VALIDATION_FAILED |
| 49 | DELETE | `/cards/:id` | 作者 / moderator | — | 204（软删） | FORBIDDEN, VALIDATION_FAILED |
| 50 | POST | `/cards/reorder` | 成员 | `{ channelId, kind, items: [{ id, position }] }` | 204 | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| 51 | POST | `/cards/:id/vote` | 成员 | `{ optionIds: string[] }`（单选/多选由 `data.multi` 决定） | `{ cardId, counts, total, voters }` † | NOT_CHANNEL_MEMBER, VOTE_CLOSED, VALIDATION_FAILED |
| 52 | GET | `/cards/:id/results` | 成员 | — | `{ cardId, counts, total, voters }`（匿名 `voters=[]`） | NOT_CHANNEL_MEMBER |
| 53 | POST | `/cards/:id/assign` | 成员 | `{ userIds: string[] }` | `{ card }` | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| 54 | POST | `/cards/:id/convert` | 成员 | `{ kind }` | `{ card }` | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| 55 | POST | `/cards/:id/close` | 作者 / moderator | — | `{ card }` | FORBIDDEN, VALIDATION_FAILED |
| | **search（2）** | | | | | |
| 56 | GET | `/search` | 登录 | `?q=&channelId=&type=message\|card&cursor=` | `{ items: [{ id, channelId, type, snippet, createdAt }], hasMore }` † | VALIDATION_FAILED |
| 57 | GET | `/channels/:id/search` | 成员 | `?q=` | `{ items: […] }`（同上，范围限该频道） | NOT_CHANNEL_MEMBER, VALIDATION_FAILED |
| | **notifications（3）** | | | | | |
| 58 | GET | `/notifications` | 登录 | `?cursor=&unread=true` | `{ items: [notification], hasMore }` † | AUTH_REQUIRED |
| 59 | POST | `/notifications/read` | 登录 | `{ ids?: string[], all?: boolean }` | `{ updated }` † | VALIDATION_FAILED |
| 60 | GET | `/notifications/unread-count` | 登录 | — | `{ total }` † | AUTH_REQUIRED |
| | **ops（3）** | | | | | |
| 61 | GET | `/healthz` | 公开 | — | 200（进程存活） | — |
| 62 | GET | `/readyz` | 公开 | — | 200 / 503（PG + Redis + S3） | — |
| 63 | GET | `/metrics` | 内网 | — | Prometheus 文本 | — |

---

> 会话补充约定（契约 v1.2）：
> 1. `GET /channels` 只返回 `kind='channel'` 的社区频道（社区语义不变）；DM/群聊走 `GET /conversations`。
> 2. `GET /channels/:id`、`/channels/:id/messages`、`/channels/:id/read`、`/channels/:id/members` 对 DM/群聊**同样有效**（前端把会话 id 当 channelId 用）；但 `/channels/:id` 的元数据修改与成员增删**只允许社区频道**，会话侧统一走 `/conversations`（否则 owner/admin 可借频道成员接口越权改动他人私聊/群聊）。
> 3. 路由声明顺序：`GET /conversations/users` 必须早于 `GET /conversations/:id`；`POST /conversations/dm`、`POST /conversations/group` 是字面量路径。
> 4. DM 退出：仅退出方不再可见，会话行与历史保留，并清空 `dm_key` 以允许同一对人「重新发起需要新建」（契约 v1.2 §D4；§B 表格中的「DM 退出即双方不可再读」按 §D4 细化，见 §6 第 6 条）。

---

## 2. 预留端点（契约 §11，不属于 §7 清单）

| 方法 | 路径 | 鉴权 | 行为 | 说明 |
| --- | --- | --- | --- | --- |
| POST | `/rtc/token` | 登录 † | **501 `NOT_IMPLEMENTED`** | `RTC_SIGNALING_ENABLED=false`（默认）时恒返回 501；不实现签发逻辑 |

说明：该端点在契约 §11 中定义、不在 §7 的 REST 清单内，故不计入 63 条。实现侧还有 1 条契约外端点 `GET /me/devices`（#10a，设备管理列表），详见 §1 与 §5；除此之外没有其它契约外接口。RTC 的其余能力只存在于 `/rtc` 命名空间（§3.3）。

---

## 3. WebSocket 事件（28）

命名空间 `/ws`；连接 `io("/ws", { auth: { token }, transports: ["websocket"] })`；握手失败 `connect_error: AUTH_INVALID`。客户端→服务端事件**均带 ack 回调，超时 5 s**。

### 3.1 客户端 → 服务端（8）

| # | 事件 | payload | ack |
| --- | --- | --- | --- |
| 1 | `channel:join` | `{ channelId }` | `{ ok, channelId }` |
| 2 | `channel:leave` | `{ channelId }` | `{ ok }` |
| 3 | `message:send` | `{ channelId, clientMsgId, kind, body, parentId?, replyToId?, attachmentIds?, card? }` | `{ ok, message }` / `{ ok:false, code, message }` |
| 4 | `message:read` | `{ channelId, seq }` | `{ ok }` |
| 5 | `typing` | `{ channelId, state: "start"/"stop" }` | `{ ok }` |
| 6 | `thread:join` | `{ rootId }` | `{ ok }` |
| 7 | `thread:leave` | `{ rootId }` | `{ ok }` |
| 8 | `presence:ping` | `{}` | `{ ok, serverTime }` |

### 3.2 服务端 → 客户端（20）

| # | 事件 | payload |
| --- | --- | --- |
| 1 | `ready` | `{ user, serverTime, channels: [{ id, name, lastReadSeq, unread }] }` |
| 2 | `message:new` | `{ message }` |
| 3 | `message:updated` | `{ message }` |
| 4 | `message:deleted` | `{ messageId, channelId }` |
| 5 | `reaction:updated` | `{ messageId, cardId?, counts: { emoji: n }, mine: string[] }` |
| 6 | `receipt:update` | `{ channelId, userId, lastReadSeq }` |
| 7 | `presence:update` | `{ userId, status: "online"/"offline", lastSeenAt }` |
| 8 | `card:created` | `{ card }` |
| 9 | `card:updated` | `{ card }` |
| 10 | `card:deleted` | `{ cardId, channelId }` |
| 11 | `vote:updated` | `{ cardId, counts: { optionId: n }, total, voters }`（匿名投票 `voters=[]`） |
| 12 | `channel:created` | `{ channel }` |
| 13 | `channel:updated` | `{ channel }` |
| 14 | `member:updated` | `{ channelId, userId, role, notifyLevel }` |
| 15 | `notification:new` | `{ notification }` |
| 16 | `error` | `{ code, message, requestId }` |
| 17 | `rtc:signal`（预留） | 恒返回 `NOT_IMPLEMENTED`（契约 §6 / §11） |
| 18 | `conversation:created` | `{ conversation }`（契约 v1.2 §C；推 `user:<id>`：DM 推双方、建群推每个成员、加人推新成员） |
| 19 | `conversation:updated` | `{ conversation }`（改名 / 成员变化；推该会话所有成员的 `user:<id>`） |
| 20 | `conversation:removed` | `{ conversationId, reason: "left"\|"removed" }`（退出或被移除；推被移除者的 `user:<id>`） |

### 3.3 连接与 ack 语义

| 项 | 规则 |
| --- | --- |
| 握手 | `auth.token` 为 access token；失败 `connect_error`，`error.message` 与 `error.data.code` 同码表：`AUTH_REQUIRED` / `TOKEN_EXPIRED` / `AUTH_INVALID` / `FORBIDDEN`（与 REST 一致，见 docs/13 §13.1） |
| ack 时机 | 服务端**持久化成功后才 ack**；客户端超时用同一 `clientMsgId` 重发，命中唯一键返回已存消息 + `dup: true` |
| 错误形状 | `{ ok:false, code, message }`；`MUTED` 附 `until`、`RATE_LIMITED` 附 `retryAfterMs`（`03` §13 第 3 条已标注为兼容读法） |
| 补充事件 | `error` 事件在 v1.0 保留但未使用：所有业务错误都通过对应请求的 ack 返回，避免“无请求上下文的错误”与 ack 错误重复 |
| `/rtc` | 独立命名空间；v1.0 **无论开关如何**建连均 `connect_error`，`data.code=NOT_IMPLEMENTED`（“已预留、未实现”，见 docs/13 §13.9） |

---

## 4. 错误码（22）

| code | HTTP / WS | 含义 | 出现端点（示例） |
| --- | --- | --- | --- |
| `AUTH_REQUIRED` | 401 | 未携带凭证 | `/me`、`/notifications` |
| `AUTH_INVALID` | 401 | 凭证无效 / 会话被撤销 / 封禁 | `/auth/login`、`/auth/refresh` |
| `TOKEN_EXPIRED` | 401 | access 过期，前端静默 refresh | 任意 Bearer 端点 |
| `INVITE_INVALID` | 400 | 邀请无效（统一口径，不区分原因） | `/auth/register`、`/invites/:code/preview` |
| `FORBIDDEN` | 403 | 角色不足 / 非作者 / 超编辑窗口 | `/channels`、`PATCH /messages/:id` |
| `NOT_CHANNEL_MEMBER` | 403 | 非频道成员 | `/channels/:id/messages` |
| `CHANNEL_NOT_FOUND` | 404 | 频道不存在或不可见 | `/channels/:id` |
| `CONVERSATION_NOT_FOUND` | 404 | 会话不存在或已不可见（非成员读取也走此码，不泄漏会话是否存在） | `/conversations/:id` |
| `CONVERSATION_KIND_INVALID` | 400 | 对 DM 执行加人 / 改名 / 移除对方 / 公告 / 解散；或用 `/channels` 成员接口管理会话 | `PATCH /conversations/:id`、`PATCH /conversations/:id/announcement`、`DELETE /conversations/:id` |
| `DM_SELF` | 400 | 不能和自己建私聊 | `POST /conversations/dm` |
| `MUTED` | 403 | 被禁言，body 带 `until` | 发消息 / 建卡 / 上传 |
| `RATE_LIMITED` | 429 | 带 `retryAfterMs` | 登录、邀请、发消息、签名 |
| `VALIDATION_FAILED` | 400 | 字段错误 | 全站 |
| `DUPLICATE_MESSAGE` | 200 | ack 返回已存在消息，`dup:true` | `POST /channels/:id/messages` |
| `FILE_TOO_LARGE` | 413 | 超类型上限 | `/files/presign` |
| `FILE_TYPE_NOT_ALLOWED` | 415 | MIME 不在白名单 / 魔数不符 | `/files/presign`、`/files/:id/complete` |
| `FILE_NOT_READY` | 409 | 直传未完成 / 校验未过 | `/files/:id/url`、附件绑定 |
| `VOTE_CLOSED` | 409 | 投票已截止 | `POST /cards/:id/vote` |
| `NOT_IMPLEMENTED` | 501 | 预留能力（RTC 信令） | `POST /rtc/token`、`/rtc` 握手 |
| `INTERNAL` | 500 | 带 `requestId` | 全站 |
| `BOT_NOT_FOUND` | 404 | Bot 不存在、未加入该频道或已删除 | `/ai/chat`、`/ai/summarize`、`/ai/translate`、`/ai/clear` |
| `BOT_DISABLED` | 403 | Bot 已禁用（`enabled=false` 或账号被禁用） | `/ai/chat`、`/ai/summarize`、`/ai/translate`、`/ai/clear` |

---

## 5. 与契约的核对

| 契约段 | 契约条目 | 本文件条目 | 结果 |
| --- | --- | --- | --- |
| §7 auth / me | 11 | 13（#1–#11 + 10a `GET /me/devices` + 10b `GET /me/tasks`） | 契约 11 条全实现；实现补充 2 条，已单列标注 |
| §7 invites | 4 | 4（#12–#15） | 一致 |
| §7 users / presence | 3 | 3（#16–#18） | 一致 |
| §7 channels | 11 | 11（#19–#29） | 一致 |
| §7 messages / threads / reactions | 11 | 11（#30–#40，pin 的 POST / DELETE 分行计） | 一致 |
| §7 files | 4 | 4（#41–#44） | 一致 |
| §7 cards | 11 | 11（#45–#55） | 一致（Sprint2 仅扩 `kind` 枚举，不新增端点） |
| §7 search | 2 | 2（#56–#57） | 一致 |
| §7 notifications | 3 | 3（#58–#60） | 一致 |
| §7 ops | 3 | 3（#61–#63） | 一致 |
| 契约 v1.2 §B 会话 | 8 | 8（#64–#71） | 一致（`GET /conversations/users` 已计入） |
| Sprint1（状态前缀 / 群公告 / 解散） | — | 3（`PATCH /me` 增字段 + #72 + #73） | 契约未列，按 Sprint1 需求实现并文档化 |
| Sprint2（贴纸 / 我的任务） | — | 4（#44a–#44c 贴纸 + #10b `GET /me/tasks`） | 契约未列，按 Sprint2 需求实现并文档化；music/chart 属 `POST /cards` 的 kind 扩展 |
| Sprint3（AI 配置 / SSE / 报告） | — | 5（#74–#78） | 契约未列，按 Sprint3 需求实现并文档化；真实供应商未验证（本机 mock） |
| Sprint4（朋友圈 / 档案室 / 活跃度） | — | 9（#79–#87） | 契约未列，按 Sprint4 需求实现并文档化 |
| Sprint5（多 Bot / AI 指令） | — | 9（#88–#96） | 契约未列，按多 Bot 需求实现并文档化；真实供应商未验证（本机 mock） |
| Phase3（用户封禁 / 全服公告） | — | 3（#97–#99） | 契约未列，按 Phase3 补洞实现并文档化 |
| **合计** | **71（§7 63 + v1.2 §B 8）** | **104（契约 71 + Sprint1 2 + Sprint2 4 + Sprint3 5 + Sprint4 9 + Sprint5 9 + Phase3 3 + 1 条补充）** | 契约侧零偏差；补充项与 Sprint1–5/Phase3 均已文档化 |
| §6 客户端→服务端 | 8 | 8 | 一致 |
| §6 服务端→客户端 | 20（17 + 契约 v1.2 §C 的 3 个会话事件，含 `rtc:signal` 预留） | 20 | 一致 |
| §8 错误码 | 20（17 + v1.2 的 3 个会话错误码） | 22（+ Sprint5 的 BOT_NOT_FOUND / BOT_DISABLED） | 契约 20 个全实现；新增 2 个 Bot 错误码已标注 |
| §11 预留 | `POST /rtc/token`、`/rtc` 5 事件 | 单列 §2 与 §3.2 #17 | 一致，不计入 63 |

> 说明：`GET /me/devices` 为设备管理列表页所需，契约 §7 只定义了 POST / DELETE。它是唯一的契约外 REST 端点；
> 控制器层已移除重复的 `POST /auth/password`（改密只保留契约中的 `POST /me/password`）。

---

## 6. 已知歧义（需 v1.1 明确，本文档按下列口径实现）

1. **契约 §7 把 `POST /messages/:id/pin` 与 `DELETE /messages/:id/pin` 写在一行**：本文件按 2 条计，故 messages 组为 11 条而非 10 条。若契约意图按 1 条计，则总数应为 62。
2. **`POST /rtc/token` 出现在 §11 而非 §7**：本文件单独列出并返回 501，不计入 63 条。
2a. **`GET /me/devices` 契约 §7 未定义**：实现为设备管理页补充的只读列表，计入实现总数（64）但不计入契约 63。
3. **REST 发送消息的请求体契约未定义**：按与 WS `message:send` 同字段实现（含 `clientMsgId`），以保证两条路径的正确性等价。
4. **响应体字段契约大多未定义**：标 † 者为最小可用集，不新增业务语义；后续契约升版时应回填。
5. **`DUPLICATE_MESSAGE` 的 HTTP 状态是 200**（契约 §8 原文），不是 409——客户端按成功处理并读 `dup:true`。
6. **DM 退出语义**：`_contract-v1.2.md` §B 表格写「DM 退出即双方不可再读」，§D4 写「会话保留但不再对退出方可见」。本文件按 §D4 实现——仅退出方不可见、会话行与历史保留、`dm_key` 置空；若要改成双方都不可再读，需契约明确后调整 `conversations.service#removeMember` 的 DM 分支。
7. **会话视图字段结构未定义**：`GET /conversations` 的 `members[]` / `peer?` 契约只给字段名。本文件按 † 最小集实现——`members[] = { userId, handle, displayName, avatarFileId, role, lastReadSeq, joinedAt }`，`peer = { userId, handle, displayName, avatarFileId }`（仅 DM 非空）。响应外包一层具名键（列表 `{ conversations }`、单条 `{ conversation }`、用户 `{ users }`），与既有 `{ channels }` / `{ users }` 风格一致；WS 事件的 `{ conversation }` 与 REST 同构。
8. **`POST /conversations/dm` 的幂等返回状态码**：契约未规定，实现统一 200（与 `DUPLICATE_MESSAGE` 走 200 的口径一致）；`POST /conversations/group` 与 `POST /conversations/:id/members` 返回 201。
9. **Sprint1 的 `statusPrefix` / `announcement` / 解散语义**（契约未细化，实现口径如下）：
   - `statusPrefix`：`PATCH /me` 可设 `string|null`，trim 后 ≤24；`null` 或空串=清除，字段缺席=不更新；`/me`、`PublicUser`、登录响应与 WS `ready.user` 均返回该字段。
   - `announcement`：仅 `kind=group` 且调用者为该会话 `ChannelMember.role='moderator'` 可写；trim 后 ≤4000，空串=清除；返回体与列表/详情都带该字段，变更推 `conversation:updated`。
   - 解散：仅 `kind=group` 且 `channels.created_by === 调用者`；`Prisma.$transaction` 内仅置 `archived_at=now()`（软归档，消息/成员保留）；列表/详情按 `archived_at IS NULL` 过滤，归档后发消息返回 `FORBIDDEN:频道已归档，不可写入`；向所有成员 `user:<id>` 房间推 `conversation:removed { conversationId, reason:"dissolved" }`。DM/普通频道走 `DELETE /conversations/:id` 返回 `CONVERSATION_KIND_INVALID`。
10. **Sprint2 的贴纸 / 我的任务 / music-chart 语义**（契约未细化，实现口径如下）：
    - 贴纸：`POST /stickers` 只接受“本人 + `kind=image` + `status=ready`”的文件，否则分别返回 `FORBIDDEN` / `FILE_TYPE_NOT_ALLOWED` / `FILE_NOT_READY`；同一 `(owner_id,file_id)` 唯一，重复收藏按幂等返回已有贴纸；`DELETE /stickers/:id` 非本人 → `FORBIDDEN`，不存在 → `VALIDATION_FAILED`。
    - 我的任务：`GET /me/tasks` 只返回 `card_assignees.user_id=me`、`cards.task_status != 'done'`、`cards.status='open'`、`cards.deleted_at IS NULL`、`channels.archived_at IS NULL` 的任务卡；`dueAt` 升序且 NULL 排最后；`dueAt/updatedAt` 为 ISO 字符串。
    - music / chart：`POST /cards` 的 `kind` 枚举新增 `music`、`chart`，`data` 原样存 JSON（music: `{ url, title, artist, coverUrl }`；chart: `{ chartType, series }`），服务端**不发起任何外部网络抓取**；列表/详情/WS 事件与既有 card 完全同构。
11. **Sprint3 的 AI 语义**（真实供应商未验证；本机用 `ops/e2e/mock-ai.mjs` 的 OpenAI 兼容 mock）：
    - 配置项只存 DB（`ai_settings` 单行），`PUT /ai/config` 的 `apiKey` 经 AES-256-GCM 加密为 `v1:<iv>:<tag>:<cipher>`；GET/PUT/test/SSE 事件、日志、错误均**不含明文 key**，GET 只回 `keyMasked`（末 4 位）。
    - `POST /ai/chat`：需频道成员；取该频道最近 20 条未删除消息（bot 历史消息作为 assistant）作上下文，调用 `${baseUrl}/chat/completions`（`stream:true`）；逐块 `event: delta`（payload 同时带 `delta` 与 `text` 两个等价字段，便于前端任选）；完成后在**同一 Prisma 事务**内写入 bot 消息（`sender_id=00000000-0000-4000-8000-0000000000b0`、`kind=text`、body 以 `[DIJIANG/OS]` 开头，作为前端专属样式标记）并更新 `channels.last_message_at`，提交后广播 `message:new`，最后 `event: done {messageId,seq}`（seq 即消息 id 的十进制字符串）。
    - `POST /ai/report`：统计该频道**近 7 天**消息数、活跃用户数（distinct sender）、任务卡总数/完成数，prompt 使用“站长助理”叙事；SSE 与落库事务同 chat。
    - 上游异常/未配置：SSE 以 `event: error {code,message}` 结束；客户端断开时 `reply.raw` 的 close 会 abort 上游 `fetch`，不会继续消耗 token 或落库。
12. **Sprint4 的朋友圈 / 档案室 / 活跃度语义**：
    - 分页游标为不透明 base64url（`k:<createdAt 毫秒>:<id>`），按 `(createdAt desc, id desc)` 做 keyset 分页；客户端不得解析。
    - 发帖、软删均在 `Prisma.$transaction` 内执行；`DELETE` 仅作者本人（非作者 403），软删后列表/点赞/评论均不可见，数据不物理删除。
    - 点赞 `POST` / `DELETE` 幂等（`PRIMARY KEY(post_id,user_id)` + `createMany(skipDuplicates)`），响应始终带最新 `likeCount`；`likedByMe` 以当前登录用户计算。
    - `GET /archive` 只返回 `kind ∈ {material,artwork,idea}`、未删、频道未归档、且当前用户可见（公开频道 / 本人创建 / 本人是成员）的卡片，最多 100 条；`fileIds` 来自 `attachments`（按 `position` 排序）。
    - `GET /stats/activity` 为**社区总览**（不按频道过滤），窗口是过去 7 个 UTC 自然日（含今天）；`daily` 固定 7 个点、缺数据补 0；`metrics` 五项：消息量 / 活跃用户 / 任务完成 / 投票参与 / 素材数。
13. **Sprint5 的多 Bot 语义**：
    - Bot 复用 `users.is_bot=true`；`bot_profiles` 存人设/模型/密文 Key。CRUD **仅 owner**，admin 调 `/bots*` 也返回 403（RolesGuard + 服务层 assertOwner）。
    - Key 只以 AES-256-GCM 密文存 DB；列表/更新响应只回 `keyMasked`（末 4 位），任何错误/日志不含明文。
    - Bot 必须通过 `POST /channels/:id/members`（或会话加人）成为频道成员后才能被 @；加人接口用 `upsert`，重复添加不会产生第二行。
    - `botId` 省略时：从 body 的 `@显示名` 匹配该频道 Bot 成员（最长名称优先），无匹配回退默认 Bot（`dijiang_bot`）；显式 `botId` 必须已加入频道且 `enabled=true`，否则 `BOT_NOT_FOUND` / `BOT_DISABLED`。
    - 对话上下文按 `ai_channel_contexts.cleared_at` 过滤；`POST /ai/clear` **只更新水位**，聊天记录保留。Bot 消息 `sender_id` 为该 Bot 的 user id，`kind=text`、body 以 `[DIJIANG/OS]` 开头，SSE 事件结构不变。
    - `/ai/summarize` 取最近 50 条（不按 cleared_at 过滤）；`/ai/translate` 要求 `messageId` 属于该频道且未删除，否则 `VALIDATION_FAILED`。
14. **Phase3 的用户封禁 / 全服公告语义**：
    - 封禁：`PATCH /users/:id/status` 仅 owner/admin；**不能改自己、不能改 owner**；只改 `users.status`（历史消息/会话保留）；suspended 后登录与 refresh 均被 AuthService 拒绝，已有 access token 在 JwtAuthGuard 层因 `status=suspended` 被拒；写 audit `user.suspend` / `user.activate`。
    - `GET /users` 的每一项都带 `status`（active/suspended）与 `statusPrefix`，供成员管理页展示。
    - 全服公告：`system_announcements` 单行表；`GET /announcements/current` 只返回 `active=true` 的行（无公告/已关闭时 `announcement:null`）；`PUT /announcements` 空 body = 关闭（保留 body、`active=false`，不物理删）；level ∈ `info|warning|critical`；写 audit `announcement.update`。
