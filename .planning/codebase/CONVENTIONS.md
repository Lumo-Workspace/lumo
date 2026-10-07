# Coding Conventions

**Analysis Date:** 2026-04-09

## Naming Patterns

**Files:**

- Services: `{domain}.service.ts` (e.g., `document.service.ts`, `invite.service.ts`)
- Repositories: `{domain}.repository.ts` (e.g., `document.repository.ts`, `member.repository.ts`)
- Hooks: `use{Feature}.ts` (e.g., `useMyTasks.ts`, `useTaskDetailActions.ts`)
- Test files: `{name}.test.ts` (e.g., `document.repository.test.ts`)
- API routes: Mimic file structure under `app/api/` with `route.ts` (e.g., `app/api/documents/route.ts`)

**Functions:**

- camelCase for all functions and methods
- Service functions: descriptive verbs (e.g., `createDocument()`, `getInviteByToken()`, `deleteWithDescendants()`)
- Private helpers: prefixed with nothing but declared outside exported objects (see `resolveClerkName()` pattern in `lib/services/`)
- Repository methods: query-oriented (e.g., `findByWorkspace()`, `findWithPermission()`, `findFirst()`)

**Variables:**

- camelCase for local variables, state, and parameters
- SCREAMING_SNAKE_CASE for constants (e.g., `RESERVED_SLUGS`, `CACHE_KEY`)
- Descriptive names: `mockFindByWorkspace` (in tests), `allClerkIds` (in service logic)

**Types:**

- PascalCase for interfaces and type aliases
- Suffixes: `Props` for component props (e.g., `AuroraBackgroundProps`), `Input`/`Output` for service I/O (e.g., `CreateDocumentInput`, `UpdateDocumentInput`)
- Database models: Imported from `@prisma/client` (e.g., `DocVisibility`, `DocShareRole`)

## Code Style

**Formatting:**

- Prettier enforces: 2 spaces indentation, 80 character line width, single quotes, no semicolons, trailing commas (ES5)
- Config: `.prettierrc` with `"semi": false, "singleQuote": true, "tabWidth": 2, "printWidth": 80`

**Linting:**

- Next.js ESLint + Prettier integration
- Next.js lint configuration enforces React best practices
- Lint command: `npm run lint`, fix: `npm run lint:fix`
- lint-staged hooks: `*.{js,jsx,ts,tsx}` → `eslint --fix` + `prettier --write`; `*.{json,md,yml,yaml}` → `prettier --write`

**TypeScript:**

- Strict mode enabled (enforced by project)
- Use `as const` for readonly object literals (see `DOCUMENT_LIST_INCLUDE`, `DOCUMENT_DETAIL_INCLUDE` in repositories)
- Prefer type inference; explicit type annotations where clarity matters

## Import Organization

**Order:**

1. React and Next.js imports (e.g., `import { useState } from 'react'`, `import { NextRequest, NextResponse } from 'next/server'`)
2. Third-party libraries (e.g., `import { z } from 'zod'`; SDKs with a `@/lib` wrapper — Clerk → `@/lib/auth`, `@vercel/functions` → `@/lib/runtime`, blob SDKs → `@/lib/blob` — are imported only through it)
3. Absolute path imports from `@/` (e.g., `import { documentRepository } from '@/lib/repositories/document.repository'`)
4. Relative imports (rarely used; prefer absolute)

**Path Aliases:**

- `@/` → root directory (configured in Next.js/TypeScript)
- Always import from `@/lib/repositories/`, `@/lib/services/`, `@/lib/api-client/`, not from nested paths
- Import from barrel files (`@/lib/api-client`) for client exports; import submodules directly for services/repositories

**Avoid:**

- Default imports; use named exports always
- Importing entire modules when specific functions are needed
- Circular imports (architect layering to prevent: Component → API Client → API Route → Service → Repository)

## Error Handling

**Pattern:**
Services throw errors with attached HTTP status:

```typescript
throw Object.assign(new Error('Document not found'), { status: 404 })
throw Object.assign(new Error('Permission denied'), { status: 403 })
throw Object.assign(new Error('Only the owner can delete a document'), {
  status: 403,
})
```

**Where applied:**

- `lib/services/` files (all validation, business logic errors)
- Not in repositories (they return data or null)
- Not in components (they call API clients which handle errors)

**Status codes:**

- `404` for resource not found
- `403` for permission denied
- `400` for invalid input (validation)

**API Client:**

- Custom `ApiClientError` class in `lib/api-client/base.ts` with `status` and `code` properties
- `apiFetch<T>()` throws on non-ok responses; parses error message from response body
- `apiFetchQuiet()` swallows errors silently for fire-and-forget mutations

## Logging

**Framework:** `console.log` only in test/debug code; forbidden in production. No formal logger configured yet.

**Patterns:**

- Services and repositories should not log; return errors instead
- Components should not log; handle via callback/state
- When logging is needed: Use `console.error()` for errors, `console.warn()` for warnings

