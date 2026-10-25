# Sprint 4 前端验收报告（task-26）

日期：2026-10-24　｜　范围：`web/**`（未改 server/ops/design）　｜　真实 API 3000

> 测试策略：只跑 `pnpm build` + 本 Sprint 截图冒烟，不跑全量回归。

## 1. 构建

`cd web && pnpm build` → **exit 0**（`reports/frontend/build.log`）：

```text
▲ Next.js 15.5.28
✓ Compiled successfully
✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                     250 kB         360 kB
├ ○ /_not-found                            993 B         103 kB
├ ƒ /api/ai/[kind]                         122 B         102 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               3.42 kB         106 kB
└ ○ /settings                            4.36 kB         114 kB
+ First Load JS shared by all             102 kB
```

新增：`im/MomentsView.tsx`、`im/ArchiveView.tsx`、`im/ScrambleText.tsx`、`im/GlobalPlayer.tsx`、`im/ActivityRadar.tsx`、`im/SudoPrank.tsx`、`store/player.ts`、`styles/sprint4.css`。

## 2. 功能映射

### 2.1 朋友圈独立视图

- 侧栏顶部 `聊天 / 朋友圈 / 档案室` 切换；朋友圈不干扰聊天状态（聊天组件不卸载逻辑，仅视图切换）。
- 列表：作者/时间/正文/图片九宫格/点赞数/评论数；发帖（文字 + 图片 presign→PUT→complete→POST /posts，body `{body,fileIds}`）。
- 点赞/取消、评论展开与发表、删除自己帖子（二次确认）。
- 实测（真实 API）：
  - 发布带图动态成功并保留，未删除；
  - 点赞后 `♥ 1`，评论后 `评论 1`，评论正文显示；
  - 截图 `sprint4-moments-1440.png`（2 条动态，含图/点赞/评论）、`sprint4-post-1440.png`。
- 现场页面已有 2 条动态（旧 + 本轮），证明不是空态。

### 2.2 常驻音乐播放器

- `store/player.ts`（Zustand）+ `GlobalPlayer.tsx`；AppShell 底部常驻条，切换 SPA 视图不断播。
- 队列来自当前频道 `/channels/:id/cards?kind=music&limit=50`；RichCard 音乐卡也支持「加入队列」。
- 控件：播放/暂停/上一首/下一首/进度/音量；`<audio preload="none">`，点击播放后才设置 src。
- 实测：`hasAudio=true`、`bar=true`、队列 6 首、当前「Sprint2 测试音乐」；未点击播放，`audioSrc=null`（不预加载外部直链）。
- 截图：`sprint4-player-radar-1440.png`、`sprint4-mobile-moments-390.png`（移动端播放器条）。

### 2.3 档案室 Scramble

- 侧栏「档案室」；`GET /archive` 网格展示素材/作品/灵感卡。
- `ScrambleText` 用 requestAnimationFrame 做解码；`prefers-reduced-motion` 直接显示目标文本；标题/正文逐字解码。
- 点击卡片调用频道跳转。
- 实测：`header=档案室`，19 条记录；图片缺失显示 `NO PREVIEW`，无破图；截图 `sprint4-archive-scramble-1440.png`、`sprint4-archive-1440.png`。

### 2.4 HUD 雷达图

- 侧栏折叠区「态势 HUD」；`ActivityRadar` 读取 `GET /stats/activity`，Recharts `RadarChart` 五维：消息/活跃/任务/投票/素材，并显示数值。
- 实测：`hud=true`，`radarSvg=1`，指标 `消息 1405 / 活跃 9 / 任务 2 / 投票 0 / 素材 43`。截图同上。

### 2.5 命令彩蛋

- `/ping`：本地消息显示 `[PING] REST /healthz 16ms / WS socket.connected`；**不发送后端消息、不触发 AI**。
- `sudo rm -rf /`：全屏雪花/扫描线/抖动/KERNEL PANIC；3 秒后自动恢复；**不发消息、不请求后端**。
- 实测：`ping.hasPing=true`；`sudoActive=true` → `sudoGone=true`。
- 截图：`sprint4-ping-1440.png`、`sprint4-sudo-1440.png`。

### 2.6 390 移动端

- 侧栏抽屉进入朋友圈；无横向溢出，朋友圈发布/图片/点赞/评论布局正常；底部播放器可见。
- 实测：`header=朋友圈`、`overflowX=0`、`hasComposer=true`。截图 `sprint4-mobile-moments-390.png`。

## 3. 验收计数（`sprint4-report.json`）

```text
radar.hud=true, radar.radarSvg=1
player.bar=true, player.hasAudio=true, queueText=「Sprint2 测试音乐」, audioSrc=null（未点击播放）
postCreated.found=true, postInteractions: ♥1 / 评论1
archive.header=档案室, archive.cards=27
ping.hasPing=true（REST 16ms / socket.connected）
sudoActive=true → sudoGone=true
mobile.header=朋友圈, overflowX=0
errors=[]
pageErrors=[]
failedRequests=[]
```

## 4. 截图（reports/frontend/）

| 文件 | 内容 |
| --- | --- |
| `sprint4-player-radar-1440.png` | 播放器条 + 侧栏雷达图 |
| `sprint4-moments-1440.png` | 朋友圈（带图动态/点赞/评论） |
| `sprint4-post-1440.png` | 新发朋友圈 |
| `sprint4-archive-scramble-1440.png` | 档案室进入时 Scramble |
| `sprint4-archive-1440.png` | 档案室网格 |
| `sprint4-ping-1440.png` | `/ping` 本地延迟 |
| `sprint4-sudo-1440.png` | sudo 彩蛋 |
| `sprint4-mobile-moments-390.png` | 390 朋友圈 + 播放器 |

## 5. 未验证 / 已知限制

1. **音频真实播放未点击**：为避免外部网易云直链请求/版权问题，只验证了点击前不加载（`audioSrc=null`）与队列/控件；真实播放/网络失败未验。
2. **播放器跨路由**：SPA 视图切换（聊天/朋友圈/档案室）保持队列与播放状态；跳到 `/settings` 属于整页路由，播放器会卸载停止，未做跨整页持久播放。
3. **朋友圈删除**：UI 有二次确认，但本轮为保留截图数据**未实际删除**；发帖/点赞/评论已验。
4. **档案室点击跳频道**：实现但未点击跳转断言；图片缺失显示 `NO PREVIEW`。
5. **Scramble**：截图捕捉的是解码中/后状态；`prefers-reduced-motion` 的真机/系统设置未验。
6. 只跑 build + 本 Sprint 冒烟，未跑 Sprint1–3/全量回归。
7. 现场朋友圈有测试动态（旧 + 本轮），均为真实 API 数据，不是 mock。
