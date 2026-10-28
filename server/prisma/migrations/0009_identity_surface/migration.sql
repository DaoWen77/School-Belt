-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0009_identity_surface（环塔 Phase A）
-- 依据：双面单库方案 A｜身份分面
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0001_init .. 0008_phase3 已执行
-- 说明：
--   1. 本迁移只增加“面”字段、身份标签与派生触发器，不建组织/好友/RSS 表；
--   2. `users.is_internal` 由触发器与 CHECK 双重强制，不能由应用直接写；
--   3. 现有真人账号回填 `[站长]`；机器人保持空标签，避免 Bot 获得内部权限；
--   4. 不写显式 BEGIN/COMMIT —— prisma migrate deploy 会把每个文件包在事务里。
-- ============================================================================

-- ── 1. 枚举 ─────────────────────────────────────────────────────────────────
CREATE TYPE "Surface" AS ENUM ('internal', 'belt');
CREATE TYPE "ChannelSurface" AS ENUM ('internal', 'belt', 'bridge');
CREATE TYPE "PostBoard" AS ENUM ('moments', 'bulletin', 'bounty', 'daily', 'telegraph');

-- ── 2. users：标签、派生内部标记、账号出生面 ────────────────────────────────
ALTER TABLE users
  ADD COLUMN tags          text[]    NOT NULL DEFAULT '{}',
  ADD COLUMN is_internal   boolean   NOT NULL DEFAULT false,
  ADD COLUMN account_origin "Surface" NOT NULL DEFAULT 'internal';

-- `is_internal` 唯一来源：tags 是否包含 `[站长]`。
-- 触发器负责每次 tags 变更时同步；CHECK 负责兜住任何绕过触发器的直接写入。
CREATE OR REPLACE FUNCTION users_sync_internal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_internal := ('[站长]' = ANY(NEW.tags));
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_sync_internal_trg
  BEFORE INSERT OR UPDATE OF tags ON users
  FOR EACH ROW
  EXECUTE FUNCTION users_sync_internal();

-- 存量真人账号全部是工作台内部账号；Bot 不授予内部身份。
UPDATE users
SET tags = ARRAY['[站长]']
WHERE is_bot = false;

ALTER TABLE users
  ADD CONSTRAINT users_internal_tag_check
  CHECK (is_internal = ('[站长]' = ANY(tags)));

CREATE INDEX users_tags_gin_idx       ON users USING GIN (tags);
CREATE INDEX users_is_internal_idx    ON users (is_internal);
CREATE INDEX users_account_origin_idx ON users (account_origin);

-- ── 3. sessions：会话所属面 ─────────────────────────────────────────────────
ALTER TABLE sessions
  ADD COLUMN surface "Surface" NOT NULL DEFAULT 'internal';

CREATE INDEX sessions_user_surface_revoked_idx
  ON sessions (user_id, surface, revoked_at);

-- ── 4. channels：频道所属面 ─────────────────────────────────────────────────
ALTER TABLE channels
  ADD COLUMN surface "ChannelSurface" NOT NULL DEFAULT 'internal';

CREATE INDEX channels_surface_kind_position_idx
  ON channels (surface, kind, position);

-- ── 5. posts：帖子所属面与版块 ──────────────────────────────────────────────
ALTER TABLE posts
  ADD COLUMN surface "Surface"   NOT NULL DEFAULT 'internal',
  ADD COLUMN board   "PostBoard" NOT NULL DEFAULT 'moments';

CREATE INDEX posts_surface_board_created_idx
  ON posts (surface, board, created_at DESC);
