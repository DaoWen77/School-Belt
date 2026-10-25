# 前端交付证据（web/ · Next.js 甲套）

本目录只放前端验证产物，源码在 `web/`，说明文档在 [`docs/18-前端.md`](../../docs/18-前端.md)。

## 1. 构建

| 文件 | 内容 |
| --- | --- |
| `install.log` | `cd web && pnpm install` 真实输出（pnpm 12.11.2，Done in 21.1s，+35 packages） |
| `build.log` | `pnpm build` 真实输出（Next.js 15.5.28，exit 0，`/`、`/login`、`/settings`、`/icon.svg` 预渲染） |
| `start.log` / `start-3101.log` | `next start -p 3100` / `-p 3101` 启动输出 |

## 2. 截图

| 文件 | 场景 | 构建 |
| --- | --- | --- |
| `login-1440.png` | 登录页（1440×1000） | 最终构建（3101） |
| `login-375.png` | 登录页（375×812，无横向溢出） | 最终构建（3101） |
| `login-error-1440.png` | API 被阻断 → `NETWORK`「无法连接 API」错误态 | 最终构建（3101） |
| `main-link-down-1440.png` | 有 token 但 API 不可达 →「链路未连接」+ 重试，无演示数据 | 最终构建（3101） |
| `skip-link-focus-1440.png` | 键盘 Tab 后 skip link 出现在左上角 | 最终构建（3101） |
| `main-1440.png` | 真实 API 主界面（频道 / 消息流 / 右栏成员） | 真实链路（3100 + 3000，seed 数据） |
| `thread-1440.png` | 真实线程展开（2 条回复 + 线程回复框） | 真实链路 |
| `dm-1440.png` | 真实私聊视图 | 真实链路 |
| `group-1440.png` | 真实群聊视图 | 真实链路 |
| `lead-login.png` | Lead 用 founder / Playwright 的真实登录截图 | 真实链路（Lead 提供） |

## 3. 机器可读检查

| 文件 | 内容 |
| --- | --- |
| `capture.json` | 登录页 / 窄屏 / 错误态 / 主界面链路状态 / skip link / favicon / 控制台异常 |
| `capture-live.json` | 真实登录后的频道·私聊·群聊·消息·成员·线程展开计数与控制台异常 |

复现脚本（需要 Chrome 以 `--headless=new --remote-debugging-port=9333 --remote-allow-origins=*` 启动）：

```bash
node reports/frontend/capture.cjs        # 登录页 / 错误态 / skip link / favicon（默认 3100）
CAPTURE_BASE=http://localhost:3101 node reports/frontend/capture.cjs
node reports/frontend/capture-live.cjs   # 真实 API 登录 + 主界面/线程/私聊/群聊
```

## 4. 关键结论

- `pnpm build` exit 0，无 TypeScript 错误；首屏共享 JS 102 kB。
- 真实登录：`signal 链路正常`；`GET /channels` / `GET /conversations` / `GET /channels/:id/messages` 全部走真实 API，无 mock、无演示数据。
- 服务端成功信封 `{ ok:true, data, requestId }` 与错误信封 `{ ok:false, error:{code,message} }` 已在 `web/src/lib/api.ts` 解包（Lead 指出的关键问题已修复并真实登录验证）。
- 错误态：阻断 API 后登录页 `NETWORK`、主界面「链路未连接」+ 重试；`fakeSeedNames=[]`。
- 视觉：body 背景 `rgb(244,244,242)`、Saira 已加载、1440/375 `overflowX=0`、skip link 默认隐藏 / Tab 可见、`icon.svg` 200。
- 联调地址用 `http://localhost:3100`；`127.0.0.1:3100` 会被后端 CORS 白名单拒绝（不是前端 bug）。

## 5. 未实现 / 未截图

见 [`docs/18-前端.md`](../../docs/18-前端.md) §8、§9.4、§10.9：灵感墙/作品墙/搜索/通知中心、已读回执 UI、卡片详情页未做；群聊改名/移除/退出在 CORS 修复后未逐项点 UI（交给 e2e）；上传中断/重试与超大文件上限未真传。

## 6. 日常档（第二批：附件 / 素材 / 投票 / 任务 / 编辑删除）

### 6.1 构建

`cd web && pnpm build` → **exit 0**，`/` 34.4 kB / First Load 140 kB（`build.log` 已覆盖为最终构建）。

### 6.2 截图

| 文件 | 场景 |
| --- | --- |
| `daily-material-1440.png` | 素材库网格 + 类型筛选 |
| `daily-upload-1440.png` | 上传进度「已上传」+ 新素材卡 |
| `daily-vote-1440.png` | 投票卡（选项/票数条/多选/匿名/截止） |
| `daily-task-1440.png` / `daily-task-moved-1440.png` | 任务三列 / 状态流转后 |
| `daily-edit-1440.png` | 消息编辑成功（「已编辑」徽标） |
| `daily-delete-1440.png` | 消息删除（软删） |
| `daily-chat-attachment-1440.png` | 图片附件气泡（真实 S3 签名 URL） |
| `daily-attachment-lightbox-1440.png` | 点开大图 dialog |
| `daily-chat-file-1440.png` | 文件卡（名称/类型/大小/下载） |
| `daily-chat-375.png` / `daily-material-375.png` / `daily-vote-375.png` / `daily-task-375.png` | 375 窄屏四视图（`daily-375.json` 记录 overflowX=0） |

### 6.3 机器可读检查

`capture-daily.json`（登录/视图/投票 0→1/任务流转/编辑/删除/卡片消息）与 `capture-daily-attachment.json`（图片上传、气泡加载 host 127.0.0.1:9100、大图、文件卡下载链接 host 9100）。

复现脚本：

```bash
node reports/frontend/capture-daily.cjs            # 全流程（会上传/投票）
SKIP_UPLOAD=1 SKIP_VOTE=1 node reports/frontend/capture-daily.cjs   # 只跑任务/编辑删除
node reports/frontend/capture-daily-attachment.cjs # 聊天图片/文件附件 + 大图
```

### 6.4 真实结果

- 上传 `upload-test.png`（210.9KB）→ presign → PUT → complete → `POST /cards kind=material` → 素材卡出现；WS `card:created` 自动刷新。
- 投票：0 票 → 1 票，计数 `1/0/0`，实名投票人「建立者」。
- 任务：`Lead 接口自检任务` 从「进行中」→「已完成」，完成列 +1（正常 Chrome，CORS 修复后）。
- 消息：编辑后出现「已编辑」徽标；删除后软删（正常 Chrome）。
- 附件：图片气泡 `<img>` 真实加载自 `127.0.0.1:9100`，大图 dialog 打开；文件卡 `18-前端.md · 18.9 KB`，下载链接 host `127.0.0.1:9100`。
- 控制台 0 error / 0 exception。

### 6.5 联调坑

1. **REST CORS 默认只放行 GET/HEAD/POST**：`app.enableCors` 缺 `methods` 时浏览器 PATCH/DELETE 预检失败，前端显示 `NETWORK`。Lead 已修：`OPTIONS /api/v1/messages/1` → 204，`Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`。这影响消息编辑/删除、任务状态、群聊改名/移除/退出。
2. **S3 桶 CORS**：浏览器直传 PUT 需要桶允许 `http://localhost:3100` + `PUT/GET` + `content-type`；e2e 用 s3rver + CORS 代理（9100→9101）验证。
3. 地址统一 `http://localhost:3100`，不要用 `127.0.0.1:3100`。

