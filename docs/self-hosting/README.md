# Self-hosting Lumo with Docker Compose

One command starts Lumo and everything it needs on a single machine:

| Service      | Image                                         | What it does                                                                                                                       |
| ------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `app`        | built from `Dockerfile`                       | Lumo (`next start`), including the in-process workflow worker. Published on port 3000.                                             |
| `migrate`    | same image as `app`                           | One-shot on every `up`: `prisma migrate deploy`, then `npm run workflow:bootstrap`. `app` starts only after it succeeds.           |
| `postgres`   | `pgvector/pgvector:pg16`                      | The database. Lumo's migrations need the `vector` extension, so plain `postgres` images do not work.                               |
| `redis`      | `redis:7-alpine`                              | Rate-limit counters (shared across restarts and instances).                                                                        |
| `minio`      | `cgr.dev/chainguard/minio`                    | File storage (logos, test evidence, editor images, exports), S3-compatible. Not published: files are served through Lumo's routes. |
| `minio-init` | `cgr.dev/chainguard/minio-client`             | One-shot: creates the bucket. It stays private (no public policy).                                                                 |
| `soketi`     | `quay.io/soketi/soketi:1.6-16-debian`         | Realtime updates (Pusher protocol). Published on port 6001 because browsers connect to it directly.                                |
| `cron`       | built from `deploy/self-host/cron.Dockerfile` | supercronic running `deploy/self-host/crontab` against the app ([cron.md](cron.md)).                                               |
| `mailpit`    | `axllent/mailpit` (profile `mail`)            | Development only: catches outgoing mail.                                                                                           |

Kubernetes / Helm are not provided.

## Prerequisites

- Docker with Compose v2 (`docker compose version`). Building the image needs
  about **8 GB of memory** available to Docker (`next build` is
  memory-hungry) and ~10 GB of disk for images and build layers.
- A **Clerk** application. Lumo still signs users in through Clerk until
  LUM-1027 makes it optional. The free plan is enough:
  1. Create an application at <https://dashboard.clerk.com>.
  2. **API Keys** → copy the _Publishable key_ (`pk_…`) and the _Secret key_
     (`sk_…`).
  3. A _Development_ instance works on `http://localhost:3000` as is. For a
     real domain, create a _Production_ instance and follow Clerk's DNS
     instructions for that domain.
- `openssl` (or any other way to make random hex strings).

## Quick start

```bash
cp .env.example .env
# Fill the REQUIRED section of .env: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
# CLERK_SECRET_KEY and CRON_SECRET (DATABASE_URL is ignored by compose).
# Then add the compose secrets:
for v in WORKFLOW_SECRET POSTGRES_PASSWORD MINIO_ROOT_PASSWORD SOKETI_APP_SECRET; do
  echo "$v=$(openssl rand -hex 32)"
done >> .env
sed -i.bak "s/^CRON_SECRET=$/CRON_SECRET=$(openssl rand -hex 32)/" .env && rm .env.bak

docker compose up -d --build
docker compose ps        # every service "healthy" / migrate + minio-init "exited (0)"
```

Open <http://localhost:3000>, sign up, create a workspace and a task.

The first build takes a while (dependencies plus `next build`); later
`up -d --build` runs reuse the cached layers. Keep secrets hex (`openssl rand
-hex 32`): `WORKFLOW_SECRET` is embedded in a URL.

### Build-time settings (`NEXT_PUBLIC_*`)

`next build` inlines every `NEXT_PUBLIC_*` value into the browser bundle, so
those are **build arguments** of the image, not runtime settings. Compose
passes them from `.env`:

| `.env` setting                      | Becomes                                                   | Default                 |
| ----------------------------------- | --------------------------------------------------------- | ----------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | the same                                                  | — (required)            |
| `NEXT_PUBLIC_APP_URL`               | the same                                                  | `http://localhost:3000` |
| `SOKETI_PUBLIC_HOST`                | `NEXT_PUBLIC_PUSHER_HOST`                                 | `localhost`             |
| `SOKETI_PUBLIC_PORT`                | `NEXT_PUBLIC_PUSHER_PORT` (and the published Soketi port) | `6001`                  |
| `SOKETI_PUBLIC_TLS`                 | `NEXT_PUBLIC_PUSHER_USE_TLS`                              | `false`                 |

After changing any of them run `docker compose up -d --build` again. Without
compose, pass them yourself:
`docker build --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_… --build-arg NEXT_PUBLIC_APP_URL=https://lumo.example.com .`.
On a builder with less than 8 GB, lower the heap with
`--build-arg BUILD_MAX_OLD_SPACE_SIZE=4096` (the build may then fail).

### What compose wires for you

