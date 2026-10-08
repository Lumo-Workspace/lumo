# Durable workflows (Postgres World) when self-hosting

Lumo runs its long-lived jobs — workspace exports, PR security scans and hunts,
SARIF ingest — on the [Workflow SDK](https://workflow-sdk.dev). On Vercel the
runtime uses the Vercel World automatically and nothing here applies. A
self-hosted deployment runs them on **`@workflow/world-postgres`**: runs,
steps and sleeps are stored in Postgres and executed by a worker
(graphile-worker) inside the Next.js process.

## Configuration

[Docker Compose](README.md) sets all of this up (the `migrate` service runs
the deploy order below); the rest of this page explains what it does.

| Variable                               | Required | Meaning                                                                                                            |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `WORKFLOW_TARGET_WORLD`                | yes      | `@workflow/world-postgres`                                                                                         |
| `WORKFLOW_POSTGRES_URL`                | yes      | **Direct** connection string (see below). May be the same database as `DATABASE_URL`.                              |
| `WORKFLOW_SECRET`                      | yes      | Random secret the delivery routes require (`openssl rand -hex 32`).                                                |
| `WORKFLOW_LOCAL_BASE_URL`              | yes      | `http://workflow:<url-encoded WORKFLOW_SECRET>@localhost:<PORT>` — where the worker delivers, carrying the secret. |
| `PORT`                                 | yes      | The port `next start` listens on; must match the port in `WORKFLOW_LOCAL_BASE_URL`.                                |
| `WORKFLOW_POSTGRES_WORKER_CONCURRENCY` | yes      | Concurrent jobs per process. Set it to `10` (compose does): the World's own default is 50, more than its pool.     |
| `WORKFLOW_POSTGRES_MAX_POOL_SIZE`      | no       | The World's `pg` pool size (default 10; graphile recommends at least 10 or concurrency + 2, whichever is larger).  |

The app checks this at boot (`instrumentation.ts`): a missing
`WORKFLOW_POSTGRES_URL` stops the start, and a pooler URL, a missing secret or
a delivery URL without credentials are logged as `[workflow-world]` warnings.

### Use a direct connection, not a pooler

The worker is woken by Postgres `LISTEN/NOTIFY`. A transaction-mode pooler
(PgBouncer, Neon's `-pooler` endpoint, Supabase's pooler) drops the
notifications, so every job then waits for the worker's 500 ms poll instead of
starting immediately. Runs still complete, only slower. Use the unpooled
connection string (on Neon: the host **without** `-pooler`). The app warns at
startup when the URL looks like a pooler (`-pooler` host, port 6432 or
`pgbouncer=true`).

## Deploy order

The World keeps its tables in its own schemas — `workflow`,
`workflow_drizzle` and `graphile_worker` — and never touches Prisma's `public`
schema. They are created by the World's own bootstrap, **not** by
`prisma migrate`. On every deploy:

```bash
npx prisma migrate deploy      # Lumo's schema (public)
npm run workflow:bootstrap     # the World's schemas; idempotent
next start -p "$PORT"          # starts the in-process worker
```

`npm run workflow:bootstrap` wraps the package's `bootstrap` CLI and refuses
to run without `WORKFLOW_POSTGRES_URL` (the CLI alone would fall back to
`DATABASE_URL`). Running it before every start is safe.

The worker runs inside the Next.js process, so the app must be a long-running
process (`next start`, not serverless). On boot it re-enqueues every pending
or running run, which is how a run interrupted by a restart resumes.

## Upgrading from Workflow SDK 4.x

Lumo moved to Workflow SDK 5 (`workflow` 5.1.0, `@workflow/world-postgres`
5.0.2) in LUM-1032. A deployment that already ran on the 4.x Postgres World
needs two extra steps, once:

1. **Drain in-flight runs first.** A run started on 4.x cannot continue on
   5.x: its event log uses 4.x event ids, and the 5.x runtime fails every
   replay of it with `Event id is not slot-numbered` (reproduced in LUM-1032).
   Such a run stays `running` and is retried with backoff, never finishing — a
   workspace export sleeping toward its 7-day expiry then never deletes its
   archive. Before switching the image, wait until nothing is pending or
   running, or cancel what you can give up:

   ```sql
   select status, count(*) from workflow.workflow_runs
    where status in ('pending', 'running') group by status;
   ```

   An export still `READY` from before the upgrade keeps refusing downloads
   after its `expiresAt`, but its archive is no longer deleted automatically:
   remove it from storage by hand once it has expired.

2. **Recreate the World's schemas.** world-postgres 4.3.9 recorded migration
   0015 without 0011–0014, so the 5.x migrator — which only applies migrations
   newer than the last recorded one — never applies those four and then fails
   on a later migration that needs them (`column run.attributes does not
exist`). On such a database `npm run workflow:bootstrap` refuses to run and
   prints this path instead. With the app stopped:

   ```sql
   DROP SCHEMA workflow, workflow_drizzle, graphile_worker CASCADE;
   ```

   then run `npm run workflow:bootstrap` again (compose: `docker compose up -d`
   re-runs `migrate`). This deletes only workflow run history — Lumo's own
   data lives in `public` and is untouched.

A database created on 5.x needs neither step.

## Security of the delivery routes

The worker delivers each job to `/.well-known/workflow/v1/flow` over loopback
HTTP (since Workflow SDK 5 that one route runs steps too; the 4.x `/step`
route is gone). Those routes would otherwise accept any caller, so Lumo gates
them (LUM-1031, `lib/api/workflow-delivery-auth.ts`): every request must carry
`WORKFLOW_SECRET` as HTTP Basic credentials, which the worker sends because it
is embedded in `WORKFLOW_LOCAL_BASE_URL`. Without the secret the routes answer
401 — including the worker's own deliveries, so a missing secret stops all
workflows rather than leaving them open.

The check runs in Lumo's Next.js middleware (`proxy.ts`). The World's README
advises against gating these paths in framework middleware because a handler
that _consumes the request body_ breaks execution. Lumo's gate reads only the
path and the `Authorization` header, never the body, and passes the request
on untouched; with it active, exports run to completion end to end on the
Postgres World (LUM-1030), and a worker presenting the wrong secret is refused.

Still block `/.well-known/workflow/v1/flow` at your reverse proxy if you can:
loopback delivery never crosses it.

## Cancelling

Cancelling a run (`getRun(id).cancel()`) stops every later step but does not
interrupt the step that is executing; that step runs to completion. Lumo
handles the aftermath:

- **Workspace export** — a run cancelled while its archive is being built
  ends `FAILED` ("export cancelled") and the archive is deleted; it never
  becomes downloadable.
- **Managed scan / hunt** — their sandbox steps persist nothing themselves;
  results are written by later steps, which a cancelled run never starts. A
  persisting step that was already in flight discards its result when its run
  was cancelled.

## Queue maintenance

A process that is killed (crash, `kill -9`, OOM) leaves rows behind in
`graphile_worker`:

- **The job it was running stays locked** by a worker that no longer exists.
  Nothing is lost — on the next boot the app re-enqueues every active run —
  and graphile-worker releases locks older than 4 hours by itself. A released
  job whose attempts are used up is "permanently failed" and never runs
  again, but its row stays.
- **Each restart adds one wake-up job per sleeping run.** These are left
  alone: at wake time the extra ones replay to a no-op (a run's steps execute
  once), and deleting "duplicates" risks deleting the one a run needs.

The self-hosted crontab runs `workflow-queue-cleanup` daily (see
[cron.md](cron.md)): graphile-worker's own cleanup tasks
`DELETE_PERMAFAILED_JOBS`, `GC_JOB_QUEUES` and `GC_TASK_IDENTIFIERS`. Without
the scheduler you can run the same cleanup by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/workflow-queue-cleanup"
```
