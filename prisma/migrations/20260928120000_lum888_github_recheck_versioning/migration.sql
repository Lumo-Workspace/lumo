-- LUM-888: version the access recheck by verification (not by login), follow
-- the verifier by immutable GitHub user id, rotate the daily sweep by last
-- recheck time, and say why repositories were removed. Additive only.
ALTER TABLE "github_app_installations" ADD COLUMN "verifierGithubId" INTEGER;
ALTER TABLE "github_app_installations" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "github_app_installations" ADD COLUMN "accessCheckedAt" TIMESTAMP(3);
ALTER TABLE "github_app_installations" ADD COLUMN "accessRemovedReason" TEXT;

-- Rows verified since LUM-882 get a verification version so the recheck keeps
-- running on them; rows with no verifier stay out until an owner re-verifies.
UPDATE "github_app_installations"
SET "verifiedAt" = "updatedAt"
WHERE "verifierLogin" IS NOT NULL AND "verifiedAt" IS NULL;
