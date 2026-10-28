-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0025_social（模块一/二）
-- 依据：账户重构（关注 / 个人主页 / 认证标签）＋ EXP 等级 / 风纪委 / 举报工单池
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0024_org_public_join_type 已执行
-- 说明：
--   1. 单个事务：prisma migrate deploy 会把整个文件放进一个事务执行，此处不再显式 BEGIN；
--   2. 枚举用 DO 块包裹，重复执行不报错；建表/索引全部 IF NOT EXISTS；
--   3. reports.target_id 指向 posts / post_comments 之一，多态故不建外键；
--   4. users.exp / level 只增列，不动既有列与派生列触发器；
--   5. tasks / services 只建表，完整委托流程在模块五扩展。
-- ============================================================================

DO $$
BEGIN
  CREATE TYPE "ExpReason" AS ENUM ('post', 'comment', 'like_received', 'task_done', 'daily_login', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ClerkApplicationStatus" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ReportTarget" AS ENUM ('post', 'comment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ReportReason" AS ENUM ('spam', 'harassment', 'porn', 'illegal', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('open', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ModerationVerdict" AS ENUM ('violation', 'clear');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CommissionStatus" AS ENUM ('open', 'in_progress', 'submitted', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ServiceStatus" AS ENUM ('open', 'paused', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ───────────────────────────── users.exp / level ─────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS exp   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE users ADD CONSTRAINT users_exp_non_negative_check CHECK (exp >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE users ADD CONSTRAINT users_level_range_check CHECK (level BETWEEN 0 AND 6);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ───────────────────────────── follows ─────────────────────────────
CREATE TABLE IF NOT EXISTS follows (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  following_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT follows_not_self_check CHECK (follower_id <> following_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS follows_follower_id_following_id_key
  ON follows (follower_id, following_id);
CREATE INDEX IF NOT EXISTS follows_following_id_idx
  ON follows (following_id);

-- ───────────────────────────── exp_logs ─────────────────────────────
CREATE TABLE IF NOT EXISTS exp_logs (
  id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid            NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  delta           integer         NOT NULL,
  reason          "ExpReason"     NOT NULL,
  ref_type        varchar(24)     NULL,
  ref_id          uuid            NULL,
  idempotency_key varchar(120)    NOT NULL,
  created_at      timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT exp_logs_delta_non_zero_check CHECK (delta <> 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS exp_logs_idempotency_key_key
  ON exp_logs (idempotency_key);
CREATE INDEX IF NOT EXISTS exp_logs_user_id_created_at_idx
  ON exp_logs (user_id, created_at);

-- ───────────────────────────── clerk_applications ─────────────────────────────
CREATE TABLE IF NOT EXISTS clerk_applications (
  id                  uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid                      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status              "ClerkApplicationStatus"  NOT NULL DEFAULT 'pending',
  reason              varchar(200)              NOT NULL,
  snapshot_level      integer                   NOT NULL DEFAULT 0,
  snapshot_violations integer                   NOT NULL DEFAULT 0,
  reviewed_by         uuid                      NULL REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at         timestamptz               NULL,
  review_note         varchar(200)              NULL,
  created_at          timestamptz               NOT NULL DEFAULT now(),
  CONSTRAINT clerk_applications_reason_length_check
    CHECK (char_length(reason) BETWEEN 10 AND 200),
  CONSTRAINT clerk_applications_review_note_length_check
    CHECK (review_note IS NULL OR char_length(review_note) <= 200)
);

CREATE INDEX IF NOT EXISTS clerk_applications_status_created_at_idx
  ON clerk_applications (status, created_at);
CREATE INDEX IF NOT EXISTS clerk_applications_user_id_idx
  ON clerk_applications (user_id);

-- ───────────────────────────── reports ─────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id              uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     uuid                 NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_type     "ReportTarget"       NOT NULL,
  target_id       uuid                 NOT NULL,
  subject_user_id uuid                 NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason          "ReportReason"       NOT NULL,
  detail          varchar(500)         NULL,
  status          "ReportStatus"       NOT NULL DEFAULT 'open',
  verdict         "ModerationVerdict"  NULL,
  vote_count      integer              NOT NULL DEFAULT 0,
  double_penalty  boolean              NOT NULL DEFAULT false,
  resolved_by     uuid                 NULL REFERENCES users (id) ON DELETE SET NULL,
  resolved_at     timestamptz          NULL,
  penalty_applied boolean              NOT NULL DEFAULT false,
  created_at      timestamptz          NOT NULL DEFAULT now(),
  CONSTRAINT reports_detail_length_check
    CHECK (detail IS NULL OR char_length(detail) <= 500),
  CONSTRAINT reports_vote_count_non_negative_check CHECK (vote_count >= 0),
  CONSTRAINT reports_not_self_check CHECK (reporter_id <> subject_user_id)
);

CREATE INDEX IF NOT EXISTS reports_status_created_at_idx
  ON reports (status, created_at);
CREATE INDEX IF NOT EXISTS reports_subject_user_id_resolved_at_idx
  ON reports (subject_user_id, resolved_at);
CREATE INDEX IF NOT EXISTS reports_target_type_target_id_idx
  ON reports (target_type, target_id);

-- ───────────────────────────── moderation_votes ─────────────────────────────
CREATE TABLE IF NOT EXISTS moderation_votes (
  id         uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  uuid                 NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  voter_id   uuid                 NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  verdict    "ModerationVerdict"  NOT NULL,
  created_at timestamptz          NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS moderation_votes_report_id_voter_id_key
  ON moderation_votes (report_id, voter_id);

-- ───────────────────────────── tasks（委托） ─────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id          uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  uuid                NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       varchar(120)        NOT NULL,
  description text                NOT NULL,
  price_cents integer             NOT NULL,
  deadline    timestamptz         NULL,
  status      "CommissionStatus"  NOT NULL DEFAULT 'open',
  taker_id    uuid                NULL REFERENCES users (id) ON DELETE SET NULL,
  edited_at   timestamptz         NULL,
  created_at  timestamptz         NOT NULL DEFAULT now(),
  updated_at  timestamptz         NOT NULL DEFAULT now(),
  CONSTRAINT tasks_price_cents_non_negative_check CHECK (price_cents >= 0),
  CONSTRAINT tasks_title_length_check CHECK (char_length(title) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS tasks_creator_id_status_idx
  ON tasks (creator_id, status);
CREATE INDEX IF NOT EXISTS tasks_status_created_at_idx
  ON tasks (status, created_at);

-- ───────────────────────────── services（服务） ─────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       varchar(120)     NOT NULL,
  description text             NOT NULL,
  price_cents integer          NULL,
  status      "ServiceStatus"  NOT NULL DEFAULT 'open',
  created_at  timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT services_price_cents_non_negative_check
    CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT services_title_length_check CHECK (char_length(title) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS services_user_id_status_idx
  ON services (user_id, status);
