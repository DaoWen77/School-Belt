-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0028_escrow（模块五：委托交易 / 托管资金）
-- 依据：委托申请、单接单人、5% 平台抽成、托管资金冻结 → 打款 / 退款
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0027_bonds 已执行
-- 说明：
--   1. 枚举用 DO 块包裹、建表/索引全部 IF NOT EXISTS，可重复执行；
--   2. LedgerKind 新增值放在迁移前部，且本迁移不插入这些值（PG 同事务内不可用新枚举值）；
--   3. 资金恒等式：Σ users.balance_cents + Σ escrows(held).amount_cents = 系统总量；
--   4. 余额变动只在 service 层 prisma.withTransaction 内进行，本迁移不写业务流水。
-- ============================================================================

-- ── 1. 流水种类：委托冻结 / 打款 / 退款 ─────────────────────────────────────
ALTER TYPE "LedgerKind" ADD VALUE IF NOT EXISTS 'task_escrow';
ALTER TYPE "LedgerKind" ADD VALUE IF NOT EXISTS 'task_payout';
ALTER TYPE "LedgerKind" ADD VALUE IF NOT EXISTS 'task_refund';

-- ── 2. 申请状态 / 托管状态 ─────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE "TaskApplicationStatus" AS ENUM ('pending', 'selected', 'rejected', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "EscrowState" AS ENUM ('held', 'released', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. task_applications（委托申请；一人一任务只能申请一次）─────────────────
CREATE TABLE IF NOT EXISTS task_applications (
  id           uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid                     NOT NULL REFERENCES tasks (id) ON DELETE CASCADE ON UPDATE CASCADE,
  applicant_id uuid                     NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  message      varchar(500)             NULL,
  status       "TaskApplicationStatus"  NOT NULL DEFAULT 'pending',
  created_at   timestamptz(6)           NOT NULL DEFAULT now(),
  CONSTRAINT task_applications_task_id_applicant_id_key UNIQUE (task_id, applicant_id)
);

CREATE INDEX IF NOT EXISTS task_applications_task_id_status_idx
  ON task_applications (task_id, status);

CREATE INDEX IF NOT EXISTS task_applications_applicant_id_created_at_idx
  ON task_applications (applicant_id, created_at DESC);

-- ── 4. tasks.accepted_application_id（无双向关系的普通列 + FK）──────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS accepted_application_id uuid NULL;

DO $$
BEGIN
  ALTER TABLE tasks
    ADD CONSTRAINT tasks_accepted_application_id_fkey
    FOREIGN KEY (accepted_application_id) REFERENCES task_applications (id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. escrows（一任务一托管；金额与手续费在冻结时固化）─────────────────────
CREATE TABLE IF NOT EXISTS escrows (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid          NOT NULL UNIQUE REFERENCES tasks (id) ON DELETE CASCADE ON UPDATE CASCADE,
  amount_cents integer       NOT NULL,
  fee_cents    integer       NOT NULL,
  state        "EscrowState" NOT NULL DEFAULT 'held',
  held_at      timestamptz(6) NOT NULL DEFAULT now(),
  settled_at   timestamptz(6) NULL,
  CONSTRAINT escrows_amount_cents_positive_check CHECK (amount_cents > 0),
  CONSTRAINT escrows_fee_cents_non_negative_check CHECK (fee_cents >= 0)
);

CREATE INDEX IF NOT EXISTS escrows_state_idx ON escrows (state);

-- ── 6. 平台金库账号（模块五的 5% 手续费唯一去向）───────────────────────────
-- 说明：
--   * handle 为 citext 唯一；password_hash 用不可解哈希 `$disabled$`，该账号永不可登录；
--   * is_internal 由 0009 触发器从 tags 派生，故 tags 必须为空数组；
--   * users.balance_cents 默认 5000，金库属系统账号，必须置 0（不补 init 流水：
--     金库余额只由 task fee 流水累积，init 流水会污染对账口径）；
--   * account_origin=internal：系统账号不属于环带自助注册。
INSERT INTO users (handle, display_name, password_hash, global_role, status, tags, is_internal, account_origin, is_bot)
VALUES ('platform_treasury', '环塔金库', '$disabled$', 'member', 'active', '{}', false, 'internal', true)
ON CONFLICT (handle) DO NOTHING;

-- 仅对「尚无流水」的金库归零：迁移重放时不清空已累积的手续费。
UPDATE users SET balance_cents = 0
WHERE handle = 'platform_treasury'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE ledger_entries.user_id = users.id);
