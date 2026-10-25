# Sprint 2 前端验收报告（task-22）

日期：2026-10-24　｜　范围：`web/**`（未改 server/ops/design）　｜　真实环境：API 3000 / Web 3100 / S3 9000

> 测试策略遵循用户新要求：**只跑 `pnpm build` + 本 Sprint 的截图冒烟**，不跑无关回归。下面“未验证”一节列清未覆盖项。

## 1. 构建

`cd web && pnpm build` → **exit 0**（`reports/frontend/build.log`）：

```text
▲ Next.js 15.5.28
✓ Compiled successfully
✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                     148 kB         258 kB
├ ○ /_not-found                            993 B         103 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               3.42 kB         106 kB
└ ○ /settings                            3.16 kB         113 kB
+ First Load JS shared by all             102 kB
```

新增依赖：`zustand@5.0.16`、`recharts@3.10.1`、`rehype-highlight@7.0.2`、`highlight.js@11.12.0`。

## 2. 功能映射

### 2.1 Markdown 代码块 + 复制

- `MessageItem` 正文改用 `Markdown`（`react-markdown` 白名单，不启用 raw HTML）。
- `rehype-highlight` + `highlight.js/styles/github.css`；自定义 `pre/code` 渲染：语言标签（如 `TS`）+ 右上角「复制」；复制用 `navigator.clipboard`。
- 白名单加入 `span`，以保留 `rehype-highlight` 生成的 token span；不引入 `dangerouslySetInnerHTML`。
- 实测：`.md-code` 存在，`language=ts`，`highlighted=true`，复制按钮点击后显示「已复制」。截图 `sprint2-code-1440.png`。
- 公告 Markdown 与消息 Markdown 共用同一白名单组件。

### 2.2 音乐卡

- Composer「＋」新增「音乐」；弹窗识别网易云 / QQ / mp3 直链，填写标题/艺人/封面 URL；`POST /cards kind=music`。
- RichCard 渲染封面 + 标题/艺人 + **不自动加载播放器**：
  - 网易云：点击「▶ 播放音乐」后才设置 `<audio controls preload=none src="https://music.163.com/song/media/outer/url?id=<id>.mp3">`；
  - 直链 mp3/wav/ogg/m4a：同样点击后才设置 audio src；
  - QQ / 无直链：只显示封面 + 外链按钮；
  - **完全移除 iframe**，避免 cross-origin `SecurityError` 与 Permissions policy 噪声。
- 实测：`found=true`，`iframes=0`，`playerButton=true`，卡片文案正确。截图 `sprint2-music-1440.png`。
- 本轮已确认 Console **0 error**、`failedRequests=0`（之前 3 条 400 来自已删除卡片的逐条 GET，已通过批量卡片白名单消除）。

### 2.3 图表卡

- Composer「＋」→「图表」；弹窗选择 line/bar、输入/校验 JSON `[{name,value}]`，可选系列名；`POST /cards kind=chart`。
- RichCard 用 Recharts 渲染 `LineChart/BarChart`（动态 import、`ssr:false`）；空/错误数据有空态。
- 实测：`found=true`，`rechartsSvg=2`。截图 `sprint2-chart-1440.png`。

### 2.4 贴纸

- Composer「＋」→「贴纸」打开面板；`GET /stickers` 读取当前用户贴纸；上传走 `presign→PUT→complete→POST /stickers`；可删除自己的贴纸。
- 点击贴纸发送一条带该图片附件消息；消息流贴纸图片 CSS 限制 **96×96**。
- 实测：贴纸面板加载完成（不再卡「读取中…」），`count=6`；发送后 `.dj-attach-img.is-sticker img` 宽度 **96**。截图 `sprint2-stickers-1440.png`、`sprint2-sticker-msg-1440.png`。
- 修复：`StickerPanel.load` 的回调改为 ref，避免父组件内联回调导致 effect 循环、loading 抖动。

### 2.5 Zustand 我的任务

