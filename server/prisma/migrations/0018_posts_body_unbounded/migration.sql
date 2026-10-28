-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0018_posts_body_unbounded
-- 移除 0006 留下的 posts.body 4000 字 CHECK；全文 RSS 需要更长正文。
-- 只删约束，不改列类型（body 已是 text）。
-- ============================================================================

ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_body_length_check";
