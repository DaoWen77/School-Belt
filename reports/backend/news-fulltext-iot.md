# 新闻塔全文 / 互动 + IoT 设备 API

日期：2026-10-25  
范围：移除 body 长度约束；RSS 全文；分类 Bento；点赞/回波/站内转发；ESP32 device API。

## 1. 数据库约束修复

迁移：[0018_posts_body_unbounded](../prisma/migrations/0018_posts_body_unbounded/migration.sql)

```sql
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_body_length_check";
```

应用后直接查询 `pg_constraint`：

```text
body check remaining 0
```

长文实测：`content:encoded` 生成的正文 **11,957 字符**成功写入 `posts.body`。

## 2. RSS 抓取加固

文件：`server/src/rss/rss.service.ts`

- `content:encoded` → `content` → `contentSnippet` → `summary` 优先级不变。
- 正文上限从 8,000 提升到 200,000 字符。
- HTML 清洗保留段落换行（`</p>` / `<br>` / `</h1-6>`），去除脚本/样式/标签。
- 每条 item 单独 `try/catch`：
  - 失败 `console.error` 输出 source/title/error；
  - `skipped += 1`；
  - 继续处理下一条，不再让单条坏新闻卡死整个源。
- RSS 源、post 增加 `category`，抓取时写入 `category`。

## 3. 分类与 Bento

- `NewsCategory`：`tech / world / campus / game`。
- `rss_sources.category` + `posts.category`。
- 迁移：[0019_news_categories](../prisma/migrations/0019_news_categories/migration.sql)。
- 预置源（seed）：
  - 少数派 `https://sspai.com/feed` · tech
  - IT之家 `https://www.ithome.com/rss/` · tech
  - 爱范儿 `https://www.ifanr.com/feed` · tech
  - 机核 `https://www.gcores.com/rss` · game
  - 中新网国际 `https://www.chinanews.com.cn/rss/world.xml` · world
- 前端电文页顶部 Tab：`全部 / 校园 / 科技 / 国际 / 游戏`。
- 官方/大卡与 RSS 小卡继续保持 Bento 错位排列。
- 卡片正文限制最大高度，防止长文撑破 Bento。

## 4. 站内互动

- 详情页保留点赞（认同）与回波（评论）。
- 新增 `POST /belt/posts/:id/share`：
  - 在默认环带频道创建 `Card` + `kind='card'` 消息；
  - 卡片展示新闻标题、摘要与站内链接；
  - 前端显示 `NEWS SHARE` 卡片。
- 详情页长文：
  - 最大宽度 46rem；
  - 字号 15px、行高 1.95；
  - 底部自动生成：
    `[ 本电文源自 {source_name}，点击前往原文 ↗ ]`，链接 `source_url`。

## 5. IoT 设备 API

迁移：[0020_iot_devices](../prisma/migrations/0020_iot_devices/migration.sql)

表：

- `device_bind_codes`：6 位码、user、10 分钟过期、一次性。
- `device_tokens`：MAC、token_hash、last_seen、revoked。

接口：

```http
POST /api/v1/device/bind-code
Authorization: Bearer <user JWT>

{ "code": "483920", "expires_at": "..." }
```

```http
POST /api/v1/device/bind
Content-Type: application/json

{ "code": "483920", "mac": "AA:BB:CC:DD:EE:01", "name": "ESP32 吊牌" }

{ "device_token": "…", "token_type": "Bearer", "expires_in": null }
```

```http
GET /api/v1/device/summary
X-Device-Token: <device_token>
```

```json
{
  "unread_count": 0,
  "has_announcement": true,
  "latest_message": "",
  "avatar_url": "https://…/avatar.jpg?X-Amz-…",
  "status_color": "#FF4B3E"
}
```

状态色优先级：

- 有公告 → `#FF4B3E`
- 有好友 5 分钟在线 → `#00FFFF`
- 仅有未读 → `#FFFA00`
- 其余 → `#9AA093`

## 6. 验证

```text
RSS_INTERACTION_RESULT={"ok":true,"bodyLength":11957,"category":"tech","tabs":5,...}
DEVICE_SUMMARY_RESULT={"ok":true,...}
BODY_LENGTH 11957 CATEGORY tech
TITLE_VISIBLE true
DETAIL_FULLTEXT true
SOURCE_CREDIT true
COMMENT_VISIBLE true
SHARE_CARD_VISIBLE true
```

构建：

```text
server build / typecheck -> exit 0
server tests             -> 18 files / 176 tests passed
web build                -> ✓ Compiled successfully
migrations               -> 20 个全部应用
```

截图：

- [全文电文 Bento + 分类 Tab](../frontend/rss-fulltext-bento-390.png)
- [390px 长文详情](../frontend/rss-fulltext-detail-390.png)
- [站内转发卡片](../frontend/rss-share-card-390.png)

测试 RSS 源、长文帖、分享卡片、device token/bind code 已清理。
