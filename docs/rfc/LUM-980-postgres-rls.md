# RFC LUM-980 — Postgres RLS as defense-in-depth for tenant isolation

Status: **design only, awaiting the user's go/no-go ruling** (`lumo task decide LUM-980`).
Verified against `origin/main` @ `0e89c1f87` (2026-10-04). Nothing in this RFC was run against any database; every DB-side fact below is either read from repo code/config or marked _unconfirmed_.

## 1. Current state (verified)

| Fact                                                                                                                                                                   | Evidence                                                                                                                                                                                                                 | Confidence                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| No RLS anywhere: no `ENABLE/FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, `CREATE ROLE` or `GRANT` in any of the 262 migrations                                          | `grep` over `prisma/migrations`                                                                                                                                                                                          | confirmed                                                                                                           |
| One runtime Prisma client: `PrismaPg` driver adapter (node-postgres pool) on the **pooled** URL, wrapped by the LUM-918 soft-delete `$extends`                         | `lib/db/prisma.ts`                                                                                                                                                                                                       | confirmed                                                                                                           |
| Pooled vs direct: runtime uses `resolveDatabaseUrl('pooled')` (prod: Neon-managed `PROD_DATABASE_URL`); migrations use `'direct'` (prod: `PROD_DATABASE_URL_UNPOOLED`) | `lib/db/database-url.ts`, `prisma.config.ts`                                                                                                                                                                             | confirmed                                                                                                           |
| Pooler is Neon PgBouncer in **transaction mode** (`-pooler` host); session `SET` is not supported there                                                                | `.env.example`, Neon docs "Connection pooling"                                                                                                                                                                           | confirmed (docs)                                                                                                    |
| Prod migrations: `prisma migrate deploy` + `migrate status` run by `scripts/deploy/vercel-build.sh` on `VERCEL_ENV=production`, over the direct URL                    | build script, `vercel.json` `buildCommand`                                                                                                                                                                               | confirmed                                                                                                           |
| Dev: pooled and direct URLs both log in as `neondb_owner`                                                                                                              | user part of `.env.local` / `.env` URLs (no secrets read)                                                                                                                                                                | confirmed (dev only)                                                                                                |
| Prod: same role for both URLs and that role owns every table                                                                                                           | Neon's Vercel integration issues one role for both URLs; tables are created by migrations over the direct URL, so their owner is that role                                                                               | **inferred, unconfirmed**                                                                                           |
| Whether the prod role has an effective `BYPASSRLS`                                                                                                                     | Neon docs: console/API roles get `neon_superuser` membership, which carries `BYPASSRLS` (projects after 2023-08-15). Plain Postgres never inherits role attributes through membership, so the effective value is unclear | **unconfirmed — needs `select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user` on prod** |
| Second client: `mcp/db.ts` builds its own client from `DATABASE_URL`                                                                                                   | `mcp/db.ts`                                                                                                                                                                                                              | confirmed                                                                                                           |
| `agent-server` is not in this repo (only referenced from `shared/` docs)                                                                                               | `ls`, grep                                                                                                                                                                                                               | confirmed; its DB access is out of scope here                                                                       |
| Raw SQL exists (pgvector, pg_trgm search, sprint, auto-block): 4 repositories                                                                                          | `lib/repositories/{memory,task,sprint,auto-block}.repository.ts`                                                                                                                                                         | confirmed                                                                                                           |
| Precedent: `set_config('pg_trgm…', …, true)` inside an array `$transaction` is already used safely on the pooler                                                       | `task.repository.ts:925`                                                                                                                                                                                                 | confirmed                                                                                                           |

Consequence: **today RLS would be a no-op even if policies existed**, because the app connects as the table owner (owners skip RLS unless `FORCE`), and possibly as a `BYPASSRLS` role (which skips even `FORCE`).

Schema numbers (re-verified; the brief's 116/51 is stale): **101 models; 50 with a required `workspaceId`; 2 with a nullable one** (`DocumentTemplate`, `McpAuditLog` — global rows); **49 without**. The hottest table, **`Task`, is transitively scoped** (`projectId → Project.workspaceId`), as are `Comment`, `TaskActivity`, `Sprint`, `Milestone`, `BoundaryCrossing`, `PrSecurityFinding`, `TestCase*`, `ApiKey`, etc.

## 2. Mechanism

### 2.1 Setting the tenant per transaction

```sql
BEGIN;
SELECT set_config('app.workspace_id', $1, true);   -- is_local = true ≡ SET LOCAL
<query>;
COMMIT;
```

- `is_local = true` is mandatory. On a transaction-mode pooler the server connection is handed to another lambda after `COMMIT`; a session-level setting would **leak one tenant's id into another tenant's request** — strictly worse than no RLS. A lint/unit test must forbid `set_config('app.%', …, false)` and `SET app.`.
- Missing setting: `current_setting('app.workspace_id', true)` returns `NULL` (never set on that backend) or `''` (set earlier in the session, transaction ended). Both compare false against a non-empty `workspaceId` → **zero rows, fail-closed**. No `::uuid` cast (ids are cuid text), so `''` cannot raise.

### 2.2 Where the workspace id comes from

It must come from the **authenticated identity**, not from query arguments — otherwise RLS just re-checks the same value the buggy code passed, and adds nothing over LUM-979. Chokepoint: `requireIdentity` (`lib/auth/identity.ts`, ~150 route files) already resolves `Identity.workspaceId` (bearer key's workspace, or the LUM-987 active workspace). Proposal: it stores the id in an `AsyncLocalStorage` request context (`lib/db/tenant-context.ts`), which the RLS extension reads. Routes using the older load-then-authorize helper (`requireWorkspaceMember(resource.workspaceId, …)`, 25 files) must resolve the active workspace _before_ loading the resource — a behavioural change to audit per route.

### 2.3 Wiring in Prisma (and cost)

Prisma has no connection-level hook; the only way to run `set_config` on the same connection as the query is a transaction. Options:

| Option                                                | How                                                                                                                                                                  | Extra round-trips                                                | Problems                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Per-query batch tx** (Prisma's official example) | `$extends({ query: { $allModels: { $allOperations } } })` → `base.$transaction([set_config, query(args)])`                                                           | **+3 per query** (BEGIN, set_config, COMMIT; 4 RTT instead of 1) | Calls made _inside_ an existing interactive tx would open a second tx on another connection (breaks atomicity, setting not applied). Prisma marks it "not production-ready" for this reason                                                                                 |
| **B. Per unit-of-work interactive tx**                | `withTenant(fn)` opens one `$transaction(async tx => { set_config; return fn(tx) })`; `runInTransaction` sets it at tx start                                         | **+3 per unit of work** (BEGIN, set_config, COMMIT)              | Holds a pooled server connection for the whole callback; must never wrap a request that awaits an LLM / GitHub / Slack call (pool exhaustion). Nested interactive tx unsupported → all 40 `$transaction(async …)` sites + `runInTransaction` (8 callers) must thread the tx |
| C. Adapter-level                                      | Wrap the `PrismaPg` driver adapter: on tx start send `BEGIN; SELECT set_config(…)` as one simple-protocol statement (id validated against `^[a-z0-9]+$` and inlined) | +2 per tx                                                        | Relies on adapter internals (`SqlDriverAdapter`); upgrade risk on every Prisma bump                                                                                                                                                                                         |

Reasoned latency (no measurement yet): with Vercel and Neon in the same AWS region, one RTT through the pooler is ~1–3 ms. A task-list request issues ~5–8 queries (bearer lookup, member lookup, data, counts): Option A ≈ +15–24 RTT ≈ **+20–60 ms p50**; Option B ≈ +3 RTT ≈ **+3–9 ms** per unit of work. Option B is the only one with an acceptable hot-path cost, at the price of a non-trivial refactor of transaction call sites.

### 2.4 Composition with LUM-979 (not merged; read from its decisions/worktree only)

LUM-979's `scopedPrisma` is a pure in-process argument check (zero round-trips) over the 50 directly-scoped models, with `unscoped('reason')` as the escape hatch; in production it only **logs**. Its stated gaps are: transitively-scoped models (Task), nested relation reads/writes, raw SQL, a `tx` from the plain client, and log-only in prod. RLS would sit **below** it — `scopedPrisma` (arg check) → RLS extension (tenant tx) → soft-delete → base client — and covers exactly those gaps. The escape hatches should be one concept: `unscoped('reason')` returns a client that also skips the RLS wrapper / uses the system role (§4), so there is one greppable bypass, not two.

### 2.5 Making RLS actually apply: owner vs. a non-owner role

| Role model                                                                                                                                                                 | Fail-closed for unwrapped code?                                | Ops cost on Neon/Vercel                                                                                                                                                                                                                      | Rollback                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **R1. Owner + `FORCE ROW LEVEL SECURITY`**                                                                                                                                 | Yes, _if_ the owner has no effective `BYPASSRLS` (unconfirmed) | None                                                                                                                                                                                                                                         | Migration `NO FORCE`                            |
| **R2. Owner connects; RLS tx does `SET LOCAL ROLE lumo_rls`** (a NOLOGIN role created by SQL, granted DML, with `GRANT lumo_rls TO <owner>` so the owner may switch to it) | **No** — anything not wrapped runs as owner and bypasses       | None (Neon-managed creds unchanged); `SET LOCAL ROLE` is tx-scoped, pooler-safe                                                                                                                                                              | Flag off → instant                              |
| **R3. Dedicated LOGIN role `lumo_app`** (SQL-created, so no `neon_superuser`/`BYPASSRLS`), runtime URL uses it; owner keeps migrations + system jobs                       | **Yes** — default deny everywhere                              | New secret _not_ managed/rotated by the Neon–Vercel integration (undoes part of LUM-931's "no hand-copied URL"); `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner` so tables from future migrations are granted; a migration-time grant check | Repoint `PROD_DATABASE_URL` to owner + redeploy |

R1's viability hinges on the unconfirmed `rolbypassrls` fact; even if viable, the owner can `DISABLE` RLS itself, so it protects against app bugs but not a compromised connection. R2 is the cheap, reversible **prototype** model. R3 is the only true fail-closed **end state**.

## 3. Policies

Directly scoped (50 tables), one policy per table, generated by a script from the schema list LUM-979 already maintains:

```sql
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Project"
  USING      ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