- `web/src/store/tasks.ts`：`GET /me/tasks`，归一化 `{tasks:[...]}`，过滤 `done`；`updateFromCard` 在 RichCard 任务状态变更后更新；WS `card:updated/created/deleted` 触发刷新。
- 侧栏新增可折叠「我的任务」区，展示未完成项与截止日，点击跳频道。
- 实测：创建指派给自己的任务后侧栏出现「Sprint2 我的任务」，`hasTitle=true`。截图 `sprint2-tasks-1440.png`、`sprint2-mytasks-1440.png`。

### 2.6 Cmd+K 命令面板

- 全局 `Ctrl/⌘+K` 打开；输入防抖调用 `GET /search?q=`，本地过滤频道/私聊/群聊；`/goto <频道名>` 跳频道；`/tasks` 列出我的任务；Enter 打开、Esc 关闭；结果 key 使用消息/频道稳定 id。
- 实测：
  - `Ctrl+K` 打开；
  - 搜索 `e2e` 返回 MESSAGE 结果；
  - `/goto 素材工坊` → Header 标题变为「素材工坊」；
  - `/tasks` 返回 TASK 结果；
  - Esc 后面板关闭（`commandEsc=true`）。
- 截图：`sprint2-cmdk-1440.png`、`sprint2-cmdk-tasks-1440.png`、`sprint2-command-1440.png`。

### 2.7 移动端

- 390 宽「＋」菜单 8 项：素材/投票/任务/音乐/图表/贴纸/图片/文件；无横向溢出（`overflowX=0`）。截图 `sprint2-mobile-menu-390.png`。

## 3. 截图（reports/frontend/）

| 文件 | 内容 |
| --- | --- |
| `sprint2-code-1440.png` | 代码块高亮 + 语言标签 + 已复制 |
| `sprint2-music-1440.png` | 音乐卡（无 iframe，点击播放按钮 + 外链） |
| `sprint2-chart-1440.png` | Recharts 柱状图表卡 |
| `sprint2-stickers-1440.png` | 贴纸面板（已加载完成） |
| `sprint2-sticker-msg-1440.png` | 贴纸消息 96×96 |
| `sprint2-tasks-1440.png` / `sprint2-mytasks-1440.png` | 侧栏「我的任务」 |
| `sprint2-cmdk-1440.png` | Cmd+K 消息搜索结果 |
| `sprint2-cmdk-tasks-1440.png` | `/tasks` 指令结果 |
| `sprint2-command-1440.png` | 命令面板 |
| `sprint2-mobile-menu-390.png` | 390 宽「＋」菜单 8 项 |

机器可读：`reports/frontend/sprint2-report.json`。

## 4. 验收计数（本轮截图冒烟）

```text
code.highlighted = true
music.iframes = 0, music.playerButton = true
chart.rechartsSvg = 2
stickers.count = 6, stickerMessage.widths = [96, 96]
tasks.hasTitle = true
command.visible = true, commandGoto = 素材工坊, commandTasks.hasTask = true, commandEsc = true
mobile.overflowX = 0
errors = []
pageErrors = []
failedRequests = []
```

> 说明：本次运行在真实数据上重复创建了若干测试卡/贴纸/任务（通用频道），属于测试数据，不影响功能。

## 5. 未验证 / 已知限制

1. **只跑了 build + 本 Sprint 截图冒烟**，未跑 Sprint 1 / 全量回归（遵循用户“不跑无关测试”的要求）。
2. **音频真实播放未验证**：为避免外部网易云直链请求/版权问题，未在脚本里点击「播放音乐」；只验证了未点击前不发请求、无 iframe、无 console error。QQ 音乐仅提供外链，无直链音频。
3. **贴纸删除**未点击验证（仅实现并保留确认框）；贴纸上传/读取/发送已验。
4. **Cmd+K 消息跳转**：验证了选择器与频道跳转；消息命中后的 `focusMessageId` 滚动高亮未单独断言。
5. `/tasks` 结果点击跳频道未单独点击（列表与指令解析已验）。
6. 未做移动端 390 的 Cmd+K/贴纸面板逐一截图；390「＋」菜单已验。
7. 卡片白名单按频道前 100 张卡过滤，极老卡片不在列表时可能显示「卡片不可用」；当前消息窗口在 100 内。
8. 图表 JSON 仅支持 `[{name,value}]` 点集；不支持多 series 数组。
