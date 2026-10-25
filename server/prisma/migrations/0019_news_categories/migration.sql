-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0019_news_categories
-- 新闻塔分类 + 校园热议晋升字段。
-- posts.body 长度约束已在 0018 删除；本迁移不再触碰 body。
-- ============================================================================

CREATE TYPE "NewsCategory" AS ENUM ('tech', 'world', 'campus', 'game');
CREATE TYPE "PromotionKind" AS ENUM ('auto', 'manual');

ALTER TABLE rss_sources
  ADD COLUMN category "NewsCategory" NOT NULL DEFAULT 'tech';

ALTER TABLE posts
  ADD COLUMN category "NewsCategory" NULL,
  ADD COLUMN mirrored_from_post_id uuid NULL,
  ADD COLUMN promotion_kind "PromotionKind" NULL,
  ADD COLUMN promoted_by uuid NULL,
  ADD COLUMN promoted_at timestamptz NULL;

CREATE UNIQUE INDEX posts_mirrored_from_post_id_key
  ON posts (mirrored_from_post_id)
  WHERE mirrored_from_post_id IS NOT NULL;

CREATE INDEX posts_surface_board_category_published_idx
  ON posts (surface, board, category, published_at DESC);
