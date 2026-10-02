#!/usr/bin/env bash
#
# Vercel build gate — LUM-682.
#
# Root cause it fixes: prod code was shipping ahead of its migration. A schema
# change (LUM-669 revision column, LUM-678 Initiative reshape) merged and
# deployed, but `prisma migrate deploy` was never part of the pipeline — so the
# new code queried a column/enum that prod's DB didn't have yet → ColumnNotFound
# → 500. Applying the migration was a manual operator step (unsustainable).
#
# This wrapper makes migration application a GATE, ahead of the code that
# depends on it:
#   1. On a production deploy, run `prisma migrate deploy` FIRST.
#   2. Fail-closed: `set -euo pipefail` means any migrate failure aborts the
#      build, so the new code never serves ahead of its schema.
#   3. Re-check with `prisma migrate status`; a still-pending migration is a
#      hard failure (alert), not a silent ship.
#   4. Only then build the app that serves traffic.
#
# Prisma v7 routes migrations through the unpooled URL via prisma.config.ts
# (lib/db/database-url.ts: on production the Neon-managed
# PROD_DATABASE_URL_UNPOOLED, otherwise DATABASE_URL_UNPOOLED ?? DATABASE_URL),
# so `migrate deploy`/`status` use a direct DDL-capable connection
# automatically — no extra wiring here.
#
# Wired via vercel.json "buildCommand" so it is version-controlled and cannot
# drift out of a dashboard setting. Preview/dev builds skip the migrate step
# (we do not auto-apply migrations to non-prod databases from here).

set -euo pipefail

# VERCEL_ENV is "production" | "preview" | "development" on Vercel; unset when
# building elsewhere (e.g. a local `bash scripts/deploy/vercel-build.sh`).
DEPLOY_ENV="${VERCEL_ENV:-}"

if [ "$DEPLOY_ENV" = "production" ]; then
  echo "▶ [migrate-gate] production deploy — applying migrations before build"

  # (1) Apply every pending migration. Fail-closed: a non-zero exit here aborts
  #     the whole build (set -e), so unmigrated schema never gets served.
  npx prisma migrate deploy

  # (2) Belt-and-suspenders drift check. `migrate status` exits non-zero when
  #     migrations remain unapplied — surfaces the "code ahead of schema"
  #     condition as a hard failure instead of a silent ship.
  echo "▶ [migrate-gate] verifying no migrations remain pending"
  npx prisma migrate status
else
  echo "▶ [migrate-gate] VERCEL_ENV='${DEPLOY_ENV:-unset}' (not production) — skipping migrate deploy"
fi

# (3) Build the app that serves traffic. Runs only after migrations are applied
#     and verified on production.
echo "▶ [migrate-gate] building app"
npm run build
