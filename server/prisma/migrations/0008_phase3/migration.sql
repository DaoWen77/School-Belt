-- ============================================================================
-- O.M.V 工作台 · 全域广播 —— 0008_phase3（全服公告单行表）
-- 依据：Phase3 补洞（全服公告）
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0001_init .. 0007_bots 已执行
-- 说明：不写显式 BEGIN/COMMIT —— prisma migrate deploy 对 PostgreSQL 会把每个
--       迁移文件包在一个事务里执行。
-- ============================================================================

CREATE TABLE system_announcements (
  id         text        PRIMARY KEY DEFAULT 'default',
  body       text        NOT NULL,
  level      varchar(16) NOT NULL DEFAULT 'info',
  active     boolean     NOT NULL DEFAULT true,
  updated_by uuid        NULL REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_announcements_singleton_check CHECK (id = 'default'),
  CONSTRAINT system_announcements_body_length_check CHECK (char_length(body) BETWEEN 1 AND 2000),
  CONSTRAINT system_announcements_level_check CHECK (level IN ('info', 'warning', 'critical'))
);

-- 关闭公告时保留 body（active=false），因此 body 始终满足 1..2000；GET 只返回 active=true。
