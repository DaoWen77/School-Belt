-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0026_wallet_dm（P0 断头路歼灭）
-- 依据：
--   1) 废弃 Friendship：关注即可私聊（DM 由 channels.dm_key 唯一键 + 成员关系承载）
--   2) 环塔商券：users.balance_cents（初始 5000 分 = 50 券）+ ledger_entries 流水
--   3) 帖子收藏：post_bookmarks
--   4) 校园墙：PostBoard 增加 campus
-- 前置：0025_social 已执行
-- 注意：ALTER TYPE ... ADD VALUE 与后续语句同事务在 PG 12+ 允许（本迁移不使用该新值）。
-- ============================================================================

-- 1) 商券余额
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "balance_cents" integer NOT NULL DEFAULT 5000;
DO $$
BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_balance_cents_check" CHECK ("balance_cents" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) 流水枚举
DO $$
BEGIN
  CREATE TYPE "LedgerKind" AS ENUM ('init', 'daily_login', 'post_reward', 'tip_out', 'tip_in', 'fee', 'admin_adjust');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3) 流水表
CREATE TABLE IF NOT EXISTS "ledger_entries" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "amount_cents" integer NOT NULL,
  "balance_after_cents" integer NOT NULL,
  "kind" "LedgerKind" NOT NULL,
  "ref_type" varchar(24),
  "ref_id" uuid,
  "group_id" uuid NOT NULL,
  "idempotency_key" varchar(120) NOT NULL,
  "memo" varchar(200),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_entries_idempotency_key_key" ON "ledger_entries" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "ledger_entries_user_id_created_at_idx" ON "ledger_entries" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ledger_entries_group_id_idx" ON "ledger_entries" ("group_id");
DO $$
BEGIN
  ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_nonzero" CHECK ("amount_cents" <> 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4) 帖子收藏
CREATE TABLE IF NOT EXISTS "post_bookmarks" (
  "post_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "post_bookmarks_pkey" PRIMARY KEY ("post_id", "user_id"),
  CONSTRAINT "post_bookmarks_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE,
  CONSTRAINT "post_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "post_bookmarks_user_id_created_at_idx" ON "post_bookmarks" ("user_id", "created_at" DESC);

-- 5) 校园墙版块
ALTER TYPE "PostBoard" ADD VALUE IF NOT EXISTS 'campus';

-- 6) 存量用户补一笔初始化流水（幂等：同一个 init:<userId> 只写一次）
INSERT INTO "ledger_entries" ("user_id", "amount_cents", "balance_after_cents", "kind", "group_id", "idempotency_key", "memo")
SELECT u."id", 5000, u."balance_cents", 'init'::"LedgerKind", gen_random_uuid(), 'init:' || u."id"::text, '环塔商券初始赠送 50 券'
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "ledger_entries" l WHERE l."idempotency_key" = 'init:' || u."id"::text);

-- 7) 废弃好友体系
DROP TABLE IF EXISTS "friendships";
DROP TYPE IF EXISTS "FriendshipStatus";
