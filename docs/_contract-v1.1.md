# 契约 v1.1 补遗 · 实测回填

> 基线：`docs/_contract.md` v1.0（冻结，不改写）
> 本文件记录实现与验收过程中**契约未定义或需要收敛**的口径。下一版契约应把这些条目并入正文；在此之前，**以本文件为准**。

日期：2026-10-22　｜　状态：待并入 v1.1

---

## A. 实现口径（不改语义，只补细节）

| # | 条目 | v1.0 状态 | v1.1 口径 | 理由 |
| --- | --- | --- | --- | --- |
| A1 | REST 成功响应包裹 | 未定义 | `{ ok: true, data, requestId }` | 统一拦截器输出；错误走 `{ ok:false, error:{code,message,requestId,details?} }` |
| A2 | 缺资源错误码 | 无 `NOT_FOUND` | 暂用 `VALIDATION_FAILED(400)` + `field` | v1.1 建议新增 `NOT_FOUND(404)`；当前客户端按 400 处理 |
| A3 | `GET /me/devices` | §7 遗漏 | 补充为第 64 条 REST | 设备列表是推送管理的前置能力 |
| A4 | `POST /auth/password` | 与 `POST /me/password` 重复 | **删除**，只保留 `/me/password` | 避免两套改密入口 |
| A5 | REST 发消息请求体 | 未定义 | 与 WS `message:send` 同字段，含 `clientMsgId` | 两条路径幂等语义必须等价 |
| A6 | 投票选项传入 | §7 body 未列 | `POST /cards` body 增加 `options: string[]`（≥2） | 投票选项是卡片创建的一部分，避免二段提交 |
| A7 | 上传大小约束 | §10 写 `content-length-range` | presign PUT 不支援策略条件；改为 `complete` 阶段 `HeadObject` 严格比对 size + 512B 魔数 | S3 PUT 预签名不支持 POST policy 条件 |
| A8 | WS ack 错误细节 | 仅 `{ok,code,message}` | 追加同级字段：`dup`（幂等命中）、`until`（禁言截止）、`retryAfterMs`（限流） | 客户端需要这些值做 UI 与重试 |
| A9 | Socket.IO 路径 | §6 写 `io("/ws")` | 传输路径 `/socket.io/`，命名空间 `/ws`，反代按 `/socket.io/*` 放行 | 原写法会被误当成传输路径 |
| A10 | `/rtc` 预留 | §11 写“建连直接 connect_error” | 实现已补 `/rtc` 命名空间：**开关开/关**都拒绝，`data.code=NOT_IMPLEMENTED` | 预留位必须在协议层可见，而不是 404 |
| A11 | 通知 `system` 推送 | docs/07 曾写“恒放行” | 统一为：受 `notify_level` 与 DND 约束；站内通知行照写 | 与推送决策层实现一致；小团体不用推送叫醒人 |
| A12 | 推送决策 | 未定义 | `none` 不推；`mentions` 只放行 mention/thread_reply/card_assigned；活跃 socket 只 WS；DND 内仅 mention 推送 | 与验收口径一致，纯函数可测 |

---

## B. 明确未承诺 / 未实现（不属于 v1.0 必做，但要在 v1.1 写清）

| # | 项 | 状态 | 说明 |
| --- | --- | --- | --- |
| B1 | 预览生成 worker | 未实现 | `preview_status=pending`，前端回退原图；契约 §10 的“异步预览”需标为可选 |
| B2 | Web Push / FCM 真实投递 | 代码已接，未验证 | 决策层 12 例单测；无凭据/无网络，`push_status=skipped` 路径可测 |
| B3 | 前端工程（Next.js） | 不在本次范围 | 仅两套静态设计稿；Web 客户端由后续迭代实现 |
| B4 | 预览 worker / compose web 服务 | 未随附 | docs/10 已按真实 compose 订正 |
| B5 | `cards` 全文/trigram 索引 | 未建 | `type=card` 搜索在 50 人规模可接受；30 万消息以上再评估 |
| B6 | 设备级 presence | 未做 | presence 仍是用户级两态；“电脑在线、手机离线”时推送被抑制，属已知取舍 |
| B7 | 匿名投票的强匿名 | 未做 | `vote_ballots.user_id` 入库以保证一人一票/改选；接口不返回，但 DB 可反查 |
| B8 | 审计日志覆盖 | 部分 | 登录/注册/邀请/角色/删消息/归档已写；其他管理动作后续补 |

---

## C. 建议 v1.1 必改（按优先级）

1. 新增 `NOT_FOUND(404)`，替换消息/卡片缺失时的 400。
2. 明确 REST 响应包裹与分页结构（`items/nextCursor/hasMore`）。
3. 补 `typing` 的服务端广播事件（当前只写 Redis，客户端无法看到“正在输入”）。
4. 补 `options` 字段到投票卡片创建契约。
5. 把 A9（`/socket.io/` vs `/ws`）写进连接示例，避免部署踩坑。
6. 把 `cards` 的 trigram 索引与搜索范围写清。
7. 明确匿名投票的“接口匿名、存储可审计”边界。
8. 把推送决策表（A12）固化，避免文档与实现再次漂移。
