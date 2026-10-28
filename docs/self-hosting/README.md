# Self-hosting Lumo with Docker Compose

One command starts Lumo and everything it needs on a single machine:

| Service      | Image                                 | What it does                                                                                                                        |
| ------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `app`        | `ghcr.io/lumo-workspace/lumo`         | Lumo (`next start`), including the in-process workflow worker. Published on port 3000. Prebuilt; `--build` builds `Dockerfile`.     |
| `migrate`    | same image as `app`                   | One-shot on every `up`: `prisma migrate deploy`, then `npm run workflow:bootstrap`. `app` starts only after it succeeds.            |
| `postgres`   | `pgvector/pgvector:pg16`              | The database. Lumo's migrations need the `vector` extension, so plain `postgres` images do not work.                                |
| `redis`      | `redis:7-alpine`                      | Rate-limit counters (shared across restarts and instances).                                                                         |
| `minio`      | `cgr.dev/chainguard/minio`            | File storage (logos, test evidence, editor images, exports), S3-compatible. Not published: files are served through Lumo's routes.  |
| `minio-init` | `cgr.dev/chainguard/minio-client`     | One-shot: creates the bucket. It stays private (no public policy).                                                                  |
| `soketi`     | `quay.io/soketi/soketi:1.6-16-debian` | Realtime updates (Pusher protocol). Published on port 6001 for plain-HTTP setups; behind HTTPS browsers reach it at `/app/`.        |
| `cron`       | `ghcr.io/lumo-workspace/lumo-cron`    | supercronic running `deploy/self-host/crontab` against the app ([cron.md](cron.md)). Built from `deploy/self-host/cron.Dockerfile`. |
| `caddy`      | `caddy:2.10-alpine` (profile `caddy`) | Optional HTTPS on your domain with an automatic certificate; sends `/app/` to Soketi and the rest to the app.                       |
| `mailpit`    | `axllent/mailpit` (profile `mail`)    | Development only: catches outgoing mail.                                                                                            |

Kubernetes / Helm are not provided.

## Prerequisites

- Docker with Compose v2 (`docker compose version`), about 2 GB of memory
  and ~5 GB of disk. The app and cron images are prebuilt for `linux/amd64`
  and `linux/arm64`, so the server never runs `next build`.
- `openssl` (used by `scripts/self-host/init.sh` to generate secrets).

