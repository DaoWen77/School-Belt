# IM 布局重构验收报告（task-15）

日期：2026-10-23　｜　范围：`web/`（未改 server/ops/design）　｜　真实后端：API 3000 + S3 9100

## 1. 构建

```bash
cd web && pnpm build
```

真实输出（`reports/frontend/build.log`，exit 0）：

```text
   ▲ Next.js 15.5.28
 ✓ Compiled successfully in 3.3s
 ✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                      38 kB         144 kB
├ ○ /_not-found                            993 B         103 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               3.42 kB         106 kB
└ ○ /settings                            3.42 kB         109 kB
+ First Load JS shared by all             102 kB
```

Tailwind v4：`tailwindcss@^4.3.3`、`@tailwindcss/postcss@^4.3.3`、`postcss@^8.5.31`；`postcss.config.mjs`；**不启用 preflight**（只引 `theme.css` + `utilities.css`），`@theme` 直接映射 tokens.css 的 `--ef-*`。

## 2. 组件树

```text
src/app/
├─ layout.tsx                  tokens.css → app.css → tailwind.css → im.css → workspace.css
├─ page.tsx                    <Workspace/>
├─ login/page.tsx              Tailwind 登录/邀请码注册（逻辑不变）
└─ settings/page.tsx           Tailwind 账号/链路/限制（逻辑不变）

src/components/
├─ Workspace.tsx               状态/动作层（保持原逻辑：auth/WS/发送/ack/重试/补拉/上传/投票/任务/编辑删除/DM/群聊）
└─ im/
   ├─ WorkspaceView.tsx        AppShell：h-dvh flex-col + 键盘 visualViewport 高度同步
   ├─ ChatHeader.tsx           固定头：桌面完整；<768 仅 ☰ + 频道名 + 详情
   ├─ Sidebar.tsx              桌面 264px；<768 左抽屉（含用户/主题/设置/退出）
   ├─ MessageList.tsx          唯一 overflow-y 滚动区；顶部 IntersectionObserver；prepend 锚定；回到最新
   ├─ MessageItem.tsx          消息行（5 分钟同发送者合并、11px meta、hover 操作、线程）
   ├─ RichCard.tsx             消息流内卡片：投票可直接投 / 任务可改状态 / 素材缩略与预览
   ├─ Composer.tsx             输入信号…；1–5 行自适应；＋菜单（素材/投票/任务/图片/文件）；拖拽/粘贴
   ├─ DetailDrawer.tsx         右侧 360 覆盖抽屉 / 移动全屏 sheet：信息+成员+置顶+群管理
   ├─ CardDialogs.tsx          新建投票 / 新建任务弹窗
   ├─ icons.tsx / types.ts
   └─ （保留）Attachments.tsx / Modal.tsx
```

旧的 `AppHeader.tsx` / `MessageRow.tsx` / `CardMessage.tsx` / `views/*` 已删除；`Workspace` 只保留状态与动作，渲染全部走 `im/*`。

## 3. 对应需求的实现

| 需求 | 实现 |
| --- | --- |
| A. Tailwind v4 | 上述依赖 + `postcss.config.mjs`；无 preflight；`@theme` 映射 paper/ink/line/accent/panel；`cut-corner` / `cut-corner-sm` / `hairline-b` / `no-scrollbar` 自定义 utility |
| B. 布局 | `im-app` 高度 `h-dvh`（移动端跟随 `--im-vvh`）；Header 固定；Main flex；MessageList 唯一滚动；Composer 底部；右栏改 `DetailDrawer`（桌面 360 覆盖+遮罩，移动全屏） |
| C. 消息流 | 去 `No.xxx`；meta 11px；操作默认 `opacity-0`，`:hover` / `:focus-within` 显示；无粗分割线（留白 + 极淡 1px）；同发送者 5 分钟内合并头像/名字；间距压缩 |
| D. 滚动 | 顶部 sentinel + IntersectionObserver 自动加载更早；加载前记录 `scrollHeight/scrollTop`，插入后恢复；距底 >240 显示「↓ 回到最新」；贴底新消息自动滚动；图片异步加载只在用户未上滚时贴底 |
| E. 去 Tab / 卡片入流 | 无四 Tab；`message.kind=card` → `RichCard`：投票直接投、任务直接 PATCH 状态、素材缩略/文件预览；＋菜单用现有 `POST /cards`、`/files` 上传 |
| F. 输入区 | placeholder「输入信号...」；textarea 1–5 行（`scrollHeight` + max-height）；＋菜单、附件小图标、紧凑发送；Enter/Shift+Enter；拖拽/粘贴保留 |
| G. 移动端 | <768 侧栏默认隐藏，☰ 打开左抽屉；Header 仅 ☰ + 频道名 + 详情；详情全屏 sheet；`env(safe-area-inset-bottom)` + `visualViewport` 同步高度；390 无横向溢出 |
| H. 登录/设置 | 全部 Tailwind 化，保留原有 API/refresh/redirect 逻辑 |

## 4. Lead 提出的两个 P1（已修）

### 4.1 登录按钮黑底黑字

- 原因：自定义 `text-panel` / 继承色在深色背景上对比度不足；同时 `im.css` 里对表单控件的 `color/font` 简写会盖掉 Tailwind 文本工具类。
- 修复：`login/page.tsx` 按钮改 `text-white`；全局 `text-panel` 全部替换为 `text-white`（15 处）；`im.css` 只保留 `font-family: inherit`，不再写 `color` / `font` 简写。
- 实测（`im-scroll-check.json`）：启用态按钮 `color: rgb(255,255,255)`、`background: rgb(22,22,22)`、`disabled: false`；截图 `im-login-filled.png`。

### 4.2 上滚加载更早后被拉回底部

