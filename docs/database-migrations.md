# Database migrations: destructive changes ship in two phases

Production applies migrations in the deploy gate (`scripts/deploy/vercel-build.sh`): `prisma migrate deploy` runs at the **start** of the production build, while the **previous** deployment is still serving traffic. Every migration therefore has to be compatible with two versions of the code at once — the one being built and the one still live. Additive changes (new table, new nullable column, new enum value) are. Destructive ones are not.

**Incident (2026-10-12, #1397 / LUM-1083):** the migration dropped `tasks.initiativeId`. The previous deployment still mapped `Task.initiativeId`, and Prisma selects every scalar column of a model by default, so every task query failed with a missing-column error — task APIs returned 500 for about 3–4 minutes until the new build went Ready.

## The rule: expand, then contract

Removing or renaming a column, table, enum type or enum value takes **two releases**:

1. **Expand release** — the code stops reading and writing it. No destructive SQL.
   - Column: delete the field from `schema.prisma`, or keep it as `@ignore` (Prisma leaves it out of every query). A required column without a default must first become nullable (`ALTER COLUMN … DROP NOT NULL`, an additive change), or inserts from the new code fail.
   - Table: delete the model or mark it `@@ignore`, and remove the relation fields that point at it.
   - Enum value: stop writing it and remove it from the Prisma enum.
   - Prefer `@ignore` / `@@ignore`: the schema still matches the database, so no migration is generated. If you delete the field instead, `prisma migrate dev` generates the drop right away (here and in every later PR until the contract release lands): use `prisma migrate dev --create-only` and keep only the non-destructive part.
2. **Wait** until the expand release is deployed to production (its Vercel deploy is Ready), not just merged.
3. **Contract release** — a later PR adds the migration that drops it. Its `migration.sql` carries the marker comment (put it at the top):

   ```sql
   -- lumo:contract-phase <reason, e.g. expand shipped in #1400>
   ALTER TABLE "tasks" DROP COLUMN "initiativeId";
   ```

   Say in the PR description that the migration deletes data, and which columns or tables it drops.

A rename is a removal plus an addition: add the new column, write both (or backfill), switch reads, and drop the old one in a contract release.

## The guard

`scripts/migrations/destructive-guard.ts` enforces the rule:

- **Base-schema check** (`npm run migrations:check`, and automatically on pre-commit through lint-staged when a `prisma/migrations/**/migration.sql` is staged): for every migration that is not yet on `origin/main` (the code production is serving), each `DROP COLUMN`, `DROP TABLE`, `RENAME COLUMN`, `RENAME TO`, `DROP TYPE`, enum value rename, and enum recreate that removes values (Prisma's `CREATE TYPE "X_new"` pattern) must target something that `origin/main`'s `schema.prisma` no longer maps, or maps only as `@ignore` / `@@ignore`. Otherwise the commit is blocked. Run `git fetch origin` first; a stale `origin/main` makes the check judge against old code. If the base ref can't be read the check fails closed; pass `--base <ref>` to compare against another ref.
- **Marker check** (jest, `__tests__/scripts/destructive-migration-guard.test.ts`): every migration with such SQL must carry `-- lumo:contract-phase <reason>`. Migrations that predate the rule are frozen in `scripts/migrations/destructive-baseline.json`. Never add to that list.

Out of scope: data-only deletes (`DELETE`, `TRUNCATE`), and tightening constraints (`SET NOT NULL`, a new unique index) that old code may violate. Review those by hand under the same expand/contract reasoning.

## Rollbacks

A contract migration is a one-way door. After it is deployed, a Vercel **Instant Rollback** to any deployment from before the expand release brings back code that reads the dropped column, and that code returns 500. Rolling back to the expand release itself (or later) is safe; that is the second reason for the wait in step 2. If you need older code after a contract release, revert the change on `main` and redeploy instead of using Instant Rollback.

## Why not run destructive migrations after promote instead

We evaluated moving destructive migrations to after the new deployment is promoted, and did not do it:

- Vercel's build has no post-promote hook. The only triggers are deployment webhooks (`deployment.succeeded` / `deployment.promoted`) or a GitHub `deployment_status` workflow. The webhook would need a route that runs DDL from a serverless function within its time limit and retries safely. A workflow would need production database credentials in CI.
- `prisma migrate deploy` applies every pending migration in order and cannot skip one. Splitting "safe before build" from "destructive after promote" needs two migration sets or hand-run SQL, outside Prisma's history.
- It still would not protect Instant Rollback: the dropped column is gone for every older deployment either way.

The two-phase rule closes both gaps with no change to the deploy chain.
