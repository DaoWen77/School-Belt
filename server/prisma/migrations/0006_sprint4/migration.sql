-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0006_sprint4（Sprint 4：朋友圈 Posts/Likes/Comments）
-- 依据：Sprint4 需求（发帖 / 点赞 / 评论；软删）
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0001_init .. 0005_sprint3 已执行
-- 说明：不写显式 BEGIN/COMMIT —— prisma migrate deploy 对 PostgreSQL 会把每个
--       迁移文件包在一个事务里执行。
-- 幂等性：仅可执行一次（prisma migrate deploy 会记录到 _prisma_migrations）。
-- ============================================================================

-- ── 1. posts：朋友圈动态（软删；file_ids 为 JSON 数组）─────────────────────
CREATE TABLE posts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       text        NOT NULL,
  file_ids   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT posts_body_length_check CHECK (char_length(body) BETWEEN 1 AND 4000)
);

CREATE INDEX posts_created_at_idx ON posts (created_at DESC);
CREATE INDEX posts_author_id_idx ON posts (author_id, created_at DESC);

-- ── 2. post_likes：点赞（幂等唯一键）─────────────────────────────────────
CREATE TABLE post_likes (
  post_id    uuid        NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX post_likes_user_id_idx ON post_likes (user_id);

-- ── 3. post_comments：评论（含作者，按时间正序展示）───────────────────────
CREATE TABLE post_comments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid        NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  author_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_comments_body_length_check CHECK (char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX post_comments_post_created_idx ON post_comments (post_id, created_at);

-- ── 4. 回滚（手工；prisma migrate deploy 不生成 down）──────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS post_comments, post_likes, posts;
-- COMMIT;