```

`WITH CHECK` also stops writes into another tenant. Nullable-scope tables (`DocumentTemplate`, `McpAuditLog`): `USING ("workspaceId" IS NULL OR "workspaceId" = …)` for reads, `WITH CHECK` strict. `Workspace` itself: `id = current_setting(…)`.

Transitively scoped (49): either an `EXISTS` policy, e.g. `Task: EXISTS (SELECT 1 FROM "Project" p WHERE p.id = "Task"."projectId" AND p."workspaceId" = current_setting(…))` (a per-row index probe — must be measured on Task lists), or **denormalise `workspaceId` onto `Task`** (+ backfill, NOT NULL) and give it a direct policy. Denormalising also brings Task under LUM-979's checker; it is a schema change, hence a ruling. Child-of-child tables (`TaskTag`, `TestCaseRun`, …) chain through their parent's policy and are left for a later phase.

Visible side effects to expect: a filtered `include` of a required relation makes Prisma throw "inconsistent query result" (loud — good); unique/FK violations still reveal existence across tenants (known RLS side channel; acceptable).

## 4. Bypass paths

Rule: **a system path never relies on "no setting" — it uses an explicit system client** (`systemPrisma` / `unscoped('reason')`), so a forgotten bypass fails _loudly in code review / tests_, and the RLS extension throws in-app when a tenant query runs with no tenant in context (app fail-loud before DB fail-closed). The silent failure mode to design against: a cross-tenant cron on the app role sees **zero rows and reports success**.

| Path                                                                                                                                                  | Under RLS                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Tenant resolution (`verifyBearer` ApiKey hash lookup, `resolveActiveMembership` by `clerkId`, MCP `McpConnection`)                                    | system client — it runs before the tenant is known                                                                               |
| 14 crons in `vercel.json` (prune-_, sweep-_, triage/rejudge-crossings, roll-sprints, summaries, backfill-lineage, purge-trash, recheck-github-access) | system client; per-workspace loops may switch to `withTenant(ws)` per iteration                                                  |
| `execute-workspace-deletions`, workspace export                                                                                                       | run **with** `app.workspace_id = <target>` — RLS then guarantees deletion/export cannot touch another tenant (a real gain)       |
| Webhooks (`app/api/webhooks/{github,slack,sentry}`)                                                                                                   | resolve installation → workspace with the system client, then `withTenant`                                                       |
| Migrations                                                                                                                                            | owner over the direct URL — unaffected (owner, DDL)                                                                              |
| `scripts/backfill-*` (run locally on `DATABASE_URL`)                                                                                                  | must use the owner URL; under R3 a backfill on the app role silently processes 0 rows → scripts assert a non-zero expected count |
| `mcp/` server                                                                                                                                         | its own client; system for resolution, `withTenant(activeWorkspaceId)` for tools                                                 |
| `agent-server`                                                                                                                                        | not in this repo; needs its own decision if it connects to Postgres directly                                                     |
| Test harness (`scripts/test-support/pglite-harness.ts`, 32 suites)                                                                                    | connects as superuser → RLS invisible; RLS tests must `SET LOCAL ROLE` a non-superuser inside the tx                             |

## 5. Rollout plan (only if the ruling is go)

1. **Confirm facts** (user-authorised, read-only on prod): `rolbypassrls`/`rolsuper` of the runtime role, `tableowner` of `Task`/`Project`.
2. **Prototype** (dev DB + PGlite only): role model R2 behind `LUMO_RLS=off|on` (default off); RLS on `Project` (direct) and `Task` (EXISTS policy) via a hand-written migration; `withTenant` + ALS context; `runInTransaction` sets the GUC.
3. **Tests** (PGlite, `SET LOCAL ROLE lumo_rls`): no setting → 0 rows from `Project`/`Task` reads, raw SQL included; wrong workspace → 0 rows; write with another tenant's `workspaceId` → rejected by `WITH CHECK`; system client still sees all; a session-level `set_config` lint.
4. **Measure** on a Neon dev branch from a preview deployment in the prod region: task-list route p50/p95 with flag off/on (500 requests each), plus `EXPLAIN ANALYZE` of the Task EXISTS policy.
5. **Staged rollout**: preview → prod with flag on for read paths of the two tables → all directly-scoped tables → decide Task denormalisation → move to R3 (dedicated role) once every system path is on the explicit client.
6. **Rollback**: R2 = flag off (instant, no deploy of SQL). R3 = repoint runtime URL to owner. Policies themselves are only dropped by a new migration through the deploy pipeline (never by hand).

Risks: pool exhaustion if a wrapped unit of work spans an external call; a missed system path returning 0 rows (mitigated by in-app throw + explicit client); a forgotten `true` in `set_config` (cross-tenant leak — lint); Prisma internals changing for Option C; LUM-931's credential rotation not covering an R3 role.

## 6. Cost/benefit and recommendation

**Benefit over LUM-979**: enforcement in production (LUM-979 only logs there), plus coverage of raw SQL, nested relation reads/writes, transitively-scoped tables (with policies) and any client that bypasses `scopedPrisma` (e.g. `mcp/`). It also makes workspace deletion/export provably single-tenant.

**Cost**: +3 RTT per unit of work at best; a refactor of ~40 interactive-transaction sites and 25 load-then-authorize routes; a second explicit client for ~14 crons, 3 webhooks, tenant resolution, MCP and scripts; a role/credential model that partly conflicts with Neon-managed secrets; a Task policy that is either a per-row subquery or a schema change.

**Recommendation for the user to rule on: go-later, with conditions.** Do not start RLS now; land LUM-979 first and let its production log-only mode run. Start the prototype (§5 steps 1–4) when any of these hold: (a) LUM-979 has migrated most repositories and prod has logged zero `WORKSPACE_SCOPE_MISSING` for ~2–4 weeks (so the remaining risk is what LUM-979 structurally cannot see); (b) a customer/compliance requirement asks for database-enforced isolation; (c) a cross-tenant bug is found in raw SQL or a nested relation read. A no-regret step now is §5 step 1 (the read-only role check), which decides between R1 and R3.

### Questions for the ruling

1. Go now / **go-later (conditions above)** / no-go?
2. If go: role model — R2 for the prototype then R3 (recommended), or R1 if the role check shows no `BYPASSRLS`?
3. Transaction granularity — Option B (unit-of-work, recommended) vs A (per-query, simpler, ~+20–60 ms)?
4. `Task`: EXISTS policy, or add a denormalised `workspaceId` column (schema change, also helps LUM-979)?
5. Authorise someone to run the read-only role/owner check on prod (step 1)? It was **not** run in this design pass.
