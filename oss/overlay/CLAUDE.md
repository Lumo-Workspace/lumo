# CLAUDE.md

Instructions for AI coding agents (and humans) contributing to Lumo.

## Project

Lumo is a project management tool for small dev teams.
Stack: Next.js (App Router), TypeScript, Prisma, Postgres, Better Auth (default) or Clerk (`AUTH_PROVIDER`), Tailwind CSS, shadcn/ui.

## Code Style

- Use async/await, not .then()
- No console.log in production code, use proper logging
- Prefer named exports over default exports
- Use Prisma for all database access — never raw SQL

## i18n

- All user-facing strings use react-intl (`intl.formatMessage`)
- Locale files live in `lib/i18n/` — when adding or updating a key, update **every** locale file, not just en.json and zh-CN.json
- Never use English as a fallback for non-English locales — provide a proper translation for each language
- To scaffold the other locales after editing `en.json`, run `npm run i18n:sync` — it back-fills missing keys with `[TODO:<locale>] …` placeholders so the parity test passes; replace the `[TODO:…]` markers with real translations before submitting (never leave the English placeholder). Use `npm run i18n:check` to detect drift without writing.

## Testing

- Use Jest; new tests go under `__tests__/` (a small legacy `tests/` tree also runs)
- File naming: \*.test.ts
- Run tests: npm test
- Every new function needs at least one test
- Before opening a pull request: `npm test` and `npx tsc --noEmit --incremental false` pass, and `npm run lint` is clean

## Git

- Branch from `main`; one topic per branch and pull request
- Commit messages and PR titles: `type: description` with `type` one of feat / fix / chore / docs / refactor / test
  Example: feat: add Google OAuth login
- Never push to `main` directly; open a pull request

## Design Principles (SOLID + LoD)

Apply SOLID + Law of Demeter. Lumo-specific house rules:

- One responsibility per unit — don't mix data fetching, business logic, and rendering in one component (SRP).
- Extend via composition and new variants, not flags on existing components; variants honor the same props contract (OCP/LSP).
- Pass only the props a component needs; use Prisma `select` to fetch only required fields (ISP).
- Depend on abstractions: import from `@/lib/` wrappers, never third-party SDKs directly (DIP).
- Don't reach into nested props (`task.project.workspace.slug`) — parent extracts and passes flat values (LoD).

## React Rules

Follow React's canonical [Rules of Hooks and render purity](https://react.dev/reference/rules). The recurring trap here is impure render — no `new Date()` / `Math.random()` / prop-or-state mutation during render; side effects belong in event handlers or `useEffect`.

## Layered Architecture

Data flow: `Component → API Client → API Route → Service → Repository → Prisma/DB`

| Layer          | Location            | Responsibility                                                     | Must not                                    |
| -------------- | ------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| **Repository** | `lib/repositories/` | Wrap Prisma queries, return domain models                          | Contain business logic or permission checks |
| **Service**    | `lib/services/`     | Business logic: state machines, validation, notifications          | Access Prisma directly or handle HTTP       |
| **API Route**  | `app/api/`          | Parse params, validate with Zod, call a service, return a Response | Contain business logic or Prisma queries    |
| **API Client** | `lib/api-client/`   | Wrap fetch(), unified error handling, type safety                  | Contain UI logic                            |
| **Component**  | `components/`       | Render UI, call the API client, manage UI state                    | Fetch directly or contain business logic    |

- API routes should be thin (~50-100 lines): auth check → validate input → call service → return response
- Services throw errors with `Object.assign(new Error(msg), { status })` pattern
- New domain logic goes in `lib/services/`, never in API routes or components

## Project Structure

Standard Next.js App Router layout. Only the non-obvious bits:

- `lib/` is split per the Layered Architecture table above (`repositories/` · `services/` · `api-client/`), plus `lib/validation/` → Zod schemas per domain.
- `shared/` → types/errors/constants shared by the app and the CLI (`cli/`, published as `@lumoai/cli`).

## Database Migrations

- **Dev**: schema changes are applied locally via `prisma migrate dev`. If the dev DB has stale checksum drift on a previously-applied migration (Prisma rejects with P3008 / P3012), the workaround is: hand-write the SQL into `prisma/migrations/<timestamp>_<name>/migration.sql`, apply with `npx prisma db execute --file <path>`, record with `npx prisma migrate resolve --applied <name>`, then `npx prisma generate`. **Never** `prisma migrate reset` or direct-UPDATE `_prisma_migrations` without explicit user approval.
- **Production**: migrations are normally applied **only** by CI/CD running `prisma migrate deploy` on deploy — that is the default path. Do not apply a migration to production manually unless the user **explicitly authorizes it in the current session** (a generic standing approval doesn't count). Even with authorization: (a) confirm the exact migration(s) about to apply and call out any data-destructive steps before running anything, (b) use **only** `prisma migrate deploy` — never `migrate dev`, `db push`, `migrate reset`, or direct edits to `_prisma_migrations`, (c) verify with `prisma migrate status` against the prod URL afterward.
- A merged PR with a new migration ≠ production is migrated. Production is migrated only after the deploy completes. After merging a schema-change PR, verify the migration applied on prod (deploy log, or `prisma migrate status` against the prod URL).
- When opening a PR with a schema change, mention in the description what production needs (e.g. "requires `migrate deploy` on next deploy", or call out any data-deletion the migration performs).

## CLI & Skill docs

- When you change a command under `cli/src/commands/` (new subcommand, flag, output format, trigger condition), update `.claude/skills/lumo/SKILL.md` and its `references/` in the same pull request — agents decide how to call the CLI from these docs, so drift causes repeated failures.
  - Keep the frontmatter `description` category-level and under 1000 characters; put new usage triggers in the matching section's "When to suggest".
  - Keep the `##` / `###` sections in step with the real behavior (flags, examples, empty-string semantics, status enums).
- Exceptions: pure internal refactors, error-copy tweaks and bug fixes that don't change how the command is called.
- When the command tree changes (commands or flags added, renamed or removed), regenerate the snapshot in the same pull request with `npx tsx scripts/cli-grammar/emit-grammar.ts`; the `grammar-drift` and `doc-examples` tests in `scripts/cli-grammar/__tests__/` fail until `grammar.json` and the skill docs match the CLI.
- The local commit-msg hook (`scripts/drift-check.ts`) prints a non-blocking reminder when a commit stages `cli/src/commands/**` without touching the skill docs; add `[skip-drift]` to the commit message when the change is one of the exceptions above.

## Forbidden

- Never delete files in prisma/migrations/
- Never install new npm packages without noting it in PR description
- Never hardcode API keys or secrets
- Never push to main or develop directly
