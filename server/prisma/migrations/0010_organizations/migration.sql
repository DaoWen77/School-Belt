-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0010_organizations（文明环带 Phase B）
-- 依据：双面单库方案 B｜组织与证章
-- 目标库：PostgreSQL 16（本机 embedded PG 17.5）
-- 前置：0009_identity_surface 已执行
-- 说明：
--   1. 组织只对内部账号开放；审批通过前不创建频道、不产生组织前缀；
--   2. 一个 owner 只能有一个 pending/active 组织；
--   3. 一个用户同时只能有一个 active 组织成员行（前缀唯一）；
--   4. 组织频道必须是 internal + private；全站 Owner 不是成员时也读不到。
-- ============================================================================

CREATE TYPE "OrgStatus"       AS ENUM ('pending', 'active', 'rejected', 'suspended', 'dissolved');
CREATE TYPE "OrgMemberRole"   AS ENUM ('owner', 'admin', 'member');
CREATE TYPE "OrgMemberStatus" AS ENUM ('pending', 'invited', 'active', 'left', 'rejected', 'banned');

-- ── 1. organizations ────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          citext      NOT NULL,
  slug          citext      NOT NULL UNIQUE,
  summary       varchar(400) NOT NULL,
  status        "OrgStatus" NOT NULL DEFAULT 'pending',
  owner_id      uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  logo_file_id  uuid        NULL,
  reviewed_by   uuid        NULL REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at   timestamptz NULL,
  reject_reason varchar(200) NULL,
  dissolved_at  timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_name_length_check CHECK (char_length(name::text) BETWEEN 2 AND 24),
  CONSTRAINT organizations_summary_length_check CHECK (char_length(summary) BETWEEN 1 AND 400)
);

-- 同一 owner 只能有一个待审/在册组织；拒绝/解散后可以重新申请。
CREATE UNIQUE INDEX organizations_owner_pending_active_key
  ON organizations (owner_id)
  WHERE status IN ('pending', 'active');

-- 名称唯一性只覆盖仍占用名字的状态；拒绝/解散后允许重新申请同名组织。
CREATE UNIQUE INDEX organizations_name_pending_active_key
  ON organizations (name)
  WHERE status IN ('pending', 'active', 'suspended');

CREATE INDEX organizations_status_idx ON organizations (status);
CREATE INDEX organizations_owner_status_idx ON organizations (owner_id, status);

-- ── 2. organization_members ─────────────────────────────────────────────────
CREATE TABLE organization_members (
  id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid              NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid              NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            "OrgMemberRole"   NOT NULL DEFAULT 'member',
  status          "OrgMemberStatus" NOT NULL DEFAULT 'pending',
  request_note    varchar(200)      NULL,
  invited_by      uuid              NULL REFERENCES users (id) ON DELETE SET NULL,
  reviewed_by     uuid              NULL REFERENCES users (id) ON DELETE SET NULL,
  requested_at    timestamptz       NOT NULL DEFAULT now(),
  reviewed_at     timestamptz       NULL,
  joined_at       timestamptz       NULL,
  left_at         timestamptz       NULL,
  CONSTRAINT organization_members_request_note_length_check
    CHECK (request_note IS NULL OR char_length(request_note) <= 200)
);

CREATE UNIQUE INDEX organization_members_org_user_key
  ON organization_members (organization_id, user_id);

-- 一个用户同时只能在一个组织里；否则 [组织名] 前缀会打架。
CREATE UNIQUE INDEX organization_members_user_active_key
  ON organization_members (user_id)
  WHERE status = 'active';

CREATE INDEX organization_members_org_status_idx
  ON organization_members (organization_id, status);
CREATE INDEX organization_members_user_status_idx
  ON organization_members (user_id, status);

-- ── 3. channels.organization_id ─────────────────────────────────────────────
ALTER TABLE channels
  ADD COLUMN organization_id uuid NULL REFERENCES organizations (id) ON DELETE RESTRICT;

CREATE INDEX channels_organization_id_idx ON channels (organization_id);

-- 组织频道只能是内部私密频道；防止以后误建环带组织频道。
ALTER TABLE channels
  ADD CONSTRAINT channels_organization_private_check
  CHECK (organization_id IS NULL OR (surface = 'internal' AND visibility = 'private'));
