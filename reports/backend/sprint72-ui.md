# Sprint 7.2 · 环带 UI/UX 抢救

日期：2026-10-25  
目标：外网 IM 功能补齐、分享 ActionSheet、干员日常 ZZZ 重构。只做定向前端构建，不跑全量测试。

## 1. 环带 IM

### 头像

- `BeltSenderView`、`BeltPostAuthorView`、`BeltFriendView`、`BeltDmConversationView.peer` 增加 `avatarFileId`。
- 新增 `BeltAvatar`：按 fileId 请求 `/belt/files/:id/url`，S3 签名 URL，带请求缓存与首字母回退。
- 频道消息、私聊消息、私聊列表、日常卡片均显示头像。
- `beltUrl` 允许读取 `avatars/` 下的公开头像；不会暴露私聊文件。

### 图片 / 短视频

- 新增 `POST /belt/files/attachments/presign`，支持图片/短视频，复用 `checkUpload` 与 S3 预签名。
- `sendBeltMessageSchema` 增加 `attachmentIds`；消息写入 `attachments`。
- 消息视图附带 `attachments[].url`（服务端 S3 签名）；频道 UI 渲染图片/视频/文件。
- 输入框新增 `＋` 附件按钮、上传中 chips、附件移除。
- 浏览器直传遇到 CORS/PNA 时自动回退同源 `/belt/files/:id/upload`，仍使用同一预签名文件记录。

### 聊天管理

- 频道消息：长按 / 右键 / `⋯` 打开操作菜单，仅自己的消息可撤回；`DELETE /belt/channels/:id/messages/:messageId` 软删。
- 私聊消息：同样支持撤回。
- 清空私聊：新增 `direct_clears` 表 + `DELETE /belt/conversations/:id/messages`，仅当前用户不可见。
- 拉黑 / 删除好友：私聊头部增加按钮，调用既有 `PATCH /belt/friendships/:id {action:'block'}` / `DELETE`。
- 拉黑后 friendship 不再是 accepted，`BeltDirectService.access` 拒绝收发消息。

## 2. 转发 ActionSheet

- 新闻详情“转发 / SHARE”改为底部 ActionSheet，`createPortal` 到 body，暗黑霓虹样式。
- 复制链接：复制完整 `/belt/posts/:id` URL，显示“链路已复制”。
- 发送到频道：列出公开环带频道，`POST /belt/posts/:id/share {channelId}`。
- 发送给好友：列出 accepted 好友的 DM，`POST /belt/conversations/:dmChannelId/share {postId}`，创建 Card 消息。

## 3. 干员日常 ZZZ

- 新增 `BeltDailyView` 替换列表式日常页。
- 高对比霓虹标题、错位倾斜卡片、贴纸标签、横向 `scroll-snap` 滑轨。
- 大号悬浮 `+ NEW SIGNAL` FAB（portal 到 body，避免 fixed 被主容器裁剪）。
- 卡片突出头像（青色霓虹边框）、大字标题、`[极光科技]` 反光贴纸、认同/回波/详情。
- `/belt/daily` 不再重复渲染旧页头，直接进入绳网视觉。

## 4. 构建与截图

```text
web pnpm build  -> ✓ Compiled successfully
server pnpm build -> exit 0
```

未跑全量测试（按要求）。

截图：

- [环带聊天：头像 + 图片](../frontend/sprint72-chat-390.png)
- [转发 ActionSheet](../frontend/sprint72-share-sheet-390.png)
- [干员日常 ZZZ](../frontend/sprint72-daily-390.png)
