# CLAUDE.md

## Project

This is Lumo - a project management tool for small dev teams.
Stack: Next.js 14 (App Router), TypeScript, Prisma, Neon Postgres, Clerk auth, Tailwind CSS, shadcn/ui.

## Code Style

- TypeScript strict mode
- Use async/await, not .then()
- No console.log in production code, use proper logging
- Prefer named exports over default exports
- Use Prisma for all database access — never raw SQL

## Testing

- Use Jest (configured in jest.config.js)
- Test files go in **tests** directory
- File naming: \*.test.ts
- Run tests: npm test
- Every new function needs at least one test

## Git

- Branch naming: lumo/{task-id}-{short-description}
  Example: lumo/LUM-12-add-oauth-login
- PR title format: feat/fix/chore: description [LUM-N]
  Example: feat: add Google OAuth login [LUM-12]
- Commit message: type: description [LUM-N]
  Example: chore: add CLAUDE.md for agent instructions [LUM-5]
- Never push directly to main or develop

## Project Structure

- app/ → Next.js App Router pages and API routes
- components/ → Shared UI components (shadcn/ui based)
- lib/ → Server-side utilities, auth helpers, DB queries
- prisma/ → Schema and migrations
- types/ → Shared TypeScript types

## Forbidden

- Never modify .env or .env.local files
- Never delete files in prisma/migrations/
- Never install new npm packages without noting it in PR description
- Never hardcode API keys or secrets
- Never push to main or develop directly

## PR Checklist

- [ ] Tests written and passing
- [ ] No TypeScript errors (npx tsc --noEmit)
- [ ] No console.log statements
- [ ] Branch name follows convention lumo/{task-id}-{description}
- [ ] PR title includes task ID [LUM-N]
