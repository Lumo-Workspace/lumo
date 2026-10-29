# Self-hosting Lumo with Docker Compose

One command starts Lumo on a single machine. The default stack is the
minimum Lumo needs:

| Service    | Image                                 | What it does                                                                                                                                                                 |
| ---------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`      | `ghcr.io/lumo-workspace/lumo`         | Lumo (`next start`), including the in-process workflow worker. Published on port 3000. Applies migrations on every start, then serves. Files live on the `blob-data` volume. |
| `postgres` | `pgvector/pgvector:pg16`              | The database. Lumo's migrations need the `vector` extension, so plain `postgres` images do not work.                                                                         |
| `cron`     | `ghcr.io/lumo-workspace/lumo-cron`    | supercronic running `deploy/self-host/crontab` against the app ([cron.md](cron.md)). Built from `deploy/self-host/cron.Dockerfile`.                                          |
| `caddy`    | `caddy:2.10-alpine` (profile `caddy`) | Optional HTTPS on your domain with an automatic certificate; sends `/app/` to Soketi (realtime) and the rest to the app.                                                     |
| `mailpit`  | `axllent/mailpit` (profile `mail`)    | Development only: catches outgoing mail.                                                                                                                                     |

**Realtime updates** (Soketi, Pusher protocol) are optional:
`scripts/self-host/setup.sh --realtime` adds `deploy/self-host/compose.realtime.yml`
to `COMPOSE_FILE` in `.env`, which `docker compose` reads by itself, so every
command stays a plain `docker compose …`. Without it the UI refetches when the
window regains focus and every minute. (`COMPOSE_FILE` separates files with
`:`; on Windows outside WSL also set `COMPOSE_PATH_SEPARATOR=:` in `.env`.)

Rate limits are counted in the app's memory and files are stored on the
`blob-data` volume — enough for the one app instance compose runs. To use
your own Redis or S3 instead, set `REDIS_URL` or `BLOB_STORAGE=s3` with
`S3_*` in `.env` (see `.env.example`).

Kubernetes / Helm are not provided.

## Prerequisites

- Docker with Compose v2 (`docker compose version`), about 2 GB of memory
  and ~5 GB of disk. The app and cron images are prebuilt for `linux/amd64`
  and `linux/arm64`, so the server never runs `next build`.
- `openssl` (used by `scripts/self-host/setup.sh` to generate secrets).

No third-party account is needed: users sign in with Lumo's built-in
accounts (Better Auth, see [Sign-in](#sign-in)), stored in the bundled
Postgres.

## Quick start

```bash
git clone https://github.com/Lumo-Workspace/lumo.git && cd lumo
scripts/self-host/setup.sh         # writes .env, starts the stack, checks the configuration
```

`setup.sh` does three things:

1. Writes `.env`: copies `.env.example` the first time and generates the
   secrets.
2. Runs `docker compose up -d` (pulls the images, applies the migrations)
   and waits until postgres, app and cron are healthy.
3. Checks the configuration from inside the app container, with the app's
   own env and network, and prints one line per component:

```
  ✓ Database      connected, schema present
  ✓ File storage  disk: write, read and delete work
  – Email         not configured
                  Invites cannot be accepted without email: set SMTP_URL, SMTP_HOST or RESEND_API_KEY.
  – Redis         not configured (rate limits kept in memory)
  – Realtime      off (the UI refreshes on focus and every minute)
  – Public URL    http://localhost:3000 is local to this machine; open it in a browser
  ✓ Sign-in       accounts (sign-in required)
