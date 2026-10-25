# 环带发送与局域网 API 回退修复

日期：2026-10-25  
范围：前端发送幂等键、API/WS 地址解析、局域网登录。

## 1. `TX_FAILED 字段校验未通过`

### 根因

环带频道发送：

```json
{ "body": "…", "clientMsgId": "17928…-随机串" }
```

`BeltChannelView` / `BeltDirectView` 的本地 `uid()` 在非安全上下文（局域网 `http://192.168.1.9:3100`）下：

- `crypto.randomUUID` 不存在；
- 回退成 `${Date.now()}-${Math.random()}`，不是 UUID；
- 后端 `sendBeltMessageSchema` 要求 `clientMsgId: z.string().uuid().optional()`；
- 校验失败，前端显示 `TX_FAILED 字段校验未通过`。

### 修复

- 环带频道与环带私聊统一改用 [`randomUuid()`](../../web/src/lib/uuid.ts)：
  - 安全上下文用 `crypto.randomUUID()`；
  - 局域网/HTTP 用 `crypto.getRandomValues()` 生成 RFC 4122 v4；
  - 老浏览器最后回退 Math.random。
- 请求字段仍与 DTO 对齐：

```json
{
  "body": "消息正文",
  "clientMsgId": "4a8f08ae-7c3e-4c01-accf-477f6048e8be"
}
```

### 实测

在 `http://192.168.1.9:3100/belt/channel`（非安全上下文）：

```text
SECURE false
RANDOM_UUID_TYPE undefined
POST http://192.168.1.9:3000/api/v1/belt/channels/.../messages
body {"body":"LAN发送验证 …","clientMsgId":"4a8f08ae-7c3e-4c01-accf-477f6048e8be"}
SENT_VISIBLE true
TX_FAILED_VISIBLE false
LINK_LIVE true
```

发送后 `TX_FAILED` 消失，消息进入列表，WS 状态为 `LIVE`。

## 2. 局域网 API 回退

### 根因

`web/.env.local` 构建期注入了：

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=http://localhost:3000
```

手机访问 `http://192.168.1.9:3100` 时，前端读取到 `localhost:3000`，手机上的 `localhost` 指向手机自身，于是 `Failed to fetch`。

### 修复

重写 [`web/src/lib/api.ts`](../../web/src/lib/api.ts) 的解析顺序：

1. `localStorage` 手动保存的 `dj-server-api` / `dj-server-ws`；
2. 环境变量；
3. 当前浏览器 hostname：
   - 页面在 `3100` → `http://${hostname}:3000`；
   - 页面在 `3000` / 无端口 → 同源；
   - 页面是 HTTPS → `https://…`；
   - WS 由 API 地址切换成 `ws://` / `wss://`。

同时：

- 非 loopback 页面访问时，自动忽略构建期注入的 `localhost/127.0.0.1` 地址；
- WS 地址直接输出 `ws://` / `wss://`，Socket.IO 已实测可连接；
- 登录页服务器设置兼容 `ws://` / `wss://`；
- 同源 AI 代理不再写死 localhost，按请求 Host 推导 `:3000`；
- `web/src` 内已无 `localhost:3000` / `127.0.0.1:3000` 硬编码。

### 实测

局域网登录页：

```text
API http://192.168.1.9:3000
LOCALHOST_VISIBLE false
```

使用 `founder / Dijiang#2026` 从 `http://192.168.1.9:3100/login` 登录：

```text
AFTER_LOGIN_URL http://192.168.1.9:3100/
HOME_ERROR false
```

手动保存优先：

```text
localStorage dj-server-api = http://192.168.1.9:3999
SAVED_OVERRIDE_VISIBLE true
DYNAMIC_3000_VISIBLE false
```

## 3. 构建

```text
web pnpm build -> ✓ Compiled successfully
```

> 注：`web/.env.local` 仍由本机构建环境注入 localhost；代码已在非 loopback 访问时跳过该值。若希望构建产物完全不带默认地址，可将该变量留空。
