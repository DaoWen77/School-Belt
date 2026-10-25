-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0014_rss_news_tower（Phase E / Sprint5）
-- 新闻塔：RSS 源 + 抓取幂等账本；只写 belt/telegraph 的 posts，不碰现有表。
-- 说明：仓库内已有 inet / search_vector 等 Prisma Unsupported 列，
--       `prisma migrate dev` 会被既有 drift 警告阻塞；本迁移显式只建 RSS 表，
--       再用 `prisma migrate deploy` 应用，避免误改/误删既有列。
-- ============================================================================

CREATE TABLE rss_sources (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            varchar(80)  NOT NULL,
  url             varchar(1000) NOT NULL,
  enabled         boolean      NOT NULL DEFAULT true,
  created_by      uuid         NULL REFERENCES users (id) ON DELETE SET NULL,
  last_fetched_at timestamptz  NULL,
  last_item_count integer      NOT NULL DEFAULT 0,
  last_error      text         NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX rss_sources_enabled_updated_idx
  ON rss_sources (enabled, updated_at);

CREATE TABLE rss_items (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid         NOT NULL REFERENCES rss_sources (id) ON DELETE CASCADE,
  external_id  varchar(500) NOT NULL,
  title        varchar(200) NOT NULL,
  link         varchar(1000) NULL,
  published_at timestamptz  NOT NULL,
  post_id      uuid         NULL UNIQUE REFERENCES posts (id) ON DELETE SET NULL,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX rss_items_source_external_key
  ON rss_items (source_id, external_id);
CREATE INDEX rss_items_source_published_idx
  ON rss_items (source_id, published_at DESC);
