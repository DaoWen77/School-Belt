# Phase 1 前端验收报告（task-31）

日期：2026-10-24　｜　范围：`web/**`、`docs/18-前端.md`、`reports/frontend/`　｜　按 Lead 要求只 build，不重启 3100

> 当前 3100 由 Lead 统一重启；本报告不包含 LAN 截图（`phase1-*.png` 待 Lead 在 `192.168.1.9:3100` 验证后补）。

## 1. 构建

`cd web && pnpm build` → **exit 0**（`reports/frontend/build.log`）：

```text
▲ Next.js 15.5.28
✓ Compiled successfully
✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                     254 kB         364 kB
├ ○ /_not-found                            993 B         103 kB
├ ƒ /api/ai/[kind]                         122 B         102 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               3.42 kB         106 kB
└ ○ /settings                            6.77 kB         117 kB
+ First Load JS shared by all             102 kB
```

## 2. S3 URL 回写

文件：`web/src/lib/fileUrl.ts`、`web/src/lib/upload.ts`

- 新增 `resolvePublicUrl(url)`：
  - 仅当 `hostname === '127.0.0.1' || 'localhost'` 时替换为 `window.location.hostname`；
  - 保留原端口 / path / query；
  - 其他域名、非绝对 URL、SSR（无 window）原样返回。
- `getFileUrl` 在写入缓存前应用，Avatar/附件/图片预览统一走它。
- `uploadFile` 的 presigned PUT URL 也应用，LAN 上传不会打到 127.0.0.1。

示例（在 `http://192.168.1.9:3100`）：

```text
http://127.0.0.1:9000/bucket/file.png?X-Amz-... → http://192.168.1.9:9000/bucket/file.png?X-Amz-...
https://cdn.example.com/a.png                  → https://cdn.example.com/a.png（不变）
```

## 3. 头像稳定性

文件：`web/src/app/settings/page.tsx`、`web/src/components/im/Avatar.tsx`、`web/src/lib/fileUrl.ts`

- 保存头像/资料后 `invalidateFileUrl(avatarFileId)`；`invalidateFileUrl` 同时发 `dj:file-url-invalidated` 事件。
- `Avatar` 监听该事件并递增内部版本，`useFileUrl(fileId, variant, version)` 重新签名；设置页预览另加 `key={avatarVersion}`。
- 保留原生 `<img onError>` + 首字母兜底；未引入 next/image。
- 上传新头像、保存资料、移除头像三条路径都清缓存并触发重载。

## 4. 引用消息

文件：`web/src/lib/types.ts`、`Workspace.tsx`、`MessageList.tsx`、`MessageItem.tsx`

- `Message` 新增 `replyTo?: {id,senderId,displayName,bodySnippet,deletedAt} | null`（按 task-30 字段）。
- `sendMessage(body, parentId, attachments, replyTo)`：
  - 乐观消息写 `replyToId` 与 `replyTo`；
  - WS payload 带 `replyToId`；
  - ack 成功后保留 replyTo（服务端返回优先，缺省回填乐观值）；
  - 普通发送成功后清空 Composer 引用。
- 历史/WS 消息优先用后端 `replyTo`；缺失时用已加载 messages 按 `replyToId` 查找，生成作者/snippet。
- `MessageItem` 渲染引用块：作者 + snippet，删除消息显示「消息已删除」，点击滚动到原消息。
- 引用仅来自当前频道消息列表；后端拒绝时走 ack failed 态显示错误，不静默。

## 5. 验证状态

- `pnpm build` exit 0；未重启 3100（按 Lead 指定）。
- 待 Lead 在 `192.168.1.9:3100` 验证并截图：
  1. 上传图片 → 原图 URL host 为 `192.168.1.9:9000`；
  2. 刷新 3 次头像仍显示；
  3. 引用一条消息发送 → 消息流出现引用块；
  4. Console 0 error。

## 6. 未验证

1. 真实 S3 signed URL 在 LAN host 的打开/上传（需 Lead 重启后浏览器验证）。
2. 头像刷新 3 次的稳定显示（需 LAN 浏览器）。
3. 引用发送的端到端 RTT 与后端 task-30 实际 `replyTo` 字段（按约定字段实现；构建时后端可能仍在并行）。
4. 被引用消息删除后的「消息已删除」真实历史回放。
5. 未跑全量回归；未自行重启 3100。

## 4. 局域网 IP 实测（Lead 统一重启后）

环境：http://192.168.1.9:3100，API http://192.168.1.9:3000，S3 http://192.168.1.9:9000。

| 项 | 结果 |
| --- | --- |
| presign uploadUrl host | **192.168.1.9:9000**（不再是 127.0.0.1） |
| 预签名 PUT | **200** |
| complete | eady |
| GET signed URL host | **192.168.1.9:9000** |
| 下载字节 | 70 bytes，与上传 **逐字节相等** |
| 头像 ACL（qiu 读 founder 头像） | **200**（修复前会 403） |
| 页面 S3 请求 host | 仅 192.168.1.9:9000 |
| 图片 naturalWidth | 770（真实加载，非占位） |
| 刷新 3 次后的头像 | 仍有 
aturalWidth=770，未回退首字母 |
| 引用发送 | 消息行显示原作者 + 原消息摘要 + 新正文 |
| 截图 | phase1-lan-1440.png、phase1-lan-390.png |

### 残留问题

- LAN 页面仍有 Minified React error #418（hydration 文本不匹配），非本次 4 个 Bug，未在 Phase 1 处理；需后续单独定位。
