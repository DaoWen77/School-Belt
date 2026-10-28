# ofalias.net 内网穿透配置操作指南

目标：手机能打开穿透后的前端（3100），并让前端成功调用本地 API（3000）与 WebSocket。

## 一、先把后端 CORS 放开

本仓库已完成：后端新增 `TUNNEL_ORIGINS` 环境变量，用于放行 ofalias.net 隧道域名。

在 `server/.env`（本地实际环境文件，不是 `.env.example`）里加一行：

```bash
# 放行 ofalias.net 下所有子域名的任意端口（TCP 隧道每次分配的端口会变）
TUNNEL_ORIGINS=*.ofalias.net
```

> 精确写法：如果你的隧道固定是 `http://cn-hk-bgp-4.ofalias.net`，也可以写
> `TUNNEL_ORIGINS=cn-hk-bgp-4.ofalias.net`（不带端口）。推荐 `*.ofalias.net`，一劳永逸。

改完后重启后端：

```bash
cd server
pnpm build          # 已改代码，先重新编译
# 然后重启你平时的 API 进程（run-backend / pnpm start 任选其一）
```

> 后端 `HOST` 默认就是 `0.0.0.0`（`server/.env.example` 里已确认），监听没问题。
> WebSocket 与 REST 共用同一份 CORS 白名单，会自动随 `TUNNEL_ORIGINS` 生效。

## 二、在 ofalias.net 控制台为 3000 端口新建 TCP 隧道

1. 登录 ofalias.net 控制台。
2. 找到「新建隧道 / Create Tunnel」。
3. 类型选 **TCP**（不是 HTTP/HTTPS，因为我们后面要写死公网地址）。
4. 本地地址填 `127.0.0.1`（或 `localhost`），本地端口填 **`3000`**。
5. 保存 / 启动。

> 注意：3100（前端）你已经穿透成功，保持不动。这条新的 TCP 隧道只给 API 用。

## 三、获取 3000 隧道映射后的公网地址

1. 回到隧道列表，找到刚才那条 **3000 → TCP** 的隧道。
2. 控制台会给出一个公网入口，形如：

   ```text
   http://cn-hk-bgp-4.ofalias.net:xxxxx
   ```

   其中 `xxxxx` 是 ofalias 分配的**随机端口**，每次重启隧道可能变化。
3. 复制完整地址（含端口），这就是 API 公网地址。

> 如果你的控制台给的是 `tcp://` 开头，把 `tcp://` 换成 `http://` 填进前端即可（Socket.IO 会自动在 http 上做轮询并升级到 ws）。

## 四、手机页面「服务器设置」怎么填

打开手机上的工作台页面 → 设置 / 服务器设置：

| 字段 | 填什么 |
| --- | --- |
| **API 地址** | `http://cn-hk-bgp-4.ofalias.net:xxxxx`（就是你刚复制的 3000 隧道公网地址） |
| **WS 地址** | 同上，也填 `http://cn-hk-bgp-4.ofalias.net:xxxxx` |

> 关键点：
> - **不要**填 `ws://`。TCP 隧道下 Socket.IO 会先发 HTTP 长轮询握手，再自动升级为 WebSocket。
> - **不要**填本地 `127.0.0.1:3000` —— 那是手机自己，不是你电脑。
> - 前端 3100 和 API 3000 是两个不同隧道，端口不同，所以前端必须显式填 API 地址，不能依赖自动探测。

## 五、验证

1. 手机浏览器打开前端穿透地址。
2. 进「设置 → 服务器设置」，填入上面两个地址，保存。
3. 回到环塔频道 / 任意需要 API 的页面：
   - 能加载频道列表、消息 = REST 通了；
   - 能实时收到新消息、头像/表情不转圈 = WebSocket 通了。

如果仍报 `Failed to fetch`，按顺序查：

1. 后端是否加了 `TUNNEL_ORIGINS=*.ofalias.net` 并重启；
2. 隧道本地端口是不是 `3000`（不是 3100）；
3. 手机里填的 API 地址端口是不是 ofalias 给的那个随机端口；
4. 后端是否真在 `0.0.0.0:3000` 监听（`netstat -ano | findstr :3000`，看到 `0.0.0.0:3000` 即正确）。

## 附：TUNNEL_ORIGINS 技术说明

- 新增字段：`server/src/config/env.ts` → `TUNNEL_ORIGINS`（默认空，安全）。
- CORS 解析：`server/src/config/cors.ts` 新增域名通配 `*.host.tld`，且对隧道域名放行任意端口（http/https）。
- 同时作用于 REST（Fastify `enableCors`）与 WebSocket（`ConfiguredIoAdapter`），两份共用同一个 `isOriginAllowed`。
