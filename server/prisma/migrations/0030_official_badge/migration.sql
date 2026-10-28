-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0030_official_badge
-- 身份章改名：`[极光科技]` → `[站长]`
--   1. 存量 users.tags 就地替换；
--   2. 重建 0009 建立的触发器函数与 CHECK（新标签合法、旧标签不再合法）；
--   3. 幂等：重复执行不报错。
-- 前置：0029_im 已执行
-- ============================================================================

-- 1) 存量数据（先替换，避免 CHECK 与触发器口径不一致）
UPDATE "users"
SET "tags" = array_replace("tags", '[极光科技]', '[站长]')
WHERE '[极光科技]' = ANY("tags");

-- 2) 触发器函数：is_internal 的唯一来源改为 `[站长]`
CREATE OR REPLACE FUNCTION users_sync_internal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_internal := ('[站长]' = ANY(NEW.tags));
  RETURN NEW;
END;
$$;

-- 3) CHECK 约束：先摘旧的（0009 的 users_internal_tag_check / 过渡期的 users_is_internal_matches_tags）
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_internal_tag_check";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_is_internal_matches_tags";

UPDATE "users" SET "is_internal" = ('[站长]' = ANY("tags"));

ALTER TABLE "users"
  ADD CONSTRAINT "users_internal_tag_check"
  CHECK ("is_internal" = ('[站长]' = ANY("tags")));
