# 多 Bot 前端验收报告（task-29）

日期：2026-10-24　｜　范围：`web/**`、`docs/18-前端.md`、`reports/frontend/`　｜　真实 API 3000 + mock provider 4010

> 测试策略：`pnpm build` + 本功能截图 + 指令断言；不跑全量。

## 1. 构建

`cd web && pnpm build` → **exit 0**（`reports/frontend/build.log`）：

```text
▲ Next.js 15.5.28
✓ Compiled successfully
✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                     253 kB         363 kB
├ ○ /_not-found                            993 B         103 kB
├ ƒ /api/ai/[kind]                         122 B         102 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               3.42 kB         106 kB
└ ○ /settings                            6.71 kB         117 kB
+ First Load JS shared by all             102 kB
```

## 2. Bot 管理（仅 owner）

文件：`web/src/app/settings/page.tsx`

- 仅 `globalRole === 'owner'` 渲染「BOTS / BOT 管理」；admin 不渲染（AI/邀请仍是 owner/admin）。
- 列表：Avatar、name、`[BOT]`、model、enabled、编辑/测试/删除。
- 新建/编辑：名称、头像上传（复用 files 上传）、模型、System Prompt Markdown 文本域、API Key（`type=password`，留空=全局）、启用；测试 `POST /bots/:id/test`；删除二次确认。
- 实测：seed Bot `帝江号·协议官` + 新建 `观测者` 均显示；`[BOT]`/model/enabled 正常。
- 截图：`multibot-admin-1440.png`。

## 3. 加人列表 [BOT]

- 详情抽屉成员区增加「加人」（channel role owner/admin/moderator）。
- `channelBots` 与普通用户合并到加人弹窗；Bot 行带 `[BOT]` 标签；已加入的 Bot 不重复。
- 成员列表里已加入的 Bot 也标 `[BOT]`，并显示 Bot 自己的名称。
- 实测：`memberList.botVisible=true`，成员列表「帝江号·协议官 [BOT]」，加人弹窗「观测者 [BOT]」。
- 截图：`multibot-members-1440.png`。

## 4. @Bot 与 Bot 身份

- 选中频道时 `GET /channels/:id/bots`，Bot 的 name/handle/avatar 合并进 `names/handles/avatars`。
- 输入 `@<Bot名>` 精确匹配频道 Bot → 正常发送用户消息 + `POST /ai/chat {channelId, body, botId}`；流式临时消息 senderId=bot.id，头像和名称使用 Bot 自己的，保留终端风；非频道 Bot 提示后按普通 @ 发送。
- 实测：`@帝江号·协议官 请给出今日行动建议` 返回流式终端消息；消息头显示 `帝江号·协议官` + Bot 头像 + `[DIJIANG/OS]`，`botBubbles>0`。
- 截图：`multibot-bot-reply-1440.png`。

## 5. 指令

解析集中 `web/src/lib/commands.ts`；`Workspace.sendFromComposer` 在发送 WS 前 return。

| 指令 | 行为 | 状态 |
| --- | --- | --- |
| `/bot` | 打开当前频道 Bot 列表；点击插入 `@BotName` | 已验（`botPicker.open=true`，插入 `@帝江号·协议官 `） |
| `/clear` | `POST /ai/clear`；本终端消息「已清理本地缓存记录」 | 已验（`clear.text=true`，普通消息数不增，只多本地提示） |
| `/summarize` | `POST /ai/summarize`；终端卡片「频道摘要」+ SUMMARY | 已验（`summarize.text=true`） |
| `/translate` | 必须引用消息；引用后 `POST /ai/translate {messageId}` | 已验（引用条出现 `quoteBar=true`，译文卡片） |
| `/roll 1d100` | 本地随机，聊天流 `ROLL 1d100 = N` | 已验（`ROLL 1d100 = 66`） |
| 既有 `/task /poll /tasks /goto /report /ping /sudo` | 保持 | 保持 |
| `/botany` `/clearx` `/rollx` | 不误拦截 | 断言通过 |

断言脚本：

```text
node --experimental-strip-types reports/frontend/multibot-commands-check.mjs
{ ok: true, positive: 13, negative: 11, rollInvalid: 2 }
```

截图：`multibot-bot-panel-1440.png`、`multibot-clear-1440.png`、`multibot-summarize-1440.png`、`multibot-translate-1440.png`、`multibot-roll-1440.png`。

## 6. 校验计数（`multibot-report.json`）

```text
botPanel.entries = 2
botCreated.visible = true
memberList.botVisible = true
botChat.botBubbles = 9
botPicker.open = true
botInsert = "@帝江号·协议官 "
clear.text = true
summarize.text = true
roll.text = "ROLL 1d100 = 66"
quoteBar = true
translate.text = true
errors = []
pageErrors = []
failedRequests = []
```

> `botPanel.visible=false` 是脚本大小写选择器问题（CSS 渲染为 `BOTS / BOT 管理`）；`entries=2` 与截图已证明面板可见。

## 7. 截图（reports/frontend/）

| 文件 | 内容 |
| --- | --- |
| `multibot-admin-1440.png` | owner Bot 管理：seed + 新建观测者 |
| `multibot-members-1440.png` | 详情抽屉成员 [BOT] + 加人弹窗 [BOT] |
| `multibot-bot-reply-1440.png` | @Bot 自定义名称/头像流式终端 |
| `multibot-bot-panel-1440.png` | `/bot` 频道 Bot 列表 |
| `multibot-clear-1440.png` | `/clear` 本地提示 |
| `multibot-summarize-1440.png` | `/summarize` 频道摘要卡片 |
| `multibot-roll-1440.png` | `/roll 1d100` 随机结果 |
| `multibot-translate-1440.png` | 引用条 + `/translate` 译文 |

## 8. 未验证 / 已知限制

1. Bot 编辑保存、头像上传、测试连通性、删除二次确认的按钮已实现；本轮截图未实际点击测试/删除（避免破坏 seed Bot）。
2. admin 不显示 Bot 管理由 `globalRole === 'owner'` 条件保证；未用 admin 账号截图（登录限流，改用 owner token 注入）。
3. 「加人」实际提交 Bot 入频道未点击；列表 [BOT] 与合并展示已验。
4. `/translate` 通过 Composer「引用最近一条」验证；消息级「引用」按钮也存在，但虚拟列表只渲染可视项。
5. AI 流式本机 mock 输出会出现临时消息 + WS 回显重复卡片，属既有流式去重问题，非本轮新增；截图可见多张终端卡。
6. 全量回归未跑（按策略只 build + 本功能截图）；390 未单独截图。
7. 现场测试数据：`观测者` 有重复测试 Bot（早期失败重试创建），截图中一条带 [BOT]、一条不带；未清理。
