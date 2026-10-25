# 文明环带 Phase C · 环带壳与内容完成报告

日期：2026-10-25  
范围：C｜环带壳、登录/注册、频道、快报、悬赏、日常、电文、帖子详情、进入/拒绝过场  
未进入：D（好友与 DM）、E（RSS / 桥接）

## 1. 结论

C 阶段完成，并通过真实 API + PostgreSQL + 浏览器验证：

- `/belt` 暗面“外环中继”布局上线。
- 环带登录 / 注册 / 内部 handoff 兑换可用。
- 公共频道实时聊天：REST 发送 + `/ws/belt` 实时投递。
- 环带快报、悬赏委托、干员日常、环带电文四个版块与帖子详情/点赞/评论可用。
- 公网职位匿名可读帖子；发言需要 belt 会话。
- 内部侧边栏新增【接入文明环带】入口，真实播放 1.5 秒终端过场。
- 外网无 `[极光科技]` 标签点击【登入 O.M.V 帝江号】会触发红色协议拒绝，3 秒后弹回环带。
- 内部账号从环带登入帝江号：校验 → 1.2 秒确认 → 内部会话 → `/`。

## 2. 数据库

迁移：[0011_belt_content/migration.sql](../../server/prisma/migrations/0011_belt_content/migration.sql)

新增枚举：

- `PostSource`：`user / official / rss / system`
- `PostStatus`：`published / hidden / removed`
- `BountyStatus`：`open / in_talk / closed`

`posts` 新增：

- `title`、`source`、`source_url`、`source_name`
- `published_at`、`pinned_at`
- `status`、`moderated_by`、`moderated_at`、`moderation_reason`
- `bounty_status`、`bounty_reward`、`bounty_deadline`

约束与索引：

- `bounty_status` 只允许出现在 `board='bounty'`。
- `title` 1–120 字符。
- `posts(surface, board, published_at desc)`。

`post_comments` 新增 `deleted_at`、`deleted_by`。

现有朋友圈回填 `published_at=created_at`。

运行态初始化：`BeltService.onModuleInit` 确保 `环带频道`（slug `belt-channel`）存在；当前库只有一条，不重复创建。

## 3. 后端

