-- LUM-1070: Better Auth rate-limit counters in the database (shared by every
-- instance) instead of process memory. Additive: one new table, no existing
-- table or row is touched. Only AUTH_PROVIDER=better-auth deployments write it.

CREATE TABLE "auth_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits"("key");

CREATE INDEX "auth_rate_limits_lastRequest_idx" ON "auth_rate_limits"("lastRequest");
