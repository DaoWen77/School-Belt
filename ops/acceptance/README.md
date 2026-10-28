# 一键验收脚本 / Acceptance Launcher

给「O.M.V 工作台 · 全域广播」做**一次点击就能跑完的自检**，并把两套 UI 用一个本地静态服务打开。
不需要 npm 依赖、不需要 Docker（全栈模式除外）。

---

## 1. 三种入口

| 系统 | 操作 |
| --- | --- |
| Windows | 双击根目录的 [`一键验收.cmd`](../../一键验收.cmd)（会绕过执行策略限制） |
| Windows 终端 | `pwsh -ExecutionPolicy Bypass -File ops/acceptance/start.ps1` |
| Linux / macOS / WSL | `bash ops/acceptance/start.sh`（或根目录 `一键验收.sh`） |

默认 **自动模式**：检测到 Docker 就起全栈，没有就跑静态验收。

---

## 2. 模式

| 命令 | 做什么 | 需要 |
| --- | --- | --- |
| 默认（`-Mode auto` / `--mode auto`） | 有 Docker → 全栈；否则 → 静态验收 | Node + pnpm |
| `-Mode ui` / `--mode ui` | 构建 + 63 项单测 + 18 个页面检查 + 打开验收台 | Node + pnpm |
| `-Mode test` / `--mode test` | 只跑构建与单测 | Node + pnpm |
| `-Mode full` / `--mode full` | compose 起 PG/Redis/MinIO/API/Caddy → 迁移 → owner → 种子 → 验收台 | Docker |
| `-Mode stop` / `--mode stop` | 停止静态服务；有 Docker 时一并 `compose down`（保留卷） | — |

可选参数：`-Port 8099`（静态服务端口）、`-NoBrowser`、`-NoWait`、`-SkipTest`。
静态模式端口被占用时会自动向后找 20 个端口。

---

## 3. 它实际检查什么

1. `server/` 下 `pnpm build`（tsc strict）退出码。
2. `pnpm test`（vitest）退出码与通过数（预期 8 文件 / 63 例）。
3. 启动 `serve-ui.mjs`，逐页请求两套 UI 的 18 个页面：
   - HTTP 200、HTML、页面标记（如「全域播报」「投票 · 票根」）；
   - 页面引用的本地 css/js/字体/图片全部 200；
   - 不允许外链资源（保证离线可看）；
   - 两套 `index.html` 都链接到全部 8 屏。
4. 生成 `reports/acceptance/summary.json`，验收台（hub.html）读取它显示结果。
5. 打开浏览器：验收台 → 两套 UI 入口。

**它不伪造后端**：静态模式不启动 API、不假装数据库可用；真实链路仍需 Docker 全栈模式。

---

## 4. 产物

| 文件 | 内容 |
| --- | --- |
| `reports/acceptance/summary.json` | 最近一次验收结果（构建/单测/UI/总体） |
| `reports/acceptance/build.log` / `test.log` | 原始命令输出 |
| `reports/acceptance/ui-checks.json` | 18 页逐项检查明细 |
| `reports/acceptance/preview.*.log` | 静态服务日志 |
| `reports/acceptance/hub.png` | 验收台截图（手动截的样例） |
| `ops/acceptance/.preview.pid` | 静态服务 PID（stop 用，已 gitignore） |

退出码：`0` 全部通过；`1` 有失败；`2` 参数/端口错误。

---

## 5. 验收台（hub.html）

由静态服务提供：`http://127.0.0.1:8099/ops/acceptance/hub.html`

- 顶部实时显示静态服务 PID；
- 四张卡：运行模式、构建、单测、UI；
- 两套 UI 的截图入口与设计说明；
- 验收路径、文档链接、口径说明（哪些未验证）。

---

## 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| PowerShell 提示「不是数字签名」 | 用 `一键验收.cmd`，或加 `-ExecutionPolicy Bypass` |
| 提示找不到 pnpm | `npm i -g pnpm`，或改用 `corepack enable` |
| 端口被占用 | `-Port 8100`；脚本也会自动顺延 |
| 静态服务起不来 | 看 `reports/acceptance/preview.err.log` |
| `-Mode full` 失败 | 确认 Docker Desktop 已启动；先跑 `ops/start.ps1` 看 compose 日志；或先用 `-Mode ui` |
| 打开页面是空白/旧内容 | `Ctrl+F5`；静态服务 `Cache-Control: no-store` |
| 中文在 cmd 里乱码 | 脚本已 `chcp 65001`；仍乱码时用 Windows Terminal 打开 |

---

## 7. 本机实测记录

- 2026-10-22，Windows 11 + Node 24 + pnpm 12 + PowerShell 5.1（本机 `pwsh` 实际指向 5.1）：
  - `-Mode test`、`-Mode ui`、`-Mode auto` 均通过（构建 5s、63/63、18/18），`-Mode stop` 正常；
  - 双击入口 `一键验收.cmd` 传参测试通过。
- **未实测**：`bash` 脚本（本机无 bash/WSL 发行版，仅按 POSIX 编写）；`-Mode full`（本机无 Docker）。
  这两项在有对应环境的机器上应做一次冒烟，结果回填本节。
