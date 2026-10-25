# Sprint 5 前端验收报告（task-27）

日期：2026-10-24　｜　范围：`web/**`、`docs/18`、`reports/frontend`　｜　真实 API 3000

> 测试策略：`pnpm build` + 本 Sprint 截图 + 一个 node 指令断言脚本；不跑全量。

## 1. 构建

`cd web && pnpm build` → **exit 0**（`reports/frontend/build.log`）：

```text
▲ Next.js 15.5.28
✓ Compiled successfully
✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                     251 kB         361 kB
├ ○ /_not-found                            993 B         103 kB
├ ƒ /api/ai/[kind]                         122 B         102 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               3.42 kB         106 kB
└ ○ /settings                             5.4 kB         115 kB
+ First Load JS shared by all             102 kB
```

## 2. 邀请成员 UI（仅 owner/admin）

文件：`web/src/app/settings/page.tsx`

- 仅 `globalRole owner/admin` 渲染「Invites / 邀请成员」；普通成员完全不渲染。
- 表单：role（member/admin）、maxUses（1–10）、expiresInDays（1–30）→ `POST /invites`。
- 创建成功一次性展示**明文 code** + 复制按钮；`code` 只存在 React state，**未写入 localStorage**。
- 列表 `GET /invites`：codePrefix / role / uses/maxUses / expiresAt / status；`DELETE /invites/:id` 撤销（二次确认）。
- 加载/空态/错误态齐全。

实测（真实 API）：
```json
{
  "hasSection": true,
  "codeVisible": true,
  "code": "DJ-TRKE-8264",
  "codeInLocalStorage": false,
  "listHasPrefix": true,
  "statusActive": true,
  "memberHasInviteSection": false,
  "memberHasAiSection": false
}
```

截图：`sprint5-invite-1440.png`（owner：明文码 + 列表）、`sprint5-invite-member-1440.png`（普通成员无区块）。

## 3. 斜杠指令：8 条逐项状态

**解析集中在 `web/src/lib/commands.ts`（纯函数 `parseStartCommand`）**；`Workspace.sendFromComposer` 在调用 `sendMessage` 前统一 `return`，确保不进入 WS 文本发送。

| # | 指令 | 状态 | 行为 |
| --- | --- | --- | --- |
| 1 | `/task` | **刚补齐** | 清空 draft → `setCardDialog('task')`，不发送 |
| 2 | `/poll` | **刚补齐** | 清空 draft → `setCardDialog('vote')`，不发送 |
| 3 | `/tasks` | **刚补齐** | 清空 draft → 打开侧栏并 dispatch `dj:tasks-open`；Sidebar 展开/滚动到「我的任务」，不发送 |
| 4 | `/goto <频道名>` | **刚补齐** | 精确前缀；按名称找频道/会话并切换；找不到追加本地 `[GOTO] 未找到频道…` 系统消息，不发送 |
| 5 | `/report` | 保留（接入 parser） | 清空 draft → 正常发送 `/report` 后调用 `/ai/report` 流式报告 |
| 6 | `/ping` | 保留（接入 parser） | 清空 draft → 本地 `[PING]` 消息（REST + WS），不发送后端 |
| 7 | `sudo rm -rf /` | 保留（接入 parser） | 清空 draft → 全屏彩蛋 3s 后恢复，不发送、不请求 |
| 8 | 未识别 `/xxx` | 明确策略 | 返回 `none`，**按普通消息发送**（不拦截；报告中明确） |

严格匹配：
- `/^\/task$/`、`/^\/poll$/`、`/^\/tasks$/`、`/^\/report$/`、`/^\/ping$/`、`/^sudo\s+rm\s+-rf\s+\/$/`（`trim` 允许尾随空格）
- `/^\/goto\s+(.+)$/`
- 负例：`/botany`、`/tasks2`、`/task foo`、`/polling`、`/goto`、`/report x`、`/pingx`、`sudo rm -rf /tmp`、`/unknown` 全部返回 `none`。

### 断言脚本

`node --experimental-strip-types reports/frontend/sprint5-commands-check.mjs`：

```json
{
  "ok": true,
  "positive": 8,
  "negative": 9,
  "negativeCases": ["/botany","/tasks2","/task foo","/polling","/goto","/report x","/pingx","sudo rm -rf /tmp","/unknown"]
}
```

### UI 实测

- 输入 `/task` 回车：任务弹窗打开；输入框 `draft=""`；消息数前后均为 **8**（未产生 WS 消息）。
- 截图：`sprint5-commands-1440.png`。

## 4. 截图（reports/frontend/）

| 文件 | 内容 |
| --- | --- |
| `sprint5-invite-1440.png` | owner：一次性明文码 + 邀请列表 |
| `sprint5-invite-member-1440.png` | 普通成员设置页无邀请/AI 区块 |
| `sprint5-commands-1440.png` | `/task` 被拦截，任务弹窗，输入框已清空 |

机器结果：`sprint5-report.json`；指令断言脚本 `sprint5-commands-check.mjs`。

## 5. 校验计数

```text
errors = []
pageErrors = []
failedRequests = []
invite.codeInLocalStorage = false
member.hasInviteSection = false
commands.dialogOpen = true
commands.draft = ""
commands.beforeMessages = commands.messages = 8
```

## 6. 未验证 / 已知限制

1. 撤销邀请按钮/二次确认已实现，但为保留截图数据**未实际点击撤销**；列表与状态已验。
2. 复制按钮 UI 已接入 `navigator.clipboard`，未在自动化中校验剪贴板内容（code 明文与不落 localStorage 已验）。
3. `/poll`、`/tasks`、`/goto` 的 UI 行为已实现并由 parser 断言覆盖，但本轮只对 `/task` 做了浏览器弹窗截图；`/tasks` 的滚动展开与 `/goto` 切换未单独截图。
4. 未识别 `/xxx` 选择「按普通消息发送」，会进入正常 WS；若后续希望改为提示，可在 parser 返回 `unknown` 后调整。
5. 普通成员无邀请区块已验；admin 角色邀请创建后的权限/登录链路未在 UI 走完（后端 invites 权限/契约已存在）。
6. 只跑 build + 本 Sprint 冒烟；未跑 Sprint1–4/全量回归。
