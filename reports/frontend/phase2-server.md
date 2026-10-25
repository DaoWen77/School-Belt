# Phase 2 前端验收报告（task-32）

日期：2026-10-24　｜　范围：`web/**`、`docs/18-前端.md`、`reports/frontend/`　｜　按 Lead 要求只 build，不重启 3100

> 当前 3100 由 Lead 统一重启；`phase2-*.png` 待 Lead 在重启后补。

## 1. 构建

`cd web && pnpm build` → **exit 0**（`reports/frontend/build.log`，日志显示 `Environments: .env.local`）：

```text
▲ Next.js 15.5.28
- Environments: .env.local
✓ Compiled successfully
✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                     254 kB         364 kB
├ ○ /_not-found                            993 B         103 kB
├ ƒ /api/ai/[kind]                         122 B         102 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               4.61 kB         107 kB
└ ○ /settings                            6.77 kB         117 kB
+ First Load JS shared by all             102 kB
```

## 2. API / WS 地址解耦

文件：`web/src/lib/api.ts`、`web/src/lib/realtime.ts`

- 支持 `NEXT_PUBLIC_API_BASE_URL`、`NEXT_PUBLIC_WS_URL`；旧 `NEXT_PUBLIC_API_BASE` 仍兼容。
- API 优先级：localStorage `dj-server-api` → env（新→旧）→ `window.location.origin`（同源）；SSR 回退 env 或 `http://localhost:3000`。
- WS 优先级：localStorage `dj-server-ws` → `NEXT_PUBLIC_WS_URL` → API base（空=沿用 API host）。
- `realtime.ts` 使用 `WS_BASE`，连接 `${WS_BASE}/ws`，path 仍为 `NEXT_PUBLIC_WS_PATH`（默认 `/socket.io`）；API/WS 可分源。
- 新增 `resolveApiBase()` / `resolveWsBase()` / `readServerSetting()` 供登录页使用。

## 3. 本机 `.env.local`

已创建 `web/.env.local`（gitignored，仅本机）：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=http://localhost:3000
```

保证本机 3100 → API 3000 / WS 3000 的现有登录链路；未重启 3100。

`web/.env.example` 已重写：新变量优先级、旧变量兼容、局域网/同源反代示例、WS_PATH 说明。

## 4. 登录页服务器设置

文件：`web/src/app/login/page.tsx`

- 顶部折叠「服务器设置 / Server」，字段 API Base URL / WS URL（空=同源/沿用 API）。
- 显示当前生效 API、WS、Socket.IO PATH，避免用户不知道实际打哪。
- 「测试连接」：GET `${apiBase}/readyz`，5s AbortController 超时，显示 HTTP/延迟/错误；不写 localStorage。
- 「保存并重载」：只接受 http/https，写 `dj-server-api`/`dj-server-ws` 后 `location.reload()`；空值移除对应键。
- 「恢复默认」：清两个键并 reload。
- 校验失败只显示错误，不保存。

## 5. AI 同源代理

文件：`web/src/lib/aiStream.ts`、`web/src/app/api/ai/[kind]/route.ts`

- `aiStream` 请求同源 `/api/ai/:kind` 时带 `x-dj-api-base: API_BASE`。
- 代理接受 `x-dj-api-base`（仅 http/https）并转发到 `${base}/api/v1/ai/:kind`；无 header 用 `NEXT_PUBLIC_API_BASE_URL`/旧变量，最后回退 localhost:3000。
- 非法 header 不会作为目标，回退环境变量，避免任意协议/SSRF。

## 6. 验证状态

- `pnpm build` exit 0；`.env.local` 被 Next 读取。
- 按 Lead 要求未重启 3100、未生成 Phase2 截图；待 Lead 重启后在 3100 验证：
  1. 默认 env 登录正常；
  2. 展开服务器设置 → 测试连接显示状态/延迟；
  3. 保存自定义 base 后 reload 仍可登录/发消息；
  4. 错误 URL 只显示错误、不保存；
  5. Console 0 error。

## 7. 未验证 / 注意

1. 重启后默认 `.env.local` 登录（需 Lead 启动）。
2. 自定义 base 保存后的登录/WS/发消息 E2E。
3. 断网/错误 URL 的 UI 截图与「不保存」断言。
4. AI 自定义 base 下的真实 SSE（需自定义服务器可用）。
5. 未跑全量回归；未自行重启 3100。
6. `.env.local` 已存在但被 gitignore，部署时需显式配置新变量。

## Phase 2 实测（Lead 统一重启 3100 后）

环境：Web http://localhost:3100，默认 .env.local API/WS=http://localhost:3000。

| 项 | 结果 |
| --- | --- |
| 默认登录（.env.local） | 正常进入 / |
| 展开服务器设置 | 显示当前 API/WS/PATH 与输入框 |
| 错误地址 http://192.168.1.9:9999 测试 | 显示连接错误；localStorage['dj-server-api'] 仍为 **null**（不保存） |
| 正确地址 http://192.168.1.9:3000 测试 | 成功（显示 readyz/延迟） |
| 保存并重载 | dj-server-api=http://192.168.1.9:3000，reload 后登录成功 |
| 自定义 base 后 API 请求 host | 页面请求 /api/v1/* 全部打到 **192.168.1.9:3000**，不再打 localhost |
| 截图 | phase2-login-server-1440.png、phase2-server-test-1440.png、phase2-custom-base-1440.png |

### Console

- 错误地址测试会主动产生 1 条 ERR_CONNECTION_REFUSED（预期，验证失败不保存）。
- 仍有既有 Minified React error #418（hydration 文本不匹配，Phase 1 已记录，未在 Phase 2 处理）。
