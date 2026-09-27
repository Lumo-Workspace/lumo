-- LUM-882: record the verifier's GitHub login so the confirmed repository list
-- can be rechecked with the installation token alone. Additive only.
ALTER TABLE "github_app_installations" ADD COLUMN "verifierLogin" TEXT;
ALTER TABLE "github_app_installations" ADD COLUMN "accessRemovedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "github_app_installations" ADD COLUMN "accessRemovedAt" TIMESTAMP(3);
ALTER TABLE "github_app_installations" ADD COLUMN "accessCheckCursor" TEXT;