Compose sets these for the app and ignores what `.env` says about them:
`DATABASE_URL` / `DATABASE_URL_UNPOOLED` (with `sslmode=disable` — the bundled
Postgres has no TLS, and Lumo otherwise insists on a verified TLS
connection), the Postgres World (`WORKFLOW_TARGET_WORLD`,
`WORKFLOW_POSTGRES_URL` — a direct connection — and `WORKFLOW_LOCAL_BASE_URL`
carrying `WORKFLOW_SECRET`, see [workflow.md](workflow.md)), `PORT`,
`REDIS_URL`, the MinIO `S3_*` settings with `BLOB_STORAGE=s3`, and the
server-side `PUSHER_*` settings for Soketi. Everything else in `.env` is passed
to the app unchanged, so the optional features below are turned on by
editing `.env` and running `docker compose up -d`.

## What works without optional services

Only Postgres and Clerk are strictly required; compose provides the rest of
the core. Features that need an outside service degrade instead of failing:

| Feature                                                                        | Needs                                                                              | Without it                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AI (task breakdown, summaries, AI review, memory search)                       | `AI_GATEWAY_API_KEY`, or direct keys (`ANTHROPIC_API_KEY` / `OPENAI_COMPATIBLE_*`) | AI features say "AI is not configured". Memory search falls back to lexical matching without a 1024-dimension embedding model. |
| Crossing triage (`triage-crossings` cron, evaluation model)                    | the Vercel AI Gateway (`AI_GATEWAY_API_KEY`)                                       | The job has nothing to run on direct keys; add it to `LUMO_CRON_DISABLED`.                                                     |
| Email (invites, notices)                                                       | `RESEND_API_KEY` or `SMTP_*`                                                       | Emails are logged and skipped; copy invite links from the UI.                                                                  |
| GitHub / Slack / Figma / Google Drive / Sentry                                 | their variables plus `ENCRYPTION_KEY` (see `.env.example`)                         | The integration is hidden; its routes answer 404 `integration_not_configured`.                                                 |
| Managed PR security scan, L3 hunt, review verifier                             | a Vercel Sandbox (Vercel OIDC credentials)                                         | Off; the settings page marks them unavailable.                                                                                 |
| SARIF upload from your own CI (`POST /api/integrations/security/sarif/upload`) | Vercel Blob (the CI uploads straight to the store)                                 | Answers 501 on MinIO / disk storage.                                                                                           |
| Link previews of sites that block plain fetches                                | a Chromium (`CHROME_PATH`)                                                         | Previews use the plain fetch only.                                                                                             |

## Operating it

### Upgrading

```bash
git pull
docker compose up -d --build
```

`migrate` applies new migrations (`prisma migrate deploy` only — never
`migrate dev` or `db push`) and upgrades the workflow schemas before the new
app starts. Back up the `postgres-data` and `minio-data` volumes first
(`docker compose exec postgres pg_dump -U lumo lumo > lumo.sql`).

### Moving from Vercel (or another storage backend)

Switching storage does **not** move files. Vercel Blob URLs already stored in
the database (test evidence, editor images, exports, workspace logos) cannot be
read through MinIO until the objects are copied and the references rewritten —
see [uploaded-files.md](../privacy/uploaded-files.md). The repository ships no
migration script for this.

### Production notes

- **TLS / domain**: put a reverse proxy (Caddy, nginx, Traefik) in front of
  port 3000 and of Soketi's 6001 (or set `SOKETI_PUBLIC_HOST` to a host the
  proxy serves with `SOKETI_PUBLIC_TLS=true`), set `NEXT_PUBLIC_APP_URL` to
  the public URL and rebuild. If you can, have the proxy refuse
  `/.well-known/workflow/v1/flow` and `/step` from outside (they are already
  protected by `WORKFLOW_SECRET`; see [workflow.md](workflow.md)).
- **One app instance** is what this file runs and the only setup that has
  been tested. The app container keeps no files of its own (data is in
  Postgres and MinIO, rate limits in Redis), but every instance also runs a
  workflow worker and re-enqueues active runs when it boots; running several
  replicas is untested. Never drop `REDIS_URL` with more than one instance:
  the in-memory fallback counts per process (the effective limit becomes N ×
  the configured one) and resets on every restart.
- **Scheduled jobs** run in `cron` against `http://app:3000`. Turn jobs off
  with `LUMO_CRON_DISABLED=<name>,<name>` in `.env` (details in
  [cron.md](cron.md)).
- **Logs**: `docker compose logs -f app cron`.
- **Data** lives in the named volumes `postgres-data`, `redis-data` and
  `minio-data`. `docker compose down` keeps them; `down -v` deletes them.

### Using your own Postgres / S3 / Pusher

Edit `docker-compose.yml`: drop the bundled service and change the matching
entries under `x-app-env` (for Postgres keep a **direct** connection for
`WORKFLOW_POSTGRES_URL`, and drop `sslmode=disable` if the server has TLS).
