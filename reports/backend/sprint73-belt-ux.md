# Sprint 7.3 · 环带体验修复

日期：2026-10-25  
要求：直接改代码，不跑全量测试，构建通过即可。

## 一、关键 Bug

### 1. 页面无法滑动到底（已修）

根因：`.belt-shell` 用 `grid-template-rows: auto minmax(0,1fr)` + `.belt-shell-body` 用 grid，
中间 `main` 的 `min-height` 在部分视口下被内容撑开，导致 `main` 自己的滚动区不生效。

- `.belt-shell` 改为 `display:flex; flex-direction:column; height:100dvh; overflow:hidden`
- `.belt-shell-body` 改为 `display:flex; flex:1 1 auto; min-height:0; overflow:hidden`
- `.belt-main` 改为 `flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain`
- `.belt-main-inner` 增加 `padding-bottom`，保证最后一张卡片/输入框不被底边裁掉

实测（Playwright，390×844 / 1440×900）：

```text
/belt/daily        main 630 / scroll 835   overflow auto
/belt/dispatch     main 630 / scroll 6051  overflow auto
/belt/profile      main 630 / scroll 974   overflow auto
滚到底：atBottom = true（三个页面）  底部 gap ≈ 13px
```

### 2. 图片/视频无法预览（已修）

- 新增 `BeltLightbox`：`createPortal` 到 body，全屏 94% 黑遮罩，点击遮罩 / × 关闭。
- 频道消息：图片/视频改为 `<button>` 缩略图，点击开 Lightbox。
- 干员日常：新增封面图，点击开 Lightbox。
- 不再使用 `target="_blank"` 直跳原图。

### 3. 私聊好友“用户不存在”（已修）

- 前端提交前：`handle.replace(/^@/, '').trim().toLowerCase()`
- 后端查询：`dto.handle.replace(/^@/, '').trim().toLowerCase()`
- 数据库 `users.handle` 本身是 `citext`，查询天然忽略大小写。

实测：

```text
CHEN      -> 正确解析到 chen（随后被内部/外网跨面规则拦截，属预期）
@chen     -> 正确解析到 chen
"  @Chen " -> 正确解析到 chen
```

### 4. 审批后无需刷新（已修）

- 新增 `belt:refresh` 全局事件；组织审批、加入审批、新建频道后立即派发。
- `BeltSidebar`、`BeltChannelView` 监听后重拉数据。
- 处理中心动作完成后同样触发。
- 侧栏频道列表、DM 列表随之更新，无需 F5。

## 二、功能补齐

### 1. 新闻配图（已修）

- `posts` 新增：`cover_url` / `cover_file_id` / `cover_mime`（迁移 0022、0023）。
- RSS 抓取：从 `content:encoded` → `content` → `summary` → `description` 正则取第一个
  `<img src>`，仅接受 `http(s)`，截断 1000 字符写入 `posts.cover_url`。
- Bento 卡片显示封面；干员日常卡片显示封面并支持 Lightbox。
- 站内发帖支持上传封面：`POST /belt/files/post-media/presign`，写入 `cover_file_id`。

### 2. Founder 快捷处理中心（已做）

- 顶栏头像旁 `🔔 处理中心`，有待办时显示红点数字。
- 下拉面板支持直接在环带处理：
  - 待审组织（通过 / 驳回）→ `PATCH /belt/organizations/:id/review`
  - 好友申请（同意 / 拒绝）→ `PATCH /belt/friendships/:id`
  - 组织加入申请（通过 / 拒绝）→ `PATCH /belt/organizations/:id/requests/:userId`
- 全程不需要切回内网。

### 3. Founder 新建频道（已做）

- 侧栏“频道列表”下方 `＋ 新建频道`（仅 owner/admin 可见）。
- 新增 `POST /belt/channels`，直接创建 `surface=belt` 的公开频道。
- 创建后派发 `belt:refresh`，侧栏与当前页面立即刷新。

### 4. 干员日常 + 表情包（已做）

- 发帖抽屉支持封面图片上传与预览。
- 预置 16 个赛博风 Emoji：`⚡🌐🛰️🎧👾💾🔮🧬🕹️📡🌒⚙️🔥💿🚀🩸`，点击插入正文。
- 自定义贴图沿用已有 `/stickers` 系统（文件需 ready + image + 本人）。

## 三、布局与导航

### 1. 侧栏大融合（已做）

`BeltSidebar` 三组折叠，Discord 结构：

- **频道列表**：公共大厅 + 所有公开频道 + 我所在组织的私有频道（按组织分组）
- **私聊链路**：好友 DM 列表（含头像），点击直达 `/belt/direct?conversationId=…`
- **系统页面**：干员日常 / 新闻塔 / 悬赏 / 组织中心 / 个人中心

点击直接切换中间主视图；组织私有频道不再需要先进组织中心。
移动端（≤820px）折叠为 137px 横向紧凑条，主内容区仍有 630px 可滚动高度。

### 2. 个人与组织界面（已做）

- 个人中心新增“最近活跃”：发帖数 / 获认同 / 获回波 + 最近 6 条信号。
  - 新增 `GET /belt/stats`。
- 组织中心新增成员列表，显示头像、handle、角色与证章贴纸。

## 四、构建

```text
web  pnpm build  -> ✓ Compiled successfully
server pnpm build -> tsc exit 0
migrations        -> 23 个全部应用（新增 0022 / 0023）
```

## 五、截图

- [融合侧栏 + 干员日常](../frontend/sprint73-daily-390.png)
- [Bento 新闻墙（含封面位）](../frontend/sprint73-dispatch-390.png)
- [转发 ActionSheet（portal 全屏暗黑）](../frontend/sprint73-share-390.png)
- [处理中心下拉](../frontend/sprint73-inbox-390.png)

> 说明：本轮模型不具备图片识别能力，视觉结果通过 DOM/像素断言验证
> （滚动到底 `atBottom=true`、遮罩背景 `rgb(13,16,11)`、面板可见等）。
