# 真实基础设施（本机，无 Docker）

> 结论：本机**无法使用 Docker**，已改为同等的原生真实服务。不是 s3rver，不是内存降级。

## 为什么没有 Docker

| 检查项 | 实测 |
| --- | --- |
| Docker / WSL | 未安装；`wsl --status` 提示需先安装 |
| Hyper-V / 虚拟化 | `HypervisorPresent = False` |
| Docker Hub | `registry-1.docker.io` 连接超时 |
| C 盘可用 | 约 3.5 GB（Docker Desktop + WSL2 镜像不够） |
| MinIO Windows 二进制 | 官方 `dl.min.io/.../windows-amd64` 返回 **410 Gone**（已下架） |

因此没有走 Docker；如果以后要严格用 Docker + MinIO，需要先启用 WSL2/Hyper-V 并**重启**，再用可访问的镜像源拉取 `redis`/`minio`。

## 当前真实服务

| 服务 | 实现 | 地址 | 说明 |
| --- | --- | --- | --- |
| Redis | **Memurai 4.1.8**（`redis_version:7.2.12`） | `127.0.0.1:6379` | Windows 服务，开机自启；Redis 7 协议兼容 |
| S3 | **rclone 1.75.2 `serve s3`** | `0.0.0.0:9000` | 真实 S3 协议、SigV4、预签名 PUT/GET、CORS `*`；不是 MinIO，也不是 s3rver |
| PostgreSQL | **PostgreSQL 17.5**（embedded 发行版） | `127.0.0.1:55432` | 真实 PG，由 `run-backend.mjs` 启动 |
| k6 | **2.3.0** | `C:\Program Files\k6\k6.exe` | PATH 未加入，用全路径 |

## 启动

```powershell
# 1) Redis + S3
powershell -ExecutionPolicy Bypass -File ops/infra/start-real.ps1

# 2) API（会启动 embedded PG；默认 REDIS_URL/S3 已指向上面）
node ops/e2e/run-backend.mjs --skip-build --skip-seed

# 3) 检查
curl.exe http://127.0.0.1:3000/readyz
# 期望：postgres=true s3=true redis=true，无 degraded
```

停止：

```powershell
powershell -ExecutionPolicy Bypass -File ops/infra/stop-real.ps1  # 只停 rclone
# Memurai 是 Windows 服务，保持运行
```

## S3 数据与凭据

- bucket：`dijiang`
- 数据目录：`reports/e2e/rclone-s3/dijiang`
- 凭据：`minioadmin / minioadmin`（仅本机开发）
- CORS：`--allow-origin *`（仅本机/局域网开发；生产必须收紧到 Web 源）
- 预签名：浏览器直传 `PUT` 与下载 `GET` 均走 S3 预签名 URL，**没有自建 CORS 代理**

## 已验证

- `OPTIONS` 预检：200，`Access-Control-Allow-Origin: *`
- 预签名 `PUT`/`GET`：200
- 上传全链路：presign → PUT → complete → 下载逐字节一致（8/8）
- Redis：`DBSIZE` 有真实 key（`dijiang:ratelimit:login:*`、`dijiang:ratelimit:msg:*`）
- Redis 不可用（`REDIS_URL=redis://127.0.0.1:1`）时 API 启动 **exit 1**，不降级

## 迁移到 MinIO / 云 S3

把 `S3_ENDPOINT`/`S3_PUBLIC_ENDPOINT` 换成 MinIO 或云 S3 地址，配置桶 CORS（允许 Web 源、`PUT/GET/HEAD`、`content-type`、暴露 `ETag`），代码不需要改。Redis 同理，设置 `REDIS_URL` 指向真实 Redis 即可。