```

`✓` works, `–` not configured (fine for optional components), `✗` configured
but not working, with what to fix; `⚠` works but deserves a look (local mode
on a public URL) and does not fail the run. Email is checked by signing in to the
SMTP server (or the Resend relay) without sending anything; S3 by writing,
reading and deleting one object; the public URL by fetching it from the
server. `setup.sh` exits non-zero when any check fails. `--no-start` stops
after writing `.env`; `--check` only re-runs the check on the running stack.

Open <http://localhost:3000/signin>, choose **No account yet? Create one**,
create an account with your email and a password, then create a workspace,
a project and a task. (`/signup` is the hosted service's waitlist form, not
account creation.) The first
account is an ordinary user: whoever creates a workspace owns it. To stop
strangers from signing up on a public instance, see [Sign-in](#sign-in).

### Trying it on your own machine (no sign-in)

```bash
scripts/self-host/setup.sh --local
```

`--local` sets `LUMO_MODE=local` in `.env` and asks nothing. Open
<http://localhost:3000>: the first visit creates this instance's one account
and signs you in, so you land straight in the app. Everyone who opens the URL
is signed in as that account, so use it only where nobody else can reach
the app — on a URL other machines can reach, the app logs a warning and the
check shows `⚠ Sign-in`.

The first visit also gives the account a workspace, **My workspace**, so
there is no onboarding step either.

`setup.sh --local` also connects the `lumo` CLI, but only when that takes no
other login away: `lumo` is installed and either not logged in or already
logged in to this same URL. The CLI keeps one login, so when it is logged in
somewhere else (the hosted service, another server) setup leaves it alone
and prints the command instead; running it replaces that login:

```bash
lumo auth login --url http://localhost:3000
```

In local mode the server issues an API key for the account itself — no
browser, nothing to copy, and no need to open the app first (the account is
created if there is none). On any other server the same command falls back
to pasting a key from Settings → API Keys (`--no-paste` makes it fail
instead, for scripts). Anyone who can reach a local-mode instance can get
such a key, exactly as they can sign in.

The account is an ordinary one (`local@lumo.localhost`, no password), so
everything you create stays when you leave local mode. If the instance
already has one account (you signed up before), local mode signs you in as
that one; with several accounts it refuses (`HTTP 409`) and the check fails —
a team instance never opens without a sign-in. To go back to normal sign-in,
run `setup.sh --no-local`. The local account's data stays in the database,
but the account has no password and cannot be signed in to yet: claiming it
(giving it your email and a password) is not built yet, so for now leave
local mode only for an instance you are done trying. Any other `LUMO_MODE`
value is refused rather than guessed at: every request answers HTTP 500,
`docker compose logs app` names the variable, and `setup.sh` reports the app
as unhealthy.

Optional components (email, your own Redis or S3, OAuth, AI keys) are
configured after the first start: set them in `.env` and run `setup.sh`
again, which restarts what changed and checks it.

`setup.sh` creates `.env` readable by its owner only (mode 600) and is safe
to re-run: it keeps realtime and caddy as chosen earlier unless you pass
`--realtime` / `--no-realtime`, `--caddy` / `--no-caddy` or `--local` /
`--no-local`, fills only
secrets that are still empty and never replaces one that has a value
(changing `BETTER_AUTH_SECRET` signs everybody out; the database password
must keep matching its volume).
`scripts/self-host/setup.sh --help` lists every option.

### On your own domain (HTTPS)

Point the domain's DNS at the server, open ports 80 and 443, then:

```bash
scripts/self-host/setup.sh --url https://lumo.example.com --caddy --realtime
```

`--url` sets `NEXT_PUBLIC_APP_URL` — compose derives `LUMO_PUBLIC_URL` and
`BETTER_AUTH_URL` from it — and `LUMO_DOMAIN` for Caddy. With realtime on it
also points the browser's realtime connection at the same origin
(`SOKETI_PUBLIC_HOST` = the domain, the URL's port or 443, TLS on).
`--caddy` adds the `caddy` profile to `COMPOSE_PROFILES` in `.env`; that
service gets a Let's Encrypt certificate and serves
everything on that one origin: `/app/*` (the realtime socket) goes to Soketi,
the rest to the app. Leave `--realtime` out if you don't need live updates.

With your own reverse proxy (nginx, Traefik, …) instead, run the same
`setup.sh --url` without `--caddy` and give the proxy the same two rules: `/app/` →
port 6001 (WebSocket upgrade on), everything else → port 3000.

Changing the URL later is the same command — no rebuild. The public-URL
check then fetches the new URL from the server, so a DNS, port or proxy
problem shows up right away. A plain-HTTP URL (`--url http://192.168.1.20:3000`) keeps the
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

| `.env` setting        | Becomes                                 | Default                 |
| --------------------- | --------------------------------------- | ----------------------- |
| `NEXT_PUBLIC_APP_URL` | the same                                | `http://localhost:3000` |
| `LUMO_PUBLIC_URL`     | the same (links that leave the app)     | `NEXT_PUBLIC_APP_URL`   |
| `BETTER_AUTH_URL`     | the same (sign-in origin, MCP issuer)   | `NEXT_PUBLIC_APP_URL`   |
| `SOKETI_PUBLIC_HOST`  | `NEXT_PUBLIC_PUSHER_HOST` (realtime)    | `localhost`             |
| `SOKETI_PUBLIC_PORT`  | `NEXT_PUBLIC_PUSHER_PORT` (realtime)    | `6001`                  |
| `SOKETI_PUBLIC_TLS`   | `NEXT_PUBLIC_PUSHER_USE_TLS` (realtime) | `false`                 |

Set `LUMO_PUBLIC_URL` / `BETTER_AUTH_URL` only when they differ from the app
URL.

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
`LOCAL_BLOB_DIR`, and `AUTH_PROVIDER=better-auth`. It defaults
`BLOB_STORAGE` to `disk`, and `LUMO_PUBLIC_URL` and `BETTER_AUTH_URL` to
`NEXT_PUBLIC_APP_URL`, unless `.env` sets them. The realtime overlay adds the
`PUSHER_*` settings for Soketi.
Everything else in `.env` is passed
to the app unchanged, so the optional features below are turned on by
editing `.env` and running `scripts/self-host/setup.sh` (or `docker compose up -d`).

## What works without optional services

Only Postgres is strictly required (sign-in uses it too); the default stack
provides the rest of the core, and the optional components are listed
[above](#self-hosting-lumo-with-docker-compose). Features that need an outside service degrade instead of failing:

| Feature                                                                        | Needs                                                                              | Without it                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AI (task breakdown, summaries, AI review, memory search)                       | `AI_GATEWAY_API_KEY`, or direct keys (`ANTHROPIC_API_KEY` / `OPENAI_COMPATIBLE_*`) | AI features say "AI is not configured". Memory search falls back to lexical matching without a 1024-dimension embedding model. |
| Crossing triage (`triage-crossings` cron, evaluation model)                    | the Vercel AI Gateway (`AI_GATEWAY_API_KEY`)                                       | The job has nothing to run on direct keys; add it to `LUMO_CRON_DISABLED`.                                                     |
| Email (invites, sign-up verification, notices)                                 | `SMTP_URL` / `SMTP_*`, or `RESEND_API_KEY`                                         | Emails are logged and skipped. Sign-in still works, but nobody can verify an address, so **invites cannot be accepted**.       |
| GitHub / Slack / Figma / Google Drive / Sentry                                 | their variables plus `ENCRYPTION_KEY` ([integrations.md](integrations.md))         | The integration is hidden; its routes answer 404 `integration_not_configured`.                                                 |
| Managed PR security scan, L3 hunt, review verifier                             | a Vercel Sandbox (Vercel OIDC credentials)                                         | Off; the settings page marks them unavailable.                                                                                 |
| SARIF upload from your own CI (`POST /api/integrations/security/sarif/upload`) | Vercel Blob (the CI uploads straight to the store)                                 | Answers 501 on MinIO / disk storage.                                                                                           |
| `lumo review import` (a Claude Code / Codex review into the PR scan)           | GitHub integration; any blob backend (the server stores the report)                | Works on MinIO / disk storage too. Without GitHub, there is no PR to import into.                                              |
| Link previews of sites that block plain fetches                                | a Chromium (`CHROME_PATH`)                                                         | Previews use the plain fetch only.                                                                                             |

## Sign-in

Lumo signs users in with **Better Auth**, its only auth provider: accounts,
sessions and verification tokens live in the bundled Postgres.
`AUTH_PROVIDER` is optional (unset or `better-auth`).

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
  (`scripts/self-host/setup.sh --url …` sets the app URL it defaults to).
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

## Operating it

### Upgrading

```bash
git pull
docker compose pull      # the newest images (or the release LUMO_IMAGE pins)
scripts/self-host/setup.sh   # restarts on the new images and re-checks
```

The new app container applies new migrations (`prisma migrate deploy` only —
never `migrate dev` or `db push`) and upgrades the workflow schemas before it
starts serving. Back up the `postgres-data` and `blob-data` volumes first
(`docker compose exec postgres pg_dump -U lumo lumo > lumo.sql`).

### Moving from Vercel (or another storage backend)

Switching storage does **not** move files. Vercel Blob URLs already stored in
the database (test evidence, editor images, exports, workspace logos) cannot be
read from disk or S3 until the objects are copied and the references rewritten —
see [uploaded-files.md](../privacy/uploaded-files.md). The repository ships no
migration script for this.

### Production notes

- **TLS / domain**: see [On your own domain](#on-your-own-domain-https).
  Links Lumo writes outside the app — CLI output, GitHub comments, notices —
  use `LUMO_PUBLIC_URL`, which compose defaults to the app URL. If you can,
  have the proxy refuse
  `/.well-known/workflow/v1/flow` and `/step` from outside (they are already
  protected by `WORKFLOW_SECRET`; see [workflow.md](workflow.md)).
- **One app instance** is what this file runs and the only setup that has
  been tested: every start runs the migrations, files are on the app's
  `blob-data` volume, and every instance also runs a workflow worker and
  re-enqueues active runs when it boots. Several replicas would need shared
  storage (`BLOB_STORAGE=s3`) and `REDIS_URL`, and are untested. Never drop `REDIS_URL` with more than one instance:
  the in-memory fallback counts per process (the effective limit becomes N ×
  the configured one) and resets on every restart.
- **Scheduled jobs** run in `cron` against `http://app:3000`. Turn jobs off
  with `LUMO_CRON_DISABLED=<name>,<name>` in `.env` (details in
  [cron.md](cron.md)).
- **Logs**: `docker compose logs -f app cron`.
- **Data** lives in the named volumes `postgres-data` and `blob-data`
  (`caddy-data` holds Caddy's certificates). `docker compose down` keeps them; `down -v` deletes them.

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

Set the matching variables in `.env` (`REDIS_URL`; `BLOB_STORAGE=s3` with
`S3_*`; for your own Pusher-protocol server `PUSHER_*` and
`NEXT_PUBLIC_PUSHER_*` without `--realtime` — see `.env.example`). For your own Postgres edit
the entries under `x-app-env` in `docker-compose.yml` (keep a **direct**
connection for `WORKFLOW_POSTGRES_URL`, and drop `sslmode=disable` if the
server has TLS).
