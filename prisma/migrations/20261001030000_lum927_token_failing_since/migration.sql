-- LUM-927: when the daily access recheck first failed to mint a token for an
-- installation GitHub still reports active. Additive, nullable.
ALTER TABLE "github_app_installations" ADD COLUMN "tokenFailingSince" TIMESTAMP(3);
