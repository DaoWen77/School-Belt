-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0027_bonds（模块三：羁绊 / 火花）
-- 依据：亲密关系（死党 / 大佬 / 搭档 / 搭子）＋ 每日续火花懒结算
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0026_wallet_dm 已执行
-- 说明：
--   1. 枚举用 DO 块包裹、建表/索引全部 IF NOT EXISTS，可重复执行；
--   2. 规范序：user_a_id < user_b_id（uuid 字符串升序），唯一键 (a, b, type)；
--   3. 亲密度只在 active 状态按日结算，CHECK 兜住 0..100 与 a <> b；
--   4. 不建触发器：结算逻辑在 src/bond/bond-math.ts（纯函数）+ service 懒结算。
-- ============================================================================

DO $$
BEGIN
  CREATE TYPE "BondType" AS ENUM ('buddy', 'mentor', 'partner', 'pal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "BondStatus" AS ENUM ('pending', 'active', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ───────────────────────────── bonds（羁绊） ─────────────────────────────
CREATE TABLE IF NOT EXISTS bonds (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  type            "BondType"   NOT NULL,
  status          "BondStatus" NOT NULL DEFAULT 'pending',
  user_a_id       uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_b_id       uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  inviter_id      uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  intimacy        integer      NOT NULL DEFAULT 10,
  last_renew_a    date         NULL,
  last_renew_b    date         NULL,
  last_settled_on date         NULL,
  created_at      timestamptz(6) NOT NULL DEFAULT now(),
  ended_at        timestamptz(6) NULL,
  end_reason      varchar(40)  NULL,
  CONSTRAINT bonds_intimacy_check CHECK (intimacy >= 0 AND intimacy <= 100),
  CONSTRAINT bonds_users_order_check CHECK (user_a_id <> user_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS bonds_user_a_id_user_b_id_type_key
  ON bonds (user_a_id, user_b_id, type);

CREATE INDEX IF NOT EXISTS bonds_status_last_settled_on_idx
  ON bonds (status, last_settled_on);

CREATE INDEX IF NOT EXISTS bonds_user_b_id_idx
  ON bonds (user_b_id);
