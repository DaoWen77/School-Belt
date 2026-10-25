# 契约 v1.2 · 会话扩展（私聊 / 群聊 / 真实前端）

> 基线：`docs/_contract.md` v1.0 + `docs/_contract-v1.1.md`
> 本文件只新增“会话”能力与前端联调约定，**不改 v1.0 的社区语义**：`kind='channel'` 的频道行为保持不变。

日期：2026-10-22　｜　状态：冻结，实现与前端以此为准

---

## A. 数据模型增量

### A1. channels 增加 3 列

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | enum `ChannelKind` = `channel \| dm \| group` | 默认 `channel`；社区频道不变 |
| `dm_key` | varchar(80) NULL | 仅 kind=dm：`sha256(排序后的两个 userId 以 ':' 连接)`；**部分唯一索引** |
| `last_message_at` | timestamptz NULL | 会话列表排序用；发消息时更新 |

- DM 的 `name` 允许空串（前端用对方显示名渲染），`visibility='private'`。
- 群聊 `kind='group'`，`visibility='private'`，`name` 必填（1–60），创建者 `channel_members.role='moderator'`。
- 社区频道 `kind='channel'` 的创建/权限/列表逻辑完全不变。
- 不新增 `conversations` 表：消息、已读、附件、线程、反应全部复用现有 `messages` / `channel_members`，代价是 `channels` 表承担三种会话；收益是零重复的消息链路。

### A2. 索引

```sql
CREATE TYPE "ChannelKind" AS ENUM ('channel', 'dm', 'group');
ALTER TABLE channels ADD COLUMN kind "ChannelKind" NOT NULL DEFAULT 'channel';
ALTER TABLE channels ADD COLUMN dm_key varchar(80);
ALTER TABLE channels ADD COLUMN last_message_at timestamptz;
CREATE UNIQUE INDEX channels_dm_key_key ON channels (dm_key) WHERE dm_key IS NOT NULL;
CREATE INDEX channels_kind_position_idx ON channels (kind, position);
```

---

## B. REST 增量（`/api/v1`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/conversations` | 登录 | 返回当前用户的 DM + 群聊列表：`{ id, kind, name, members[], peer?, lastMessageAt, lastMessagePreview, unreadCount, myRole }`，按 `lastMessageAt desc nulls last` 排序 |
| GET | `/conversations/:id` | 会话成员 | 详情 + 成员（含角色、在线状态可另行查） |
| POST | `/conversations/dm` | 登录 | body `{ userId }`；幂等：同一对人永远返回同一条；不能和自己建 |
| POST | `/conversations/group` | 登录 | body `{ name, memberIds: string[] }`（含自己，去重，≤50）；创建者 moderator |
| PATCH | `/conversations/:id` | moderator | body `{ name }`，仅群聊可改名 |
| POST | `/conversations/:id/members` | moderator | body `{ userIds: string[] }`，仅群聊；DM 不可加人 |
| DELETE | `/conversations/:id/members/:userId` | moderator 或本人 | 本人=退出；moderator=移除；DM 退出即双方不可再读 |
| GET | `/conversations/users` | 登录 | 可发起会话的用户：`{ id, handle, displayName, avatarFileId }[]`（排除自己，按 displayName 排序） |

消息/已读/线程/成员仍用既有 `/channels/:id/messages`、`/channels/:id/read`、`/channels/:id/members`；**前端把 DM/群聊的 id 当 channelId 用**。

错误码沿用 v1.0 §8，新增：

| code | HTTP | 含义 |
| --- | --- | --- |
| `CONVERSATION_NOT_FOUND` | 404 | 会话不存在或已不可见 |
| `CONVERSATION_KIND_INVALID` | 400 | 对 DM 执行加人/改名等非法操作 |
| `DM_SELF` | 400 | 不能和自己建私聊 |

---

## C. WebSocket 增量

| 方向 | 事件 | payload | 说明 |
| --- | --- | --- | --- |
| S→C | `conversation:created` | `{ conversation }` | 群聊创建后推给每个成员；DM 创建后推给双方 |
| S→C | `conversation:updated` | `{ conversation }` | 改名/成员变化 |
| S→C | `conversation:removed` | `{ conversationId, reason: "left"\|"removed" }` | 被移除/退出 |

其余事件不变；`channel:join` 对 DM/群聊同样适用，房间名仍为 `channel:<id>`。

---

## D. 权限

1. DM/群聊只有 `channel_members` 成员可读；owner/admin **不可**越权读。
2. 创建 DM：任何 `member` 都可以；创建群聊：任何 `member` 都可以。
3. 群聊管理：创建者 `moderator`；moderator 可改名、加人、移除成员；普通成员可自行退出。
4. DM 不加人、不改名、不可转让；双方任一方退出后会话保留但不再对退出方可见（重新发起需要新建）。
5. 禁言只拦“写”，对 DM 不适用（DM 双方均可发言，除非全站禁言）。

---

## E. 前端联调约定

| 项 | 值 |
| --- | --- |
| 工程 | `web/`，Next.js（App Router）+ React + TypeScript，不使用 UI 框架 |
| 样式 | 只做甲套（endfield-ui）：纸 `#F4F4F2`、墨 `#161616`、黄 `#FFFA00` 仅做填充、切角按钮、Saira 字体、1px 细线 |
| 端口 | `next dev -p 3100`；API 默认 `http://localhost:3000` |
| 环境变量 | `NEXT_PUBLIC_API_BASE`、`NEXT_PUBLIC_WS_PATH`（默认 `/socket.io`） |
| 鉴权 | access token 存内存 + localStorage；401 自动 refresh 一次；WS auth 用 access token |
| 发送 | 乐观显示 pending → ack 换成服务端 message；5s 超时用同一 `clientMsgId` 重试；按 id 去重 |
| 断线 | 指数退避 1/2/4/8/16s；`ready` 后按本地 lastSeq 调 `direction=newer` 补拉 |
| 已读 | 进入会话/收到新消息时 500ms 节流上报 |
| 私聊 | 侧栏“私聊”分组；新建私聊从用户列表选人；DM 显示对方名字 |
| 群聊 | 侧栏“群聊”分组；新建群聊填名称 + 多选成员；群详情可改名/加人/移除/退出 |

CORS：后端 `CORS_ORIGINS` 必须包含 `http://localhost:3100`（开发）与部署域名。

---

## F. 验收（真实链路）

必须在本机用**真实 Postgres**（`embedded-postgres` 或等价）跑通，不能用 mock：

1. `POST /auth/login` 两个账号，各自拿到 access token。
2. 两端各连 `/ws`，`ready` 成功。
3. A 在社区频道发消息，B 在 300ms 内收到；A 的 ack 带服务端 id。
4. A 对 B 发起 DM，B 收到 `conversation:created`；双方互发，消息可收。
5. A 建群聊（含 B、C），B/C 收到 `conversation:created`；群内发消息，B/C 都收到。
6. 断线：B 断开 3s 后重连，`ready` 后按 lastSeq 补拉，无重复、无空洞。
7. 前端 Playwright（Chrome）走一遍：登录 → 频道发消息 → 新建 DM → 发消息 → 新建群聊 → 发消息；截图留证。
8. 前端 `next build` 通过。

---

## G. 非目标

- 不做已读回执的“对方已读”UI（先保留接口）。
- 不做消息编辑/删除的前端入口（接口已有）。
- 不做语音/视频。
- 不做移动端适配（桌面 1440 优先，窄屏不崩即可）。