No third-party account is needed: users sign in with Lumo's built-in
accounts (Better Auth, see [Sign-in](#sign-in)), stored in the bundled
Postgres.

## Quick start

```bash
git clone https://github.com/Lumo-Workspace/lumo.git && cd lumo
scripts/self-host/init.sh          # creates .env, generates every secret
docker compose up -d               # pulls the images and starts everything
docker compose ps                  # every service "healthy" / migrate + minio-init "exited (0)"
```

Open <http://localhost:3000/signin>, choose **No account yet? Create one**,
create an account with your email and a password, then create a workspace,
a project and a task. (`/signup` is the hosted service's waitlist form, not
account creation.) The first
account is an ordinary user: whoever creates a workspace owns it. To stop
strangers from signing up on a public instance, see [Sign-in](#sign-in).

`init.sh` creates `.env` readable by its owner only (mode 600) and is safe
to re-run: it fills only secrets that are still empty and
never replaces one that has a value (changing `BETTER_AUTH_SECRET` signs
everybody out; the database and MinIO passwords must keep matching their
volumes). It warns when no email is configured.

### On your own domain (HTTPS)

Point the domain's DNS at the server, open ports 80 and 443, then:

```bash
scripts/self-host/init.sh --url https://lumo.example.com
docker compose --profile caddy up -d
```

`--url` sets `NEXT_PUBLIC_APP_URL`, `LUMO_PUBLIC_URL` and `BETTER_AUTH_URL`
to that URL, `LUMO_DOMAIN` for Caddy, and points the browser's realtime
connection at the same origin (`SOKETI_PUBLIC_HOST` = the domain, the URL's
port or 443, TLS on). The
`caddy` service gets a Let's Encrypt certificate and serves
everything on that one origin: `/app/*` (the realtime socket) goes to Soketi,
the rest to the app.

With your own reverse proxy (nginx, Traefik, …) instead of the profile, run
the same `init.sh --url` and give the proxy the same two rules: `/app/` →
port 6001 (WebSocket upgrade on), everything else → port 3000.

Changing the URL later is the same command followed by `docker compose up -d`
— no rebuild. A plain-HTTP URL (`--url http://192.168.1.20:3000`) keeps the
browser talking to Soketi directly on port 6001.

### Image versions and building from source

`docker compose up -d` uses `ghcr.io/lumo-workspace/lumo:latest` and
`ghcr.io/lumo-workspace/lumo-cron:latest`. To pin a release, set
`LUMO_IMAGE=ghcr.io/lumo-workspace/lumo:<version>` and
`LUMO_CRON_IMAGE=ghcr.io/lumo-workspace/lumo-cron:<version>` in `.env`.

To build both images from your checkout instead, run
`docker compose up -d --build` (Compose also builds when it cannot pull the
image). Building needs about **8 GB of memory** available to Docker
(`next build` is memory-hungry) and ~10 GB of disk; on a smaller builder,
lower the heap with `BUILD_MAX_OLD_SPACE_SIZE=4096` in `.env` (the build
may then fail). Keep secrets hex (`openssl rand -hex 32`): `WORKFLOW_SECRET`
is embedded in a URL.

### Public URL and realtime settings

The app reads these at runtime and serves the browser's share of them from
`/api/public-config`, so they take effect on `docker compose up -d` without a
rebuild:

| `.env` setting        | Becomes                      | Default                 |
| --------------------- | ---------------------------- | ----------------------- |
| `NEXT_PUBLIC_APP_URL` | the same                     | `http://localhost:3000` |
| `SOKETI_PUBLIC_HOST`  | `NEXT_PUBLIC_PUSHER_HOST`    | `localhost`             |
| `SOKETI_PUBLIC_PORT`  | `NEXT_PUBLIC_PUSHER_PORT`    | `6001`                  |
| `SOKETI_PUBLIC_TLS`   | `NEXT_PUBLIC_PUSHER_USE_TLS` | `false`                 |

`SOKETI_PORT` (default `6001`) is the host port Soketi is published on.
`AUTH_PROVIDER` is still fixed at build time (static pages bake it in); the
images are built with `better-auth`.

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
| GitHub / Slack / Figma / Google Drive / Sentry                                 | their variables plus `ENCRYPTION_KEY` ([integrations.md](integrations.md))         | The integration is hidden; its routes answer 404 `integration_not_configured`.                                                 |
| Managed PR security scan, L3 hunt, review verifier                             | a Vercel Sandbox (Vercel OIDC credentials)                                         | Off; the settings page marks them unavailable.                                                                                 |
| SARIF upload from your own CI (`POST /api/integrations/security/sarif/upload`) | Vercel Blob (the CI uploads straight to the store)                                 | Answers 501 on MinIO / disk storage.                                                                                           |
| `lumo security import` (a Claude Code / Codex review into the PR scan)         | GitHub integration; any blob backend (the server stores the report)                | Works on MinIO / disk storage too. Without GitHub, there is no PR to import into.                                              |
| Link previews of sites that block plain fetches                                | a Chromium (`CHROME_PATH`)                                                         | Previews use the plain fetch only.                                                                                             |

## Sign-in

Compose runs Lumo with **Better Auth** (`AUTH_PROVIDER=better-auth`):
accounts, sessions and verification tokens live in the bundled Postgres. No
Clerk account or `CLERK_*` variable is involved.

The sign-in page offers, top to bottom: the GitHub / Google buttons you
configured; **email codes** (enter an email, receive a 6-digit code valid for
10 minutes, enter it — a new email gets an account in the same step), shown
once email is configured; and **email + password**, on by default.

- **`BETTER_AUTH_SECRET`** (required, at least 32 characters) signs session
  cookies: `openssl rand -hex 32`. Compose refuses to start without it, and
  the app container exits if it is shorter. Changing it signs everybody out.
- **`BETTER_AUTH_URL`** is the public URL users reach Lumo on; it defaults to
  `NEXT_PUBLIC_APP_URL`. Sign-in requests from any other origin are refused,
  so set it when you put Lumo behind a domain or change `LUMO_PORT`
  (`scripts/self-host/init.sh --url …` sets both).
- **Email verification.** A new account receives a verification link by
  email. Signing in works without verifying, but only a **verified** address
  can accept a workspace invite — so inviting people needs email (`SMTP_URL`
  or `SMTP_*`, see `.env.example`). To try it locally, use the bundled
  Mailpit: set `SMTP_URL=smtp://mailpit:1025` in `.env`, run
  `docker compose --profile mail up -d`, and open <http://localhost:8025> to
  read the mail Lumo sent.
- **Email codes** need email (`SMTP_URL` / `SMTP_*` or `RESEND_API_KEY`).
  Without it the page shows only the password form; in development
  (`NODE_ENV=development`, i.e. `next dev`) codes are offered anyway and written to the
  server log. Three wrong codes void a code; sending and checking codes is
  rate limited per IP. An existing account whose email is not verified cannot
  sign in by code (it answers like a wrong code): verify the address by the
  emailed link or sign in with the password first.
- **Turning passwords off.** `AUTH_DISABLE_PASSWORD=true` removes password
  sign-in, sign-up, forgot / reset password (`/reset-password` is a 404) and
  the change-password card, leaving email codes and GitHub / Google — the
  hosted uselumo.ai setup. Configure email first, or nobody without a social
  login can sign in (Lumo logs a warning). Existing password accounts keep
  their email and sign in with a code. No rebuild needed.
- **Closing sign-up.** `AUTH_DISABLE_SIGNUP=true` turns off email sign-up:
  only existing accounts can sign in. Create your own account first, then set
  it and run `docker compose up -d` (no rebuild). Accepting an invite needs an
  account, so leave sign-up open while people you invited join.
- **GitHub / Google sign-in** (optional): create an OAuth app with the
  callback URL `<BETTER_AUTH_URL>/api/auth/callback/github` (or
  `…/callback/google`) and set `AUTH_GITHUB_CLIENT_ID` +
  `AUTH_GITHUB_CLIENT_SECRET` (or the `AUTH_GOOGLE_*` pair). The button
  appears once both are set; no rebuild needed. These are separate from the
  `GITHUB_CLIENT_*` variables of the GitHub integration. Use a **separate**
  Google OAuth client from the Google Drive integration's `GOOGLE_CLIENT_ID`
  — otherwise Google's sign-in screen also lists the Drive access granted to
  that client; Lumo logs a warning when the two ids are equal.
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

Lumo can also run with Clerk instead (the hosted service used it until
October 2026), but `docker-compose.yml` does not support it; to run a Clerk
image anyway, build with
`--build-arg AUTH_PROVIDER=clerk --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_…`
and run it with `AUTH_PROVIDER=clerk` and `CLERK_SECRET_KEY`.

## Operating it

### Upgrading

```bash
git pull
docker compose pull      # the newest images (or the release LUMO_IMAGE pins)
docker compose up -d     # add --build if you build from source
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

- **TLS / domain**: see [On your own domain](#on-your-own-domain-https).
  `LUMO_PUBLIC_URL` (set by `init.sh --url`) matters even without a proxy:
  links Lumo writes outside the app — CLI output, GitHub comments, notices —
  otherwise point at the hosted service. If you can, have the proxy refuse
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
  `minio-data` (plus `caddy-data`, Caddy's certificates). `docker compose down` keeps them; `down -v` deletes them.

### Integrations

GitHub, Slack, Figma, Google Drive and Sentry each need an app you register
with the provider; webhooks need a URL the provider can reach. Step-by-step
setup, the permissions and events each one needs, tunnels for a private
server, and `ENCRYPTION_KEY`: [integrations.md](integrations.md).

With the GitHub App connected, deleting a rule from the `## Forbidden`
section of a project's `CLAUDE.md` / `AGENTS.md` is recorded as a
POLICY_WEAKENING crossing (no model involved). What is recorded and the exact
format that is recognised: [forbidden-rules.md](forbidden-rules.md).

### Using your own Postgres / S3 / Pusher

Edit `docker-compose.yml`: drop the bundled service and change the matching
entries under `x-app-env` (for Postgres keep a **direct** connection for
`WORKFLOW_POSTGRES_URL`, and drop `sslmode=disable` if the server has TLS).
