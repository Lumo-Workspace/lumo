-- LUM-1071: Better Auth admin plugin fields (better-auth 1.7.7,
-- node_modules/better-auth/dist/plugins/admin/schema.mjs) — ban / unban /
-- remove for the Clerk → Better Auth migration (RFC LUM-1069 §5).
-- Additive only: four nullable columns on auth_users, one on auth_sessions.
-- Nothing is rewritten; Clerk mode never reads these tables.

ALTER TABLE "auth_users" ADD COLUMN "role" TEXT;
ALTER TABLE "auth_users" ADD COLUMN "banned" BOOLEAN DEFAULT false;
ALTER TABLE "auth_users" ADD COLUMN "banReason" TEXT;
ALTER TABLE "auth_users" ADD COLUMN "banExpires" TIMESTAMP(3);

ALTER TABLE "auth_sessions" ADD COLUMN "impersonatedBy" TEXT;
