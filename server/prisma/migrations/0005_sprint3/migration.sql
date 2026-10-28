-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0005_sprint3（Sprint 3：AI 配置 + 固定 bot 用户）
-- 依据：Sprint3 需求（@Bot SSE 回复 / AI 配置加密）
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0001_init .. 0004_sprint2 已执行
-- 说明：不写显式 BEGIN/COMMIT —— prisma migrate deploy 对 PostgreSQL 会把每个
--       迁移文件包在一个事务里执行。
-- 幂等性：仅可执行一次（prisma migrate deploy 会记录到 _prisma_migrations）。
-- ============================================================================

-- ── 1. users.is_bot（固定 bot 用户标记）───────────────────────────────────
ALTER TABLE users ADD COLUMN is_bot boolean NOT NULL DEFAULT false;

-- ── 2. 固定 bot 用户（UUID 固定；ON CONFLICT 保证重复执行/手工重放安全）──
-- password_hash='!bot' 是占位值，永远无法通过 argon2 校验；该账号不参与登录。
INSERT INTO users (id, handle, display_name, password_hash, global_role, status, is_bot)
VALUES (
  '00000000-0000-4000-8000-0000000000b0',
  'dijiang_bot',
  '工作台·协议官',
  '!bot',
  'member',
  'active',
  true
)
ON CONFLICT DO NOTHING;

-- ── 3. ai_settings：单行 AI 配置表（API Key 只存 AES-256-GCM 密文）──────
CREATE TABLE ai_settings (
  id               text        PRIMARY KEY DEFAULT 'default',
  base_url         text        NULL,
  model            text        NULL,
  api_key_encrypted text       NULL,
  updated_by       uuid        NULL REFERENCES users (id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- 只允许单行：id 必须为 'default'
  CONSTRAINT ai_settings_singleton_check CHECK (id = 'default')
);

-- ── 4. 回滚（手工；prisma migrate deploy 不生成 down）──────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS ai_settings;
-- DELETE FROM users WHERE id = '00000000-0000-4000-8000-0000000000b0' AND is_bot = true;
-- ALTER TABLE users DROP COLUMN IF EXISTS is_bot;
-- COMMIT;
