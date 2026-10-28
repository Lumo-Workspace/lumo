# Lumo

**Agentic project management for small dev teams that ship with coding agents.**

Your agents got 10x faster. Your review didn't. An agent says "done, all tests
pass", and you have no cheap way to check the claim — sometimes it deleted the
failing test, committed with `--no-verify`, or pasted a live key into a config
file. Lumo is built around one rule: **nothing closes on the agent's word.**

[Website](https://www.uselumo.ai) · [Self-hosting](docs/self-hosting/README.md) ·
[CLI](cli/) · [Discord](https://discord.gg/D7AYBagRk)

## What it does

- **Test cases as evidence.** Write the test cases (setup, steps, expected
  result) before the work starts. Every run appends its verdict, the
  environment, the commit it ran against, and screenshots. The log is
  append-only: a wrong verdict is corrected by adding a row, never by editing
  one. An agent can move a task to review; only a person closes it.
- **Boundary crossings.** `lumo init` installs hooks into Claude Code and
  Codex sessions. Deleting a test file, skipping hooks, pasting a secret or
  force-pushing to a protected branch is recorded the moment it happens,
  classified across 9 categories, and the irreversible ones are held before
  merge.
- **Pull-request scanning** (Lumo Cloud; part of the proprietary security
  plugin, see [License](#license)). Every pull request runs five layers before it
  merges — secrets (gitleaks), code scan (semgrep, zizmor, trivy),
  dependencies (osv-scanner), AI review, and an agent that hunts for a
  working exploit path. Findings land on the PR with a severity
  and a fingerprint. A finished layer means "checked", not "clean". Details:
  [docs/security-scan.md](docs/security-scan.md).
- **Cost and time.** Every agent run is metered to the token, per task, per
  agent and per model, with budget alerts — so a runaway loop shows up in
  minutes rather than on the invoice.
- **The planning layer.** Tasks, milestones, sprints with burn-up, docs, and
  team memory that agents read back on the next run.

Lumo is model-agnostic and connects to GitHub, Slack, Figma, Google Drive and
Sentry.

## Get started

**Hosted:** sign up at [uselumo.ai](https://www.uselumo.ai) — free for teams up
to 5 seats. Then, in your repository:

```bash
npm install -g @lumoai/cli
lumo auth login
lumo init
```

`lumo init` sets up the hooks for Claude Code and Codex in the current repo.

Prefer your own server? See [Self-hosting](#self-hosting) below.

## Self-hosting

Lumo runs on a single machine with Docker Compose: the app, Postgres
(pgvector), Redis, MinIO (file storage), Soketi (realtime) and a cron runner.
No third-party account is needed — users sign in with built-in email +
password accounts stored in your Postgres.

**Prerequisites**: Docker with Compose v2 and `openssl`. The images are
prebuilt for amd64 and arm64, so a small server is enough — nothing is
compiled on it.

```bash
git clone https://github.com/Lumo-Workspace/lumo.git && cd lumo
scripts/self-host/init.sh     # creates .env and generates every secret
docker compose up -d
```

Open <http://localhost:3000/signin>, choose **No account yet? Create one**,
then create a workspace.

On a real domain with HTTPS (DNS pointed at the server, ports 80 and 443
open):

```bash
scripts/self-host/init.sh --url https://lumo.example.com
docker compose --profile caddy up -d
```

`--url` sets every URL setting at once, and the `caddy` profile gets a
certificate and serves the app and its realtime socket on that one domain.
Changing the URL later needs no rebuild — re-run `init.sh --url` and
`docker compose up -d`. Then:

- **Configure email** (`SMTP_URL` or `RESEND_API_KEY`). Without it, nobody
  can verify an address, so workspace invites cannot be accepted. `init.sh`
  warns while it is missing.
- **Close sign-up** once your team has joined: `AUTH_DISABLE_SIGNUP=true`.

AI features, GitHub / Slack / Figma / Google Drive / Sentry and social
sign-in are optional; each is switched on by variables in `.env.example`
and degrades cleanly when unset.

Full guide — services, image versions, what works without optional
services, upgrades and backups:
[docs/self-hosting/README.md](docs/self-hosting/README.md). Integrations:
[docs/self-hosting/integrations.md](docs/self-hosting/integrations.md).
Scheduled jobs: [docs/self-hosting/cron.md](docs/self-hosting/cron.md).

## Local development

**Prerequisites**: Node.js 24 and npm (the repository is an npm workspace),
plus a Postgres 16 with the `vector` extension. The quickest way to get one:

```bash
docker run -d --name lumo-postgres -p 5432:5432 \
  -e POSTGRES_USER=lumo -e POSTGRES_PASSWORD=lumo -e POSTGRES_DB=lumo \
  pgvector/pgvector:pg16
```

Then:

```bash
npm install
cp .env.example .env
```

In `.env`, set:

- `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to
  `postgresql://lumo:lumo@localhost:5432/lumo?sslmode=disable`
- `BETTER_AUTH_SECRET` and `CRON_SECRET` to `openssl rand -hex 32` values

Use `.env` rather than `.env.local`: the Prisma CLI only reads `.env`.
Everything else in `.env.example` is optional and off until set.

```bash
npx prisma migrate deploy   # apply the existing migrations
npm run dev                 # http://localhost:3000
```

Without email configured, `next dev` writes sign-in codes and links to the
server log. Run the tests with `npm test` and type-check with
`npx tsc --noEmit`. Conventions for contributors (layering, i18n, tests,
migrations) are in [CLAUDE.md](CLAUDE.md).

## Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui + Radix UI primitives
- **Authentication**: Better Auth
- **Database**: PostgreSQL 16 with pgvector, via Prisma
- **Background jobs**: Workflow DevKit (Postgres World when self-hosted)
- **Realtime**: Pusher protocol (Pusher Channels or Soketi)
- **AI**: AI SDK — Vercel AI Gateway, or your own Anthropic / OpenAI-compatible endpoint
- **Data fetching**: TanStack Query; forms with React Hook Form + Zod
- **i18n**: react-intl
- **Testing**: Jest + React Testing Library

## Project structure

Data flows `Component → API Client → API Route → Service → Repository → Prisma`:

| Path                | What lives there                                       |
| ------------------- | ------------------------------------------------------ |
| `app/`              | Next.js routes; `app/api/` holds the thin API routes   |
| `components/`       | React components                                       |
| `lib/api-client/`   | Typed `fetch()` wrappers used by components            |
| `lib/services/`     | Business logic                                         |
| `lib/repositories/` | Prisma queries                                         |
| `lib/validation/`   | Zod schemas                                            |
| `lib/i18n/`         | Locale files                                           |
| `prisma/`           | Schema and migrations                                  |
| `cli/`              | The `lumo` CLI (`@lumoai/cli` on npm)                  |
| `shared/`           | Types and constants shared by the app and the CLI      |
| `deploy/self-host/` | Cron image and crontab for Docker Compose              |
| `docs/`             | Self-hosting, design system, database migrations, RFCs |

## Deploying to Vercel

`vercel.json` sets the build command to
`scripts/deploy/vercel-build.sh`, which on a **production** deploy runs
`prisma migrate deploy` (plus a `prisma migrate status` drift check)
**before** `next build`, so a failed migration fails the build instead of
shipping code against an old schema (LUM-682). Preview builds skip it.
Vercel needs a managed Postgres with pgvector (e.g. Neon) and the same
required variables as above.

## Reference

- [docs/github-app.md](docs/github-app.md) — the GitHub App's permissions,
  installation flow and access rechecks
- [docs/security-scan.md](docs/security-scan.md) — scanners, sandbox
  isolation, the exploit hunt, blocking policy and cost controls

## License

Lumo uses an open-core model. Everything in this repository is under the
[MIT License](LICENSE) **except the security plugin**: the [`ee/`](ee/)
directory and the other plugin files listed in `oss/manifest.json`. That plugin
— pull-request vulnerability checks and the advanced boundary-crossing
detection — is proprietary ([ee/LICENSE](ee/LICENSE)) and may only be used
under a separate agreement with Lumo AI; it runs on
[Lumo Cloud](https://www.uselumo.ai).

The Lumo CLI ([`cli/`](cli/), published to npm as `@lumoai/cli`) and the
shared code in [`shared/`](shared/) are MIT and carry their own copies of the
license ([cli/LICENSE](cli/LICENSE), [shared/LICENSE](shared/LICENSE)).

## Community and support

Ask questions and follow what's shipping on
[Discord](https://discord.gg/D7AYBagRk), open an issue here, or email
support@uselumo.ai.