## Comments

**When to Comment:**

- Complex business logic (e.g., permission checks, state transitions)
- Non-obvious algorithm choices
- Links to related issues/PRs

**Format:**

- Use `// ── Section Name ────────────────────` dividers in files with multiple sections (repositories, services)
- Use `/** Description */` JSDoc for exported functions
- Inline comments explain "why," not "what"

**Example from code:**

```typescript
// Batch-fetch Clerk user profiles
const allClerkIds = new Set<string>()
```

```typescript
// Handles three cache formats:
//   1. new:    { taskIds, myTasksViewId }
//   2. legacy: { tasks: MyTask[], myTasksViewId }
//   3. oldest: MyTask[]
```

## Function Design

**Size:** Keep functions under 100 lines; extract helpers for readability

**Parameters:**

- Named parameters via objects for >2 arguments
- Zod schemas for API input validation (e.g., `createDocumentSchema`, `updateTaskSchema`)
- Pass only needed data; avoid passing entire objects (follow ISP principle)

**Return Values:**

- Repositories return Prisma query results with `select` for specific fields
- Services return shaped DTOs/objects, never raw Prisma models
- Async functions use `async/await`, never `.then()`

**Example (from `document.service.ts`):**

```typescript
async listDocuments(
  workspaceId: string,
  memberId: string,
  filters?: DocumentFilters
) {
  const documents = await documentRepository.findByWorkspace(...)
  // ... enrich with Clerk data
  return documents.map(doc => ({ ...doc, createdBy: {...} }))
}
```

## Module Design

**Exports:**

- Named exports only (no default exports)
- Services/repositories export a single named object: `export const documentService = { ... }`
- API clients export named functions: `export async function apiFetch<T>() { ... }`

**Barrel Files:**

- `lib/api-client/` uses barrel index for client-side imports
- Services/repositories imported directly by path (not from barrel) to prevent circular dependencies

**Prisma Queries:**

- Always use `select` to fetch only needed fields (ISP principle)
- Define reusable include/select objects as constants at module top: `const DOCUMENT_LIST_INCLUDE = { ... }`
- Never use raw SQL; always use Prisma methods

## React/Component Conventions

**Component Naming:**

- PascalCase for all components: `<DocumentList />`, `<TaskCard />`, `<AlertDialog />`
- Functional components only (no class components)

**Props:**

- Define `Props` interface when props exceed 3 items
- Use composition (children, slots) instead of flag props
- Destructure props; avoid spreading `{...props}` when selective control needed

**Hooks Usage:**

- Hooks called at top level of functional components only
- No hooks inside loops, conditionals, or callbacks
- Custom hooks follow `use*` naming convention
- Never pass hooks as values or props; call them directly

**Purity:**

- Components must be idempotent: same inputs → same output
- No `new Date()`, `Math.random()`, or non-deterministic calls during render
- Move side effects to `useEffect` or event handlers
- Never mutate props or state directly; create new copies

**Direct DOM/Component Calls:**

- Never call components as functions: `MyComponent()` ❌
- Always use JSX: `<MyComponent />` ✓
- Never dynamically create/wrap hooks; define static versions upfront

## Design Principles (SOLID + LoD)

**SRP (Single Responsibility):**

- Each component, hook, or function does one thing
- Separate concerns: data fetching (API client) → business logic (service) → rendering (component)
- Example: `documentRepository` only queries; `documentService` enriches and validates; component only renders

**OCP (Open/Closed):**

- Extend via composition (children, props, hooks), not modification
- Add new component variants (e.g., `<PrimaryButton />`) instead of adding flags to existing ones
- Use higher-order components or context for cross-cutting concerns

**LSP (Liskov Substitution):**

- Component variants must honor the same props contract
- A `<SecondaryButton>` must work wherever `<PrimaryButton>` is used

**ISP (Interface Segregation):**

- Pass only props a component needs, not entire objects
- Prisma: use `select` to fetch only required fields, not whole records
- Example: pass `userId` instead of entire user object

**DIP (Dependency Inversion):**

- Components depend on abstractions (hooks, context), not implementations
- Import from `@/lib/` wrappers, not directly from third-party SDKs (e.g., use `tasksClient` from api-client, not direct fetch)

**LoD (Law of Demeter):**

- Components should not reach deep into nested props
- Parent extracts flat values and passes them: `<TaskCard title={task.title} assignee={task.assignee.name} />`
- Not: `<TaskCard task={task} />` then access `task.project.workspace.slug` inside

## Validation

**Input Validation:**

- Use Zod schemas for all API input (e.g., `createDocumentSchema`, `updateTaskSchema`)
- Define schemas in `lib/validation/schemas.ts`
- API routes call `schema.safeParse()` and handle errors via `zodError()` helper

**Database Validation:**

- Enforce via Prisma schema and migrations
- Services validate business rules (e.g., "only owner can delete")

---

_Convention analysis: 2026-04-09_
