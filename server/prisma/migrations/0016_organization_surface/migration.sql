-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0016_organization_surface（Sprint 7.1）
-- 让组织支持内部 / 环带两种面；外部组织私密频道继承 surface=belt。
-- 历史组织默认 internal，不改变既有行为。
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN surface "ChannelSurface" NOT NULL DEFAULT 'internal';

CREATE INDEX organizations_surface_status_idx
  ON organizations (surface, status);
