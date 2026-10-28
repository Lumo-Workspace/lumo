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
- **Pull-request scanning.** Every pull request runs five layers before it
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

**Self-hosted:** one Docker Compose stack (Postgres with pgvector, Redis,
MinIO, Soketi), no third-party account needed:

```bash
cp .env.example .env
docker compose up -d --build
```

Fill in the required secrets in `.env` before `up` (the guide lists them);
database migrations run automatically on every `up`. The full guide is
[docs/self-hosting/README.md](docs/self-hosting/README.md), and
[docs/self-hosting/integrations.md](docs/self-hosting/integrations.md) covers
GitHub, Slack, Figma, Google Drive and Sentry.

## Development

Stack: Next.js (App Router), React, TypeScript, Prisma, Postgres 16 with
pgvector, Tailwind CSS + shadcn/ui. Sign-in is Better Auth (built in) or Clerk,
chosen with `AUTH_PROVIDER`.

```bash
npm install
cp .env.example .env.local   # fill in the REQUIRED section
npx prisma migrate deploy
npm run dev
```

Tests run with `npm test` (Jest). Conventions — layering, i18n, migrations,
commit and branch naming — are in [CLAUDE.md](CLAUDE.md); database migration
rules are in [docs/database-migrations.md](docs/database-migrations.md).

### Deploying to Vercel

`vercel.json` sets the build command to `scripts/deploy/vercel-build.sh`. On a
**production** deploy it runs `prisma migrate deploy` (plus a
`prisma migrate status` drift check) **before** `next build`, so migrations
land ahead of the code that depends on them and a failed migration fails the
build. Preview builds skip the migrate step.

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
