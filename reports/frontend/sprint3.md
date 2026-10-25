# Sprint 3 前端验收报告（task-24）

日期：2026-10-24　｜　范围：`web/**`（未改 server/ops/design）　｜　真实 API 3000 + mock provider 4010

> 测试策略遵循要求：只跑 `pnpm build` + 本 Sprint 截图冒烟，不跑全量回归。真实 LLM 供应商未验证。

## 1. 构建

`cd web && pnpm build` → **exit 0**（`reports/frontend/build.log`）：

```text
▲ Next.js 15.5.28
✓ Compiled successfully
✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                     150 kB         260 kB
├ ○ /_not-found                            993 B         103 kB
├ ƒ /api/ai/[kind]                         122 B         102 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               3.42 kB         106 kB
└ ○ /settings                            4.36 kB         114 kB
+ First Load JS shared by all             102 kB
```

## 2. 功能映射

### 2.1 设置页 AI 面板（仅 owner/admin）

- `settings/page.tsx` 依据 `globalRole` 为 `owner` / `admin` 才渲染；普通成员完全不渲染。
- `GET /ai/config` 只读展示 `configured/baseUrl/model/keyMasked`；Key 输入框为 `type=password`，**不回填、不显示明文**，占位「已配置（留空不修改）」。
- 保存：`PUT /ai/config` 发送 `{ baseUrl, model, apiKey? }`（留空省略，保留旧值）。
- 测试：`POST /ai/test`，显示延迟/错误。
- 实测：
  - `hasPanel=true`、`maskedVisible=true`、`keyInputValue=""`、`pageHasPlainKey=false`；
  - mock 配置 `http://127.0.0.1:4010/v1` / `mock-gpt`，连通成功 **3ms**；
  - 普通成员：`hasAiPanel=false`。
- 截图：`sprint3-ai-config-1440.png`、`sprint3-ai-test-1440.png`、`sprint3-member-no-ai-1440.png`。

### 2.2 SSE 客户端

- `lib/aiStream.ts`：`fetch(POST)` + `ReadableStream` + `TextDecoder`，解析 `event: delta/done/error`；携带 Bearer；支持 `AbortController`；**不使用 EventSource**。
- `done` 支持 `{messageId,seq}`；`error` 支持 `{code,message}`；非 2xx 解析错误 envelope。
- 同源代理：`app/api/ai/[kind]/route.ts` 转发到 API 的 `/ai/:kind` 并原样流回（后端 SSE hijack 在跨域下缺 CORS 头，前端侧兜底，未改 server）。

### 2.3 @Bot 流式终端

- Composer 发送含 `@Bot`/`@bot`/`@帝江号` 的消息：先正常 WS 发送用户消息，再 `POST /ai/chat {channelId, body}`。
- 临时 bot 消息使用稳定 client id（`ai:<uuid>`），delta 追加到临时消息；`done.messageId` 到达后替换 id；服务端 WS `message:new` 落库消息同 id 合并去重。
- Bot 消息终端样式：墨底、等宽、荧光黄 `[DIJIANG/OS]` 前缀、流式 `STREAM` + `▌` 游标；`REPORT` 标记用于 `/report`；失败显示错误码 + 重试按钮。
- 实测（mock provider，25ms/块）：
  - 第一次采样：`bodyLength=31, streaming=true`；
  - 第二次采样：`bodyLength=43, streaming=false`（至少 2 个 delta + done）；
  - 最终 body 完整，`hasPrefix=true`。
- 截图：`sprint3-bot-stream-1440.png`（有 STREAM/游标）、`sprint3-bot-1440.png`。

### 2.4 `/report` 流式报告

- Composer 输入 `/report`：先发送用户消息，再 `POST /ai/report {channelId}`，同一终端样式 + `REPORT` 标记。
- 实测：报告包含【态势】【风险】【建议】三段，`hasReport=true`；截图 `sprint3-report-stream-1440.png`、`sprint3-report-1440.png`。

### 2.5 mock provider

- 使用 `ops/e2e/mock-ai.mjs`（127.0.0.1:4010，模型 `mock-gpt`，key `mock-key-dijiang`），在设置页保存配置并测试连通性。
- **不是真实供应商**；真实 OpenAI/兼容网关未接、未验。

## 3. 截图（reports/frontend/）

| 文件 | 内容 |
| --- | --- |
| `sprint3-ai-config-1440.png` | owner AI 面板，masked Key，保存成功 |
| `sprint3-ai-test-1440.png` | 连通性测试成功 3ms |
| `sprint3-bot-stream-1440.png` | @Bot 流式中（STREAM + 游标） |
| `sprint3-bot-1440.png` | @Bot 完成，终端样式 |
| `sprint3-report-stream-1440.png` | /report 流式 |
| `sprint3-report-1440.png` | /report 完成 |
| `sprint3-member-no-ai-1440.png` | 普通成员设置页无 AI 面板 |

机器可读：`reports/frontend/sprint3-report.json`。

## 4. 验收计数（本轮冒烟）

```text
config.hasPanel = true
config.maskedVisible = true
config.keyInputValue = ""
config.pageHasPlainKey = false
config.saved = true
test.连通成功 = true（3ms）
botDeltas = [{bodyLength:31, streaming:true}, {bodyLength:43, streaming:false}]
botDone.hasPrefix = true
reportDone.hasReport = true
member.hasAiPanel = false
errors = []
pageErrors = []
failedRequests = []
```

> 说明：通用频道累积了本轮多次测试的 @Bot / /report 消息（测试数据），不影响功能。

## 5. 未验证 / 已知限制

1. **真实供应商未接**：仅 mock OpenAI 兼容 provider；真实 OpenAI/兼容网关、真实模型输出、限流/配额未验。
2. **音频/真机未验**：本轮不涉及移动端 AI 面板截图；真实手机与真机网络未验。
3. **流中断/取消**：已实现 AbortController（切换频道/卸载时 abort），但未做中途取消的 UI 截图/断言。
4. **AI 失败重试 UI**：实现了失败态 + 重试按钮，但本轮 mock 成功，未截图失败/重试路径。
5. **@Bot 去重**：依赖 done.messageId + WS 同 id 合并；未做并发多条 @Bot 的压测。
6. **代理兜底**：AI 流走同源 `/api/ai/[kind]` 代理（后端 SSE hijack 的跨域 CORS 缺失）；这是前端 workaround，不是后端 CORS 已修复。
7. 仅跑了 build + 本 Sprint 冒烟，未跑 Sprint1/2/全量回归。
