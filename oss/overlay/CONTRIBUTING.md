# Contributing to Lumo

Thanks for helping. This guide covers how a change gets from your fork into a
release, what the sign-off on every commit means, and the checks a pull request
has to pass. Security issues are the exception to all of it: **do not open a
public issue or pull request for a vulnerability** — follow
[SECURITY.md](SECURITY.md).

## How a contribution flows

1. **Open an issue first for anything larger than a small fix**, so we can agree
   on the approach before you spend time on it.
2. **Fork, branch from `main`, and open a pull request against `main`** of this
   repository. One topic per branch and pull request.
3. **Review happens here, in public.** Every pull request needs the `DCO` check
   (below) and a maintainer's approval. We squash-merge, so the pull request
   title becomes the commit subject.
4. **After the merge, a maintainer carries your change into Lumo's internal
   repository as a patch.** Lumo is developed in a private repository that also
   holds the hosted service's commercial plugin; this repository is published
   from it. The patch keeps you as the commit author and keeps your
   `Signed-off-by` trailer, and records which public commit it came from.
5. **The next release publishes a new snapshot of the code here**, which
   already contains your change. The release commit therefore does not undo or
   rewrite your merged commit; your commit stays in this repository's history.

## Developer Certificate of Origin (DCO)

Lumo uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
instead of a contributor license agreement. By adding a sign-off to a commit you
certify the statements in the DCO for that commit — in short, that you wrote
the change or otherwise have the right to submit it under the project's open
source license (the [MIT License](LICENSE)).

Sign off every commit with `-s`:

```bash
git commit -s -m "fix: keep the sprint end date inclusive"
```

which appends a trailer with your Git identity:

```
Signed-off-by: Your Name <you@example.com>
```

- The email in the trailer must be the commit's **author email**
  (`git config user.email`). The `DCO` check fails otherwise.
- Use your real name; anonymous or pseudonymous sign-offs are not accepted.
- Forgot to sign off? Fix the branch and force-push it:
  ```bash
  git rebase --signoff origin/main
  git push --force-with-lease
  ```
- Merge commits are exempt, and so are commits by the GitHub bot accounts
  Dependabot, Renovate and GitHub Actions — but only in a pull request that bot
  opened, and only when GitHub links the commit to that bot account. A
  maintainer reviews those pull requests. Every other commit needs a sign-off,
  whatever author email it carries.
- The check reads at most 250 commits per pull request (GitHub's limit) and
  fails a longer one; squash or split it.

## Development environment

- **Node.js 24** (the version the Docker image builds with) and npm.
- **Postgres.** The quickest local setup is the Docker Compose stack described
  in [docs/self-hosting/README.md](docs/self-hosting/README.md); you can also
  point `DATABASE_URL` at any Postgres you already run.

```bash
npm ci
cp .env.example .env        # fill in DATABASE_URL and the auth settings
npx prisma migrate dev      # apply migrations to your local database
npm run build:shared        # the app and the CLI import the compiled shared/
npm run dev                 # http://localhost:3000
```

`.env.example` documents every setting; optional services (GitHub, Slack,
Figma, Google Drive, Sentry, object storage) can stay unset — see
[docs/self-hosting/integrations.md](docs/self-hosting/integrations.md).

## Before you open a pull request

Run these locally; a pull request is reviewed only when they pass:

```bash
npm test                                  # Jest
npx tsc --noEmit --incremental false      # type check (no incremental cache)
npm run lint
```

- **Every new function needs at least one test.** Tests go under `__tests__/`
  and are named `*.test.ts` / `*.test.tsx`.
- **Pull request titles and commit subjects** use `type: description`, with
  `type` one of `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- **Schema changes** add a new migration under `prisma/migrations/`; never edit
  or delete an existing one. Say in the pull request what the migration does to
  existing data.
- **New npm dependencies** must be named, with the reason, in the pull request
  description.
- **Never commit secrets** — no real API keys, tokens or connection strings,
  not even in tests (use obviously fake placeholders).

## Code conventions

[CLAUDE.md](CLAUDE.md) holds the project's conventions; it is written for AI
coding agents but applies to everyone. The points reviewers check most often:

- **Layering:** `Component → API client → API route → service → repository →
Prisma`. API routes stay thin (auth, Zod validation, call a service);
  business logic lives in `lib/services/`; only repositories touch Prisma, and
  never with raw SQL.
- **i18n:** every user-facing string goes through react-intl, and every locale
  file in `lib/i18n/` gets a real translation (`npm run i18n:sync` scaffolds
  the keys; replace each `[TODO:…]` placeholder before submitting).
- **React:** follow the [Rules of React](https://react.dev/reference/rules) —
  no `new Date()`, `Math.random()` or mutation during render.
- **CLI:** a change under `cli/src/commands/` updates
  `.claude/skills/lumo/SKILL.md` (and its `references/`) in the same pull
  request, and regenerates `scripts/cli-grammar/grammar.json` when the command
  tree changes.
- Async/await rather than `.then()`, named exports, and no `console.log` in
  shipped code.

## License

By contributing, you agree that your contribution is licensed under the
project's [MIT License](LICENSE), as certified by your DCO sign-off.
