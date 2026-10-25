# Sprint 1 前端验收报告（task-20）

日期：2026-10-23　｜　范围：`web/**`（未改 server/ops/design）　｜　真实环境：API 3000 / Web 3100 / S3 9000 / PG 55432 / Redis 6379

## 1. 构建

`cd web && pnpm build` → **exit 0**（`reports/frontend/build.log`）：

```text
▲ Next.js 15.5.28
✓ Compiled successfully
✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                    90.7 kB         201 kB
├ ○ /_not-found                            993 B         103 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               3.42 kB         106 kB
└ ○ /settings                            3.16 kB         113 kB
+ First Load JS shared by all             102 kB
```

新增依赖：`react-virtuoso@4.18.19`、`react-markdown@10.1.0`。

## 2. 功能映射

### 2.1 react-virtuoso 虚拟列表

文件：`web/src/components/im/MessageList.tsx`

- `Virtuoso` + `startReached` 加载更早；`firstItemIndex` 在 prepend 时递减，保持视口位置；
- `followOutput` 贴底；`atBottomStateChange` 控制「↓ 回到最新」；`atBottomThreshold=240`（与产品阈值一致）；
- 首次进入/点击回底使用 `scroller` 直接 `scrollTop=scrollHeight`（不再依赖 `scrollToIndex('LAST', align:'end')`，Virtuoso 会留一个 item 高度 184px）；
- `computeItemKey={(index,message)=>message.id}`：**稳定 ID，不用索引 key**；
- 保留分组、线程、卡片、附件、长按、hover 操作。

实测（1440×1000，`sprint1-report.json`）：

| 指标 | 值 |
| --- | --- |
| 初始渲染 DOM 节点 | **15** |
| 连续上滚加载 | 7 页（约 350 条），DOM 仍只有 **24** 个消息节点 |
| 初始距底 | **0** |
| 「回到最新」点击后距底 | **0**，按钮隐藏 |
| Console / pageerror | 0 / 0 |

截图：`sprint1-desktop-1440.png`、`sprint1-virtuoso-1440.png`

### 2.2 长按 ActionSheet

文件：`web/src/components/im/MessageItem.tsx`、`ActionSheet.tsx`

- `touchstart` 500ms 长按，`touchmove >10px` 取消；`onContextMenu` 在 coarse pointer 下阻止原生菜单；
- 触发 `navigator.vibrate?.(20)`（不支持则静默）；
- Sheet：回复 / 复制 / 编辑 / 删除；编辑/删除按 own 禁用，复制用 `navigator.clipboard`；
- 遮罩 `bg-[#161616]/60 + backdrop-blur-sm`；桌面 hover 菜单保留。

实测（390 宽，真实 TouchEvent 派发）：

```json
{
  "visible": true,
  "labels": [
    {"text":"回复","disabled":false},
    {"text":"复制","disabled":false},
    {"text":"编辑…","disabled":true},
    {"text":"删除…","disabled":true},
    {"text":"取消","disabled":false}
  ]
}
```

截图：`sprint1-actionsheet-390.png`、`sprint1-mobile-390.png`

### 2.3 个人资料 / 头像 / 状态前缀

文件：`web/src/app/settings/page.tsx`、`Avatar.tsx`

- 显示名、状态前缀（≤24）；`PATCH /me` 后即时更新；
- 头像：选首个已加入频道作为 scope → `POST /files/presign → PUT → complete → PATCH /me {avatarFileId}`；
- 修正：`PATCH /me` 契约返回**裸 PublicUser**（不是 `{user}`），之前按 `{user}` 读导致 `INTERNAL Cannot read properties of undefined (reading 'avatarFileId')`；现在兼容两种形状；
- `Avatar` 加载前/加载失败显示首字母，不渲染黑块/破图；fileId 变化重置失败态。

实测：

```json
{
  "displayName": "林测绘",
  "statusPrefix": "战术规划中",
  "avatarFileId": "918bdb8d-dfc0-4064-8b92-a3b60b3b0268",
  "imageOk": { "width": 128, "height": 128 },
  "signedHost": "http://127.0.0.1:9000",
  "removeButton": true
}
```

Header/侧栏/消息头像均使用签名 URL：4 个当前用户头像 `naturalWidth=128`；无头像用户显示首字母回退。截图：`sprint1-settings-1440.png`、`sprint1-prefix-1440.png`。

### 2.4 群公告 / 踢人确认 / 危险区

文件：`web/src/components/im/DetailDrawer.tsx`、`Markdown.tsx`

- 公告仅群聊显示；moderator 可编辑，`PATCH /conversations/:id/announcement`；只读用 `react-markdown` **白名单**（`allowedElements`，不启用 raw HTML），链接 `target=_blank rel=noreferrer`；
- 踢人二次确认，确认后才调 `DELETE /conversations/:id/members/:userId`；
- 危险区要求输入群名完全匹配；`DELETE /conversations/:id` 成功后关闭抽屉并回到「全域播报」；
- 红色仅用于危险操作。

