# Phase 3 · 接口 ↔ 前端 UI 入口一致性审计

- 扫描范围：`server/src/**/*.controller.ts`
- 路由总数：**102 条**（20 个 Controller）
- 前端范围：`web/src/**`（API 封装 + 页面/组件入口）
- 结论口径：✅ 调用与入口都有；◐ 部分（有调用无完整入口，或只有入口无完整能力）；✗ 无调用/无入口；⛔ 后端无对应接口
- 本轮只审计，不改代码。

## 1. 总表

| 功能名称 | 接口路径 | 前端调用 | UI 入口 | 建议放置位置 |
| --- | --- | --- | --- | --- |
| 登录 | POST /auth/login | ✅ | ✅ 登录页 | — |
| 邀请码注册 | POST /auth/register | ✅ | ✅ 登录页 | — |
| Token 刷新 | POST /auth/refresh | ✅ | ✅ 自动 | — |
| 登出 | POST /auth/logout | ✅ | ✅ Topbar | — |
| 我的资料（名/前缀/头像） | GET/PATCH /me | ✅ | ✅ 设置页 | — |
| 修改密码 | POST /me/password | ✗ | ✗ | 设置页「安全」 |
| 通知/DND/主题设置 | GET/PATCH /me/settings | ✗ | ✗ | 设置页「通知」 |
| 设备管理 | GET/POST/DELETE /me/devices | ✗ | ✗ | 设置页「设备」 |
| 我的任务 | GET /me/tasks | ✅ | ✅ 侧栏折叠区 | — |
| 用户目录 | GET /users、/users/:id | ✅ | ✅ 私聊/成员选择 | — |
| **用户封禁/停用** | **⛔ 无接口**（仅 UserStatus.suspended + 登录拦截） | ✗ | ✗ | 设置→成员管理，新增 `POST /users/:id/status` |
| 频道列表/详情 | GET /channels、/channels/:id | ✅ | ✅ 侧栏/主区 | — |
| 频道创建/改名/删除 | POST/PATCH/DELETE /channels | ✗ | ✗ | 设置→频道管理（owner/admin） |
| 频道成员列表 | GET /channels/:id/members | ✅ | ✅ 详情抽屉 | — |
| 频道加人/改角色/移除 | POST/PATCH/DELETE /channels/:id/members | ◐ | ◐ 加人/移除；改角色无 | 详情抽屉「成员管理」 |
| 已读上报 | POST /channels/:id/read | ✅ | ✅ 自动 | — |
| 会话列表/详情/用户 | GET /conversations、/:id、/users | ✅ | ✅ 侧栏 | — |
| 新建私聊 | POST /conversations/dm | ✅ | ✅ 新建私聊 | — |
| 新建群聊 | POST /conversations/group | ✅ | ✅ 新建群聊 | — |
| 群改名 | PATCH /conversations/:id | ✅ | ✅ 详情抽屉 | — |
| **群公告** | PATCH /conversations/:id/announcement | ✅ | ✅ 详情抽屉 Markdown | — |
| 群加人/移除 | POST/DELETE /conversations/:id/members | ✅ | ✅ 详情抽屉（二次确认） | — |
| **群聊解散（归档）** | DELETE /conversations/:id | ✅ | ✅ 群主危险区（输入群名） | — |
| 消息列表/发送/编辑/删除 | GET/POST /channels/:id/messages、PATCH/DELETE /messages/:id | ✅ | ✅ 消息流 | — |
| 线程 | GET /channels/:id/thread | ✅ | ✅ 消息线程 | — |
| 消息转卡 | POST /channels/:id/convert | ✗ | ✗ | 消息操作菜单（下一轮） |
| **消息置顶（pin/unpin）** | POST/DELETE /messages/:id/pin | ✗ | ✗ | 消息 hover 操作 + 详情置顶管理 |
| 置顶列表 | GET /channels/:id/pins | ✅ | ✅ 详情抽屉（只读） | — |
| 表情反应 | POST/DELETE /messages/:id/reactions | ✗ | ✗ | 消息 hover 表情条 |
| 文件预签名/完成/URL/频道文件 | POST /files/presign、/:id/complete、GET /:id/url、/:id/files | ✅ | ✅ 附件/素材/贴纸 | — |
| 卡片列表/详情 | GET /cards/:id、/channels/:id/cards | ✅ | ✅ 消息流 RichCard | — |
| 卡片创建（素材/投票/任务/音乐/图表） | POST /cards | ✅ | ✅ Composer ＋菜单 | — |
| 卡片编辑/指派/关闭/投票/结果 | PATCH /cards/:id、/assign、/close、/vote、/results | ✅ | ✅ 卡片内操作 | — |
| 卡片排序/转卡 | POST /cards/reorder、/convert | ✗ | ✗ | 卡片管理（下一轮） |
| 全局搜索 | GET /search | ✅ | ✅ Cmd+K | — |
| 频道内搜索 | GET /channels/:id/search | ✗ | ✗ | 频道 Header 搜索 |
| 通知列表/已读/未读数 | GET /notifications、/read、/unread-count | ✗ | ✗ | Topbar 铃铛 + 通知中心 |
| Presence | GET /presence | ✗ | ✗ | 成员列表在线态（WS 已有部分） |
| 邀请码创建/列表/撤销/预览 | POST/GET/DELETE /invites、GET /:code/preview | ✅ | ✅ 设置页「邀请成员」 | — |
| 贴纸 CRUD | POST/GET/DELETE /stickers | ✅ | ✅ Composer 贴纸面板 | — |
| 朋友圈列表/发帖/删除 | GET/POST/DELETE /posts | ✅ | ✅ 朋友圈视图 | — |
| 点赞/评论 | POST/DELETE /posts/:id/like、GET/POST comments | ✅ | ✅ 朋友圈 | — |
| 档案室 | GET /archive | ✅ | ✅ 档案室 Terminal | — |
| 活跃度统计 | GET /stats/activity | ✅ | ✅ 侧栏 HUD 雷达 | — |
| AI 配置/连通性 | GET/PUT /ai/config、POST /ai/test | ✅ | ✅ 设置页（owner/admin） | — |
| AI 聊天/报告/清空/总结/翻译 | POST /ai/chat、/report、/clear、/summarize、/translate | ✅ | ✅ @Bot / 指令 | — |
| **Bot 管理 CRUD/测试** | GET/POST /bots、PATCH/DELETE /bots/:id、POST /:id/test | ✅ | ✅ 设置页（仅 owner） | — |
| 频道 Bot 列表 | GET /channels/:id/bots | ✅ | ✅ 详情加人 [BOT] | — |
| 健康检查 | GET /healthz、/readyz | ✅ | ✅ 登录服务器测试/错误态 | — |
| Metrics | GET /metrics | ✗ | ✗ | 运维面板（不需要前端） |
| RTC Token | POST /rtc/token | ✗ | ✗ | 预留（当前 NOT_IMPLEMENTED） |

