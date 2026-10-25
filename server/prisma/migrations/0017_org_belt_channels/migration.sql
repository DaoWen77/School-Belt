-- ============================================================================
-- O.M.V 帝江号 · 全域广播 —— 0017_org_belt_channels（Sprint 7.1）
-- 允许 surface=belt 的组织私密频道；仍禁止组织频道使用 bridge 或公开可见性。
-- ============================================================================

ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS channels_organization_private_check;

ALTER TABLE channels
  ADD CONSTRAINT channels_organization_private_check
  CHECK (
    organization_id IS NULL
    OR (surface IN ('internal', 'belt') AND visibility = 'private')
  );
