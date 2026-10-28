-- 组织公开性与加入方式（环塔）
CREATE TYPE "OrgJoinType" AS ENUM ('open', 'apply', 'invite');

ALTER TABLE "organizations" ADD COLUMN "is_public" boolean NOT NULL DEFAULT true;
ALTER TABLE "organizations" ADD COLUMN "join_type" "OrgJoinType" NOT NULL DEFAULT 'apply';

CREATE INDEX "organizations_is_public_status_idx" ON "organizations" ("is_public", "status");