## 2. 重点功能结论

| 重点项 | 后端 | 前端调用 | UI 入口 | 结论 |
| --- | --- | --- | --- | --- |
| 用户封禁 | ⛔ 无接口（只有 suspended 状态与登录拦截） | ✗ | ✗ | **后端 + UI 都缺** |
| 全服公告 | ⛔ 无全局公告接口（只有群公告） | ✗ | ✗ | **后端 + UI 都缺** |
| Bot 管理 | ✅ | ✅ | ✅ owner 设置页 | 完整 |
| 群聊解散 | ✅ | ✅ | ✅ 群主危险区 | 完整 |
| 置顶 | ✅ pin/unpin/list | ✗ pin/unpin / ✅ list | ◐ 仅只读列表 | **缺 pin/unpin 入口** |

## 3. 明确缺口（按优先级）

### P1：管理闭环缺口

1. **用户封禁**：后端没有 suspend 接口；建议 `PATCH /users/:id/status {status: active|suspended}` + 设置页成员管理。
2. **全服公告**：没有全局公告模型/接口；建议 `system_announcements` 单行表 + `GET/PUT /admin/announcement`，前端 Topbar banner + 设置页编辑。
3. **消息置顶**：有 pin/unpin API 但消息操作菜单没有入口；建议 MessageItem 菜单加「置顶/取消置顶」，详情抽屉置顶区加取消。
4. **通知中心**：3 个通知接口完全无 UI；建议 Topbar 铃铛 + 未读角标。
5. **表情反应**：2 个接口完全无 UI；建议消息 hover 表情条。

### P2：个人设置缺口

6. 修改密码、DND/通知设置、设备管理均无 UI，建议设置页拆「资料 / 通知 / 安全 / 设备」Tab。
7. 频道创建/改名/删除无 UI；频道成员「改角色」无 UI。
8. 频道内搜索无 UI；卡片排序/转卡无 UI。
9. RTC 仍是预留，不建议现在做 UI。

## 4. 扫描方法

- 路由：正则提取 `@Controller` + `@Get/@Post/@Patch/@Delete/@Put`，共 102 条。
- 前端调用：`web/src` 全量搜索 API 字符串（`/notifications`、`/reactions`、`/bots` 等）并核对调用点。
- UI 入口：按页面/组件人工核对（设置页、详情抽屉、Composer、消息流、侧栏、朋友圈、档案室）。
- 未做：运行时抓包逐条调用；结论基于静态代码审计。
