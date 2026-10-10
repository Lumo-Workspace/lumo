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
- `openssl` (or any other way to make random hex strings).

No third-party account is needed: users sign in with Lumo's built-in
accounts (Better Auth, see [Sign-in](#sign-in)), stored in the bundled
Postgres.

## Quick start

```bash
cp .env.example .env
# Fill the two empty REQUIRED secrets (DATABASE_URL is ignored by compose):
sed -i.bak -e "s/^CRON_SECRET=$/CRON_SECRET=$(openssl rand -hex 32)/" \
  -e "s/^BETTER_AUTH_SECRET=$/BETTER_AUTH_SECRET=$(openssl rand -hex 32)/" .env \
  && rm .env.bak
# Then add the compose secrets:
for v in WORKFLOW_SECRET POSTGRES_PASSWORD MINIO_ROOT_PASSWORD SOKETI_APP_SECRET; do
  echo "$v=$(openssl rand -hex 32)"
done >> .env

docker compose up -d --build
docker compose ps        # every service "healthy" / migrate + minio-init "exited (0)"
```

Open <http://localhost:3000/signin>, choose **No account yet? Create one**,
create an account with your email and a password, then create a workspace,
a project and a task. (`/signup` is the hosted service's waitlist form, not
account creation.) The first
account is an ordinary user: whoever creates a workspace owns it. To stop
strangers from signing up on a public instance, see [Sign-in](#sign-in).

The first build takes a while (dependencies plus `next build`); later
`up -d --build` runs reuse the cached layers. Keep secrets hex (`openssl rand
-hex 32`): `WORKFLOW_SECRET` is embedded in a URL.

### Build-time settings (`NEXT_PUBLIC_*`)

`next build` inlines every `NEXT_PUBLIC_*` value into the browser bundle, so
those are **build arguments** of the image, not runtime settings. Compose
passes them from `.env`:

| `.env` setting        | Becomes                                                   | Default                 |
| --------------------- | --------------------------------------------------------- | ----------------------- |
| `NEXT_PUBLIC_APP_URL` | the same                                                  | `http://localhost:3000` |
| `SOKETI_PUBLIC_HOST`  | `NEXT_PUBLIC_PUSHER_HOST`                                 | `localhost`             |
| `SOKETI_PUBLIC_PORT`  | `NEXT_PUBLIC_PUSHER_PORT` (and the published Soketi port) | `6001`                  |
| `SOKETI_PUBLIC_TLS`   | `NEXT_PUBLIC_PUSHER_USE_TLS`                              | `false`                 |

Compose also builds with `AUTH_PROVIDER=better-auth` (static pages bake the
auth provider in, so the build and the runtime must agree).

After changing any of them run `docker compose up -d --build` again. Without
compose, pass them yourself:
`docker build --build-arg NEXT_PUBLIC_APP_URL=https://lumo.example.com .`
(the image defaults to `AUTH_PROVIDER=better-auth`).
On a builder with less than 8 GB, lower the heap with
`--build-arg BUILD_MAX_OLD_SPACE_SIZE=4096` (the build may then fail).

### What compose wires for you

Compose sets these for the app and ignores what `.env` says about them:
`DATABASE_URL` / `DATABASE_URL_UNPOOLED` (with `sslmode=disable` — the bundled
Postgres has no TLS, and Lumo otherwise insists on a verified TLS
connection), the Postgres World (`WORKFLOW_TARGET_WORLD`,
`WORKFLOW_POSTGRES_URL` — a direct connection — and `WORKFLOW_LOCAL_BASE_URL`
carrying `WORKFLOW_SECRET`, see [workflow.md](workflow.md)), `PORT`,
`REDIS_URL`, the MinIO `S3_*` settings with `BLOB_STORAGE=s3`, the
server-side `PUSHER_*` settings for Soketi, and `AUTH_PROVIDER=better-auth`
with `BETTER_AUTH_URL` (from `.env` if set, else `NEXT_PUBLIC_APP_URL`).
Everything else in `.env` is passed
to the app unchanged, so the optional features below are turned on by
editing `.env` and running `docker compose up -d`.

## What works without optional services

Only Postgres is strictly required (sign-in uses it too); compose provides
the rest of the core. Features that need an outside service degrade instead of failing:

| Feature                                                                        | Needs                                                                              | Without it                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AI (task breakdown, summaries, AI review, memory search)                       | `AI_GATEWAY_API_KEY`, or direct keys (`ANTHROPIC_API_KEY` / `OPENAI_COMPATIBLE_*`) | AI features say "AI is not configured". Memory search falls back to lexical matching without a 1024-dimension embedding model. |
| Crossing triage (`triage-crossings` cron, evaluation model)                    | the Vercel AI Gateway (`AI_GATEWAY_API_KEY`)                                       | The job has nothing to run on direct keys; add it to `LUMO_CRON_DISABLED`.                                                     |
| Email (invites, sign-up verification, notices)                                 | `SMTP_URL` / `SMTP_*`, or `RESEND_API_KEY`                                         | Emails are logged and skipped. Sign-in still works, but nobody can verify an address, so **invites cannot be accepted**.       |
| GitHub / Slack / Figma / Google Drive / Sentry                                 | their variables plus `ENCRYPTION_KEY` (see `.env.example`)                         | The integration is hidden; its routes answer 404 `integration_not_configured`.                                                 |
| Managed PR security scan, L3 hunt, review verifier                             | a Vercel Sandbox (Vercel OIDC credentials)                                         | Off; the settings page marks them unavailable.                                                                                 |
| SARIF upload from your own CI (`POST /api/integrations/security/sarif/upload`) | Vercel Blob (the CI uploads straight to the store)                                 | Answers 501 on MinIO / disk storage.                                                                                           |
| Link previews of sites that block plain fetches                                | a Chromium (`CHROME_PATH`)                                                         | Previews use the plain fetch only.                                                                                             |

## Sign-in

Compose runs Lumo with **Better Auth** (`AUTH_PROVIDER=better-auth`):
email + password accounts, sessions and verification tokens live in the
bundled Postgres. No Clerk account or `CLERK_*` variable is involved.

- **`BETTER_AUTH_SECRET`** (required, at least 32 characters) signs session
  cookies: `openssl rand -hex 32`. Compose refuses to start without it, and
  the app container exits if it is shorter. Changing it signs everybody out.
- **`BETTER_AUTH_URL`** is the public URL users reach Lumo on; it defaults to
  `NEXT_PUBLIC_APP_URL`. Sign-in requests from any other origin are refused,
  so set it (or `NEXT_PUBLIC_APP_URL`, then rebuild) when you put Lumo behind
  a domain or change `LUMO_PORT`.
- **Email verification.** A new account receives a verification link by
  email. Signing in works without verifying, but only a **verified** address
  can accept a workspace invite — so inviting people needs email (`SMTP_URL`
  or `SMTP_*`, see `.env.example`). To try it locally, use the bundled
  Mailpit: set `SMTP_URL=smtp://mailpit:1025` in `.env`, run
  `docker compose --profile mail up -d`, and open <http://localhost:8025> to
  read the mail Lumo sent.
- **Closing sign-up.** `AUTH_DISABLE_SIGNUP=true` turns off email sign-up:
  only existing accounts can sign in. Create your own account first, then set
  it and run `docker compose up -d` (no rebuild). Accepting an invite needs an
  account, so leave sign-up open while people you invited join.
- **GitHub / Google sign-in** (optional): create an OAuth app with the
  callback URL `<BETTER_AUTH_URL>/api/auth/callback/github` (or
  `…/callback/google`) and set `AUTH_GITHUB_CLIENT_ID` +
  `AUTH_GITHUB_CLIENT_SECRET` (or the `AUTH_GOOGLE_*` pair). The button
  appears once both are set; no rebuild needed. These are separate from the
  `GITHUB_CLIENT_*` variables of the GitHub integration.
- **MCP clients** (Claude, Cursor, VS Code, MCP Inspector, …) connect to
  `<BETTER_AUTH_URL>/api/mcp`; this instance serves the OAuth flow itself
  (discovery, dynamic client registration, PKCE, consent at
  `/oauth/consent`). `BETTER_AUTH_URL` (or `NEXT_PUBLIC_APP_URL`) must be the
  public URL — issuer and token audience derive from it; without it
  `/api/mcp` answers 501. Redirect URIs must be `https://`,
  `http://localhost` (or `127.0.0.1` / `[::1]`), or one of a fixed list of
  app schemes — `cursor://`, `vscode://`, `vscode-insiders://`; any other
  custom scheme is rejected. Every new client still needs your consent, and
  PKCE (S256) is required. When a client re-registers (e.g. after you change
  `BETTER_AUTH_URL`), it picks up the workspace last selected for a client
  of the same name. The Lumo CLI uses API keys.

Clerk is what the hosted service uses. `docker-compose.yml` does not support
it; to run a Clerk image anyway, build with
`--build-arg AUTH_PROVIDER=clerk --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_…`
and run it with `AUTH_PROVIDER=clerk` and `CLERK_SECRET_KEY`.

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
