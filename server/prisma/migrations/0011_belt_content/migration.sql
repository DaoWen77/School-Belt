-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0011_belt_content（环塔 Phase C）
-- 依据：双面单库方案 C｜环塔壳与内容
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0010_organizations 已执行
-- 说明：
--   1. 扩展 posts 为“朋友圈 + 环塔版块”共用表；
--   2. 现有朋友圈回填 published_at=created_at、source=user、status=published；
--   3. 电文/RSS 的 rss_items 在 Phase E 建，本迁移只留 source/sourceUrl 字段；
--   4. 评论增加软删字段，供外网治理使用。
-- ============================================================================

CREATE TYPE "PostSource"   AS ENUM ('user', 'official', 'rss', 'system');
CREATE TYPE "PostStatus"   AS ENUM ('published', 'hidden', 'removed');
CREATE TYPE "BountyStatus" AS ENUM ('open', 'in_talk', 'closed');

ALTER TABLE posts
  ADD COLUMN title             varchar(120) NULL,
  ADD COLUMN source            "PostSource" NOT NULL DEFAULT 'user',
  ADD COLUMN source_url        varchar(500) NULL,
  ADD COLUMN source_name       varchar(80) NULL,
  ADD COLUMN published_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN pinned_at         timestamptz NULL,
  ADD COLUMN status            "PostStatus" NOT NULL DEFAULT 'published',
  ADD COLUMN moderated_by      uuid NULL,
  ADD COLUMN moderated_at      timestamptz NULL,
  ADD COLUMN moderation_reason varchar(200) NULL,
  ADD COLUMN bounty_status     "BountyStatus" NULL,
  ADD COLUMN bounty_reward     varchar(80) NULL,
  ADD COLUMN bounty_deadline   timestamptz NULL;

UPDATE posts SET published_at = created_at;

ALTER TABLE posts
  ADD CONSTRAINT posts_bounty_board_check
    CHECK (bounty_status IS NULL OR board = 'bounty'),
  ADD CONSTRAINT posts_title_length_check
    CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 120);

CREATE INDEX posts_surface_board_published_idx
  ON posts (surface, board, published_at DESC);

ALTER TABLE post_comments
  ADD COLUMN deleted_at timestamptz NULL,
  ADD COLUMN deleted_by uuid NULL;
