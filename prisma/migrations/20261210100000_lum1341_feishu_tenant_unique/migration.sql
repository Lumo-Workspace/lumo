-- LUM-1341 review: one Lumo workspace per Feishu tenant. Replaces the plain
-- index on feishu_integrations."tenantKey" with a unique one. No row is
-- changed or deleted; it only fails if two installs already share a tenant
-- (the table is new in 20261210090000 and unused in production).

-- DropIndex
DROP INDEX "feishu_integrations_tenantKey_idx";

-- CreateIndex
CREATE UNIQUE INDEX "feishu_integrations_tenantKey_key" ON "feishu_integrations"("tenantKey");