实测（临时群，测试后已解散）：

```json
{
  "drawer": {"hasAnnouncement": true, "hasDanger": true},
  "announcement": {
    "rendered": true,
    "h1": "夜班公告",
    "listItems": 2,
    "rawImg": false,
    "rawScript": false,
    "xss": null
  },
  "kickConfirm": true,
  "danger": {"disabledBefore": true, "disabledAfterExactName": false},
  "dissolved": {"drawerClosed": true, "groupGone": true, "selectedChannel": "全域播报"}
}
```

截图：`sprint1-announcement-1440.png`、`sprint1-kick-confirm-1440.png`、`sprint1-danger-1440.png`、`sprint1-dissolved-1440.png`

> 后端 `ConversationView` 目前未返回 `createdBy`，前端在字段缺失时退化为「群聊 moderator 可见危险区」，最终由服务端 `dissolve` 校验群主；如后端补 `createdBy`，前端会自动切到严格判断。

### 2.5 侧栏置顶

文件：`web/src/components/im/Sidebar.tsx`

- 频道/私聊/群聊行 hover 显示图钉；置顶项排前并显示黄色钉；
- `localStorage` key `dj-pins:<userId>`，按用户隔离；刷新后保持。

实测：

```json
{
  "storage": {"dj-pins:5ab7...": "[\"channel:36784d3d-...\"]"},
  "order": ["素材工坊(pinned)", "全域播报", "第三协议"],
  "afterReload": {"first":"素材工坊","firstPinned":true}
}
```

截图：`sprint1-pins-1440.png`

### 2.6 安全红线

- `react-markdown` 白名单，不启用 `rehype-raw`；无 `dangerouslySetInnerHTML`；
- 公告中的 `<script>` 与 `<img onerror>` 被转成文本，DOM 中 `rawScript=false`、`rawImg=false`、`window.__sprintXss=null`；
- 消息列表 key 使用稳定 `message.id`。

## 3. 本轮修复记录（Lead 反馈）

1. **头像黑块/破图**：`Avatar` 增加 `onLoad/onError` 与首字母占位，加载前也不出现黑块；同时确认上传链路真实写入 `avatarFileId`，签名 URL 200、图片 128×128。截图中的旧黑块是之前 e2e 上传的深色测试图（本轮改用黄色测试图验证真实加载）。
2. **`settingsSaved.saved=false`**：改成直接读回 `GET /me` 的 `displayName/statusPrefix/avatarFileId` 判定；同时修复 `PATCH /me` 返回裸 user 导致的 `INTERNAL`。
3. **假阴性断言**：长按 Sheet 用 rect 高度判断可见；Drawer 公告/危险区匹配改为大小写不敏感；全部通过。
4. **虚拟列表回底 184px**：改为直接操作 Virtuoso scroller `scrollTop = scrollHeight`，初始与「回到最新」实测 `distance=0`。

## 4. 截图（reports/frontend/）

| 文件 | 内容 |
| --- | --- |
| `sprint1-desktop-1440.png` | 初始进入（贴底、Virtuoso、无楼层号） |
| `sprint1-virtuoso-1440.png` | 上滚加载更早后的窗口状态（DOM 24） |
| `sprint1-pins-1440.png` | 素材工坊置顶、排序与钉图标 |
| `sprint1-settings-1440.png` | 资料表单 + 黄色测试头像 |
| `sprint1-prefix-1440.png` | Header/侧栏/消息显示 `[战术规划中]` |
| `sprint1-announcement-1440.png` | 群公告 Markdown 渲染 + XSS 文本转义 |
| `sprint1-kick-confirm-1440.png` | 踢人二次确认 |
| `sprint1-danger-1440.png` | 危险区输入群名后按钮启用 |
| `sprint1-dissolved-1440.png` | 解散后回退默认频道 |
| `sprint1-mobile-390.png` | 390 宽消息流 |
| `sprint1-actionsheet-390.png` | 长按 ActionSheet |
| `sprint1-avatar-source.png` | 本轮头像上传测试源图（黄色十字） |

机器可读：`sprint1-report.json`。

## 5. 未验证 / 已知限制

1. **未用 1000 条 mock**：要求是真实 API，没有引入假数据；用真实会话连续加载 7 页（约 350 条），DOM 24，已证明窗口化。若需 1000 条压测，需要额外造数据（本轮未做）。
2. **iOS 真机触感**：`navigator.vibrate` 在 iOS Safari 不支持，只做可选调用；真机未验。
3. **踢人只验证了二次确认 UI，未实际移除成员**（保留临时群成员用于解散验证）；DELETE 路径前序任务已验证。
4. **危险区群主判断**：后端视图无 `createdBy`，当前 moderator 可见、服务端兜底校验；后端补字段后自动严格。
5. **置顶是浏览器本地**（localStorage），不跨设备；符合任务要求。
6. 头像签名 URL 过期由 `useFileUrl` 缓存/刷新机制处理；未做跨标签页同步。
7. Sprint 2 功能未动。