新增 `BeltModule`：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/belt/me` | belt 会话身份 + 证章 |
| GET | `/api/v1/belt/channels` | 环带公开频道 |
| GET | `/api/v1/belt/channels/:id/messages` | 最近消息 |
| POST | `/api/v1/belt/channels/:id/messages` | 发消息 |
| GET | `/api/v1/belt/posts?board=` | 帖子列表，公开可读 |
| GET | `/api/v1/belt/posts/:id` | 帖子详情，公开可读 |
| GET | `/api/v1/belt/posts/:id/comments` | 评论，公开可读 |
| POST | `/api/v1/belt/posts` | 发帖：bulletin 仅 Owner/Admin |
| POST/DELETE | `/api/v1/belt/posts/:id/like` | 认同 / 取消 |
| POST | `/api/v1/belt/posts/:id/comments` | 回波 |
| DELETE | `/api/v1/belt/posts/:id` | 作者 / 协议官删除 |

关键安全/边界：

- 公开 GET 使用 `@OptionalAuth()`，没有 Bearer 也可读；有 Bearer 则返回 `likedByMe`。
- 帖子只查 `surface='belt'`，不会混入内部朋友圈。
- `moments` 不是合法环带版块，返回 400。
- `bulletin` 只允许全站 Owner/Admin，来源强制 `official`。
- `telegraph` 只能由 E 阶段 RSS 写入，C 阶段不提供发布接口。
- 环带频道 WS 独立命名空间 `/ws/belt`，只接受 `sessions.surface='belt'`。
- 发消息走 REST 单一路径；WS 只负责广播，避免双写和绕过限流。

新增文件：

- [belt.module.ts](../../server/src/belt/belt.module.ts)
- [belt.controller.ts](../../server/src/belt/belt.controller.ts)
- [belt.service.ts](../../server/src/belt/belt.service.ts)
- [belt-channels.service.ts](../../server/src/belt/belt-channels.service.ts)
- [belt-posts.service.ts](../../server/src/belt/belt-posts.service.ts)
- [belt-ws.gateway.ts](../../server/src/belt/belt-ws.gateway.ts)

## 4. 前端

新增：

- `/belt/channel`
- `/belt/dispatch`
- `/belt/bounty`
- `/belt/daily`
- `/belt/telegraph`
- `/belt/posts/[id]`
- `/belt/login`
- `/belt/register`
- `/belt/access`
- `/belt/handoff`

视觉：

- 固定暗面信号室：黑纸 / 骨白字 / 酸黄 `LIVE`。
- 左侧频段索引 `01–05`，当前项黄块 + trace。
- 频道不是气泡，是“信号日志”：时间戳 / 发信人证章 / 正文。
- 快报/悬赏/日常/电文都是台账式行，不是普通论坛卡片。
- 头部实时时钟、载波、外环中继编号。
- 登录页 `CIVILIZATION` 大字 + 呼号/口令。
- 外部无标签访问内部时，红色 `PROTOCOL DENIED` 雪花 + 3 秒强制断开。

过场：

- 内部侧边栏 `External Link / 接入文明环带`。
- 点击后全屏 1.5 秒终端：物理链路 → 解密频段 → 握手成功 → ROUTE BELT-07。
- 1.5 秒后跳 `/belt/handoff`，兑换 belt 会话。
- 反向：`/belt/access` → 校验 → 1.2 秒 `ACCESS GRANTED` → 内部 token → `/`。
- 拒绝：`/belt/access` 403 → 3 秒红色雪花 → 回 `/belt/channel`。
- reduced-motion 下关闭终端逐字/雪花动画，但保留流程与倒计时。

## 5. 验证

### 后端

```text
pnpm build      -> exit 0
pnpm typecheck  -> exit 0
pnpm test       -> 17 files / 173 tests passed
```

真实 API：

```text
PHASE_C_RESULT={"ok":true,"checks":31}
```

覆盖：

- 内部 handoff → belt 会话；
- 频道发消息 / 读消息 / 发送者证章；
- 公开读帖子 / 登录发帖 / 点赞 / 评论；
- 官方快报仅协议官；
- 外网账号不能发官方快报；
- 外网账号不能内部登录；
- 内部朋友圈不混入环带帖子。

### 前端

```text
pnpm build
✓ Compiled successfully
17 routes
/belt/channel    127 kB first load
/belt/access     123 kB
/settings        122 kB
```

UI：

```text
BELT_WS_READY true
BELT_WS_MESSAGE 1548
OWNER_BADGE_IN_BELT true
CHANNEL_HAS_SIGNAL true
ENTRY_LINES 物理链路 → 解密频段 → 握手成功 → ROUTE BELT-07
ENTRY_URL_AFTER_1500 /belt/handoff?code=...
ENTRY_URL_AFTER_HANDOFF /belt/channel
DENIAL_HAS_PROTOCOL true
DENIAL_RETURN_URL /belt/channel
```

授权路径另行验证：

```text
ACCESS_GRANTED_URL http://127.0.0.1:3100/
INTERNAL_TOKENS { access: true, refresh: true }
```

### 截图

- [环带登录](../frontend/phase-c-belt-login-1440.png)
- [环带频道：实时消息 + 证章 + TRANSMIT](../frontend/phase-c-belt-channel-1440.png)
- [环带快报](../frontend/phase-c-belt-dispatch-1440.png)
- [悬赏委托](../frontend/phase-c-belt-bounty-1440.png)
- [干员日常](../frontend/phase-c-belt-daily-1440.png)
- [环带电文空态](../frontend/phase-c-belt-telegraph-1440.png)
- [帖子详情与回波](../frontend/phase-c-belt-post-1440.png)
- [内部 1.5 秒终端过场](../frontend/phase-c-internal-entry-1440.png)
- [无标签协议拒绝](../frontend/phase-c-denial-1440.png)
- [登入帝江号门禁](../frontend/phase-c-belt-access-1440.png)

## 6. 当前运行态

- API `http://127.0.0.1:3000`，`/readyz` 200（postgres / s3 / redis）
- Web `http://127.0.0.1:3100`，`/belt/channel` 200
- PostgreSQL `55432`、Redis `6379`、S3 `9000`
- 11 个迁移全部应用，`prisma migrate status` up to date
- 环带默认频道保留；测试帖子/消息/外网账号已清理

## 7. 已知边界

- 悬赏【建立联络】目前显示“D 阶段开放”提示，尚未创建好友申请或 DM。
- 环带电文为空态，RSS 引擎和 `rss_items` 在 E 阶段。
- 桥接卡片 / Outbox / System Bot 在 E 阶段。
- 环带 C 阶段不支持附件与头像上传（按确认的约束）。
- 公开帖子 API 可匿名读，但 `/belt` 页面本身要求登录后使用；这是为了让频道、发言和导航共享同一 belt 会话。
- `React #418` hydration 警告在浏览器控制台仍存在，继承自现有全局主题/布局，不影响 C 功能；建议后续单独处理。
- 环带帖子分页已支持 cursor；评论只取最近 50 条，没有“加载更多评论”。
- 没有环带管理后台：官方快报由 Owner/Admin 在 `/belt/dispatch` 直接发布。