- 原因：`ResizeObserver` 在内容高度变化时只判断 `userInteracted=false` 就贴底，程序化滚到顶部不会触发 wheel/pointer。
- 修复：
  - IntersectionObserver 触发加载时先 `userInteracted.current = true`；
  - `ResizeObserver` 遇到 `userInteracted` 或 `pendingPrepend` 直接跳过；
  - prepend 后按 `scrollHeight` 差值恢复 `scrollTop`，并保持 `userInteracted=true`；
  - 用户点「回到最新」或自己滚到底（距底 <40）才重置。
- 实测（`im-scroll-check.json`）：
  - 加载前：`scrollTop=5443 / scrollHeight=6323 / clientHeight=880 / count=50 / distance=0`
  - 加载后：`scrollTop=3812 / scrollHeight=10135 / clientHeight=880 / count=100 / distance=5443`，`jumpVisible=true` → 锚定成功，视口没被拉到底；
  - 点「回到最新」后：`distance=0`，按钮隐藏。
- 截图：`im-scroll-anchored.png`、`im-scroll-jump.png`。

### 4.3 「回到最新」后距底 415px（e2e IM8，已修）

- 原因：按钮调用 `scrollToBottom(true)`（`behavior:'smooth'`），消息多/图片加载时平滑滚动在 e2e 的测量窗口内没跑完。
- 修复：改为**瞬时滚动**（`behavior:'auto'`），并在 50/200/450ms 做兜底贴底（用户再次上滚则放弃）。
- 实测（`im-report.json` → `checks.jumpLatest`、`im-scroll-check.json`）：
  - 点击后 120ms：`scrollTop=10921 / scrollHeight=11801 / clientHeight=880 / distance=0`；
  - 700ms 后：`distance=0`，`jumpVisibleAfter=false`。
- 截图：`im-jump-latest.png`。

## 5. 移动端 Header（本轮新增修复）

- ChatHeader 在 `<768px` 只渲染：☰、频道名（truncate）、详情图标；副标题、连接状态、主题、设置、头像/用户名、退出全部 `hidden md:block`。
- 用户/主题/设置/退出移入左侧抽屉底部。
- 实测（`im-report.json`）：`mobileHeader.text = "全域播报"`；可见按钮仅 `["打开频道列表","打开详情"]`；截图 `im-mobile-header-390.png`。

## 6. 截图（reports/frontend/）

| 文件 | 内容 |
| --- | --- |
| `im-login-1440.png` / `im-login-filled.png` | 登录页 / 填写后按钮（白字可读） |
| `im-desktop-1440.png` | 桌面 IM 消息流（固定头尾、侧栏、无楼层号、卡片入流） |
| `im-detail-1440.png` | 右侧详情抽屉（频道信息 + 成员 + 置顶） |
| `im-plus-menu-1440.png` | 输入框「＋」菜单 5 项 |
| `im-vote-card-1440.png` | 投票卡（直接投票、票数条） |
| `im-task-card-1440.png` | 任务卡（直接状态流转） |
| `im-material-card-1440.png` | 素材卡（真实上传缩略图） |
| `im-send-1440.png` | 发送消息后 |
| `im-dm-1440.png` / `im-group-1440.png` | 私聊/群聊切换回归 |
| `im-mobile-header-390.png` | 390 宽 Header（仅 ☰ + 频道名 + 详情） |
| `im-mobile-390.png` / `im-mobile-sidebar-390.png` / `im-mobile-detail-390.png` | 移动消息流 / 左抽屉 / 全屏详情 |
| `im-scroll-anchored.png` / `im-scroll-jump.png` | 上滚加载后锚定 / 点「回到最新」 |
| `im-jump-latest.png` | 「回到最新」点击后（距底 0，按钮隐藏） |

机器可读：`im-report.json`（全流程）、`im-scroll-check.json`（登录按钮 + 滚动锚定）。

## 7. 回归结果（真实浏览器，正常 Chrome，无 CORS 绕过）

- 登录 → 主界面：✅（`path=/`，`title=全域播报`，`messages=50`）
- 发送消息：✅ `found=true, pending=false`
- 投票：✅ 新建投票卡 → 选中方案 A →「共 1 票」
- 任务：✅ 新建任务卡 → 点「进行中」→ 卡内状态变为进行中
- 素材上传：✅ ＋→素材 → presign/PUT/complete → material 卡入流（`upload-test.png`）
- DM / 群聊切换：✅ 标题分别切换为「沈巡检」「调度夜班」
- 详情抽屉：✅ 打开（成员 7），关闭正常
- 控制台：✅ 0 console error / 0 page error / 0 mobile error
- 横向溢出：✅ 1440 = 0，390 = 0
- 楼层号：✅ 无 UI 楼层号（seed 正文自带的 `（#511）` 非 UI）

## 8. 未完成 / 已知限制

1. 移动端消息操作仍只靠 `hover/focus-within`（符合本轮要求），触屏没有长按菜单；下一轮可加「长按/⋯」。
2. 列表未虚拟化：每页 50 条 + IntersectionObserver；极长会话/大量图片的性能未压测。
3. 私聊/群聊的新建、改名、加人、移除仍使用旧 `.ef-dialog` 弹窗（仅 IM 壳、登录、设置 Tailwind 化）。
4. 置顶在抽屉里只读（无 pin/unpin 入口）；无搜索、通知中心、灵感墙、作品墙、表情/反应 UI。
5. 消息正文按纯文本 + `@` 高亮渲染，不渲染 Markdown；线程编辑入口保留，未做独立线程面板。
6. `visualViewport` 键盘顶起只做高度同步；iOS Safari 的滚动回弹细节未在真机验证（本机 Chrome 390 模拟）。
