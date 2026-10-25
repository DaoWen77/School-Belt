-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0004_sprint2（Sprint 2：music/chart 卡片 + 贴纸）
-- 依据：Sprint2 需求（卡片新类型、个人贴纸库）
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0001_init、0002_conversations、0003_v2_sprint1 已执行
-- 说明：不写显式 BEGIN/COMMIT —— prisma migrate deploy 对 PostgreSQL 会把每个
--       迁移文件包在一个事务里执行；ALTER TYPE ADD VALUE 在 PG12+ 允许出现在
--       事务中（只要本事务内不使用新值），本文件只加枚举值、不写该类型的行。
-- 幂等性：仅可执行一次（prisma migrate deploy 会记录到 _prisma_migrations）。
-- ============================================================================

-- ── 1. CardKind 追加 music / chart（Sprint2 卡片类型）──────────────────────
ALTER TYPE "CardKind" ADD VALUE IF NOT EXISTS 'music';
ALTER TYPE "CardKind" ADD VALUE IF NOT EXISTS 'chart';

-- ── 2. 个人贴纸库 ────────────────────────────────────────────────────────
CREATE TABLE stickers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL,
  file_id    uuid        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  name       varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stickers_owner_file_key UNIQUE (owner_id, file_id)
);

CREATE INDEX stickers_owner_id_idx ON stickers (owner_id);
-- 按 createdAt desc 列自己的贴纸
CREATE INDEX stickers_owner_created_idx ON stickers (owner_id, created_at DESC);

-- ── 3. 回滚（手工；prisma migrate deploy 不生成 down）──────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS stickers;
-- 注意：PostgreSQL 不支持 DROP VALUE；如需回退 0004 的枚举值，必须重建 "CardKind" 类型。
-- COMMIT;
