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

## Design Principles (SOLID + LoD)

- **SRP**: Each component, hook, or function does one thing. Don't mix data fetching, business logic, and rendering in a single component.
- **OCP**: Extend via composition (children, props, hooks), not by modifying existing components. Add new variants instead of adding flags to existing ones.
- **LSP**: Component variants must honor the same props contract. A `<PrimaryButton>` must be swappable with `<SecondaryButton>` without breaking callers.
- **ISP**: Pass only the props a component needs, not entire objects. Use `select` in Prisma queries to fetch only required fields.
- **DIP**: Components depend on abstractions (hooks, context) not implementations. Import from `@/lib/` wrappers, not directly from third-party SDKs.
- **LoD**: Components should not reach deep into nested props (`task.project.workspace.slug`). Parent extracts and passes flat values.

## React Rules

### Hooks

- Only call Hooks at the top level of function components or custom hooks
- Never call Hooks inside loops, conditionals, nested functions, try/catch, or after early returns
- Never call Hooks from regular JS functions, class components, or event handlers
- Never call Hooks inside callbacks passed to useMemo, useReducer, or useEffect

### Purity

- Components and Hooks must be idempotent — same inputs → same output, no side effects during render
- No `new Date()`, `Math.random()`, or other non-deterministic calls during render; move to useEffect or event handlers
- Never mutate props, state, or Hook return values directly — always create new copies
- Local mutation (variables created within the same render) is fine
- Side effects belong in event handlers or useEffect, never in render logic

### Component & Hook Calling

- Never call component functions directly (`Article()`); always use JSX (`<Article />`)
- Never pass Hooks as values or props — always call them directly inline
- Never dynamically create or wrap Hooks at runtime; define static versions upfront

## Layered Architecture

数据流: `Component → API Client → API Route → Service → Repository → Prisma/DB`

| 层             | 位置                | 职责                                            | 禁止                           |
| -------------- | ------------------- | ----------------------------------------------- | ------------------------------ |
| **Repository** | `lib/repositories/` | 封装 Prisma 查询，返回领域模型                  | 不含业务逻辑、不做权限校验     |
| **Service**    | `lib/services/`     | 业务逻辑编排：状态机、校验、通知触发            | 不直接访问 Prisma，不处理 HTTP |
| **API Route**  | `app/api/`          | 参数解析、Zod 校验、调用 Service、返回 Response | 不含业务逻辑，不含 Prisma 查询 |
| **API Client** | `lib/api-client/`   | 封装 fetch()，统一错误处理，类型安全            | 不含 UI 逻辑                   |
| **Component**  | `components/`       | 渲染 UI、调用 API Client、管理 UI 状态          | 不直接 fetch，不含业务逻辑     |

- API routes should be thin (~50-100 lines): auth check → validate input → call service → return response
- Services throw errors with `Object.assign(new Error(msg), { status })` pattern
- Repositories return Prisma query results, use `select` to fetch only needed fields
- New domain logic goes in `lib/services/`, never in API routes or components

## Project Structure

- app/ → Next.js App Router pages and API routes
- components/ → Shared UI components (shadcn/ui based)
- lib/ → Server-side utilities, auth helpers, DB queries
  - lib/repositories/ → Data access layer (Prisma queries)
  - lib/services/ → Business logic layer
  - lib/api-client/ → Frontend API client
  - lib/validation/ → Zod schemas (per domain)
- prisma/ → Schema and migrations
- types/ → Shared TypeScript types
- shared/ → Cross-project types, errors, constants (used by main app + agent-server)

## Forbidden

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
