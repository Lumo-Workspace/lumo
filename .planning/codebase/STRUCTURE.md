# Codebase Structure

**Analysis Date:** 2026-04-09

## Directory Layout

```
lumo/
├── app/                          # Next.js App Router pages & API routes
│   ├── layout.tsx                # Root layout with Providers
│   ├── globals.css               # Global Tailwind + styles
│   ├── signup/                   # Clerk signup page
│   ├── workspace/                # Workspace layout & pages
│   │   └── [workspaceUrl]/       # Dynamic workspace routes
│   │       ├── layout.tsx        # Workspace layout wrapper
│   │       ├── WorkspaceApp.tsx  # Client-side app shell (tabs, modals, state)
│   │       ├── IntlWrapper.tsx   # i18n provider for workspace
│   │       ├── types.ts          # Workspace-specific types (Page, ApiTask, etc.)
│   │       ├── utils.ts          # Workspace utilities (project slug, etc.)
│   │       ├── utils/            # Subdomain utilities (sortTasks, filterCompletedTasks)
│   │       ├── hooks/            # Custom hooks (useTaskStore, useProjects, usePusher)
│   │       ├── components/       # Page-specific components (TaskDetail, Sidebar, etc.)
│   │       ├── projects/         # Project pages
│   │       ├── my-tasks/         # My tasks page
│   │       ├── dashboard/        # Dashboard page
│   │       ├── documents/        # Document pages
│   │       ├── inbox/            # Inbox page
│   │       ├── drafts/           # Drafts page
│   │       ├── settings/         # Workspace settings
│   │       └── project/          # Individual project & task routes
│   └── api/                      # API endpoints
│       ├── tasks/                # Task CRUD and operations
│       ├── projects/             # Project CRUD
│       ├── drafts/               # Draft operations
│       ├── documents/            # Document operations
│       ├── comments/             # Comment CRUD
│       ├── user/                 # User settings, API keys
│       ├── workspace/            # Workspace operations
│       ├── agent/                # Agent execution API
│       ├── integrations/         # Integration endpoints (Slack commands, etc.)
│       ├── webhooks/             # External webhooks (GitHub)
│       └── waitlist/             # Marketing waitlist
├── components/                   # Shared React components
│   ├── core/                     # Core providers
│   │   └── Providers.tsx         # ClerkProvider, ThemeProvider
│   ├── ui/                       # shadcn/ui components (button, card, etc.)
│   ├── task/                     # Task-specific components
│   └── landing/                  # Landing page components
├── lib/                          # Server-side utilities & business logic
│   ├── api/                      # API route helpers
│   │   └── helpers.ts            # requireWorkspaceByUrl, zodError, etc.
│   ├── api-client/               # Client-side API wrappers
│   │   ├── base.ts               # apiFetch helper
│   │   ├── index.ts              # Barrel export
│   │   ├── tasks.ts              # Task API client
│   │   ├── projects.ts           # Project API client
│   │   ├── documents.ts          # Document API client
│   │   └── [domain].ts           # Domain-specific clients
│   ├── auth/                     # Authentication helpers
│   │   ├── index.ts              # requireAuth, requireWorkspaceMember, getUserWorkspace
│   │   └── mcp-auth.ts           # Agent-server MCP auth
│   ├── db/                       # Database
│   │   └── prisma.ts             # Prisma singleton client
│   ├── repositories/             # Data access layer (Prisma)
│   │   ├── index.ts              # Barrel export
│   │   ├── task.repository.ts    # Task queries
│   │   ├── project.repository.ts # Project queries
│   │   ├── comment.repository.ts # Comment queries
│   │   └── [entity].repository.ts # Entity-specific repos
│   ├── services/                 # Business logic layer
│   │   ├── index.ts              # Barrel export
│   │   ├── types.ts              # Service input/output types
│   │   ├── task.service.ts       # Task orchestration (create, update, PR sync)
│   │   ├── project.service.ts    # Project operations
│   │   ├── notification.service.ts # Notification dispatch
│   │   └── [domain].service.ts   # Domain services
│   ├── validation/               # Input validation
│   │   └── schemas.ts            # Zod schemas (createTaskSchema, updateProjectSchema, etc.)
│   ├── integrations/             # Third-party integrations
│   │   ├── github/               # GitHub integration
│   │   │   ├── index.ts          # Barrel export (CRITICAL: only exports public API)
│   │   │   ├── auth.ts           # Token management
│   │   │   ├── branch.ts         # Branch naming & parsing
│   │   │   ├── webhooks.ts       # Webhook creation/deletion
│   │   │   ├── sync.ts           # PR status sync
│   │   │   ├── verify.ts         # Webhook signature verification
│   │   │   └── types.ts          # GitHub types
│   │   ├── slack/                # Slack integration
│   │   │   ├── index.ts          # Barrel export
│   │   │   ├── notify.ts         # Send notifications (PUBLIC API)
│   │   │   ├── bot.ts            # Slack app adapter
│   │   │   ├── commands.ts       # Command handler
│   │   │   └── types.ts          # Slack types
│   │   ├── pusher/               # Real-time broadcasting
│   │   │   ├── index.ts          # Barrel export
│   │   │   ├── server.ts         # Server-side push events
│   │   │   └── types.ts          # Pusher event types
│   │   ├── sandbox/              # Code execution sandbox
│   │   │   ├── mcp.ts            # MCP tool wrapper
│   │   │   ├── proxy.ts          # Sandbox proxy
│   │   │   └── types.ts          # Sandbox types
│   │   └── types.ts              # Shared integration types
│   ├── events/                   # Event dispatch
│   │   ├── dispatcher.ts         # dispatchEvents
│   │   └── types/                # Event type definitions
│   ├── i18n/                     # Internationalization
│   │   ├── index.ts              # Intl setup
│   │   └── locales/              # Message catalogs
│   ├── notifications/            # In-app notification logic
│   │   ├── index.ts              # Notification queue
│   │   └── types.ts              # Notification types
│   ├── utils/                    # Shared utilities
│   │   ├── buildTaskUrl.ts       # URL building helpers
│   │   ├── similarity.ts         # Duplicate detection
│   │   └── [util].ts             # Other helpers
│   ├── task/                     # Task domain logic
│   │   ├── state-machine.ts      # Task status transitions (isValidTaskTransition)
│   │   └── types.ts              # Task domain types
│   ├── workspace/                # Workspace domain logic
│   │   └── types.ts              # Workspace types
│   ├── agent/                    # Agent server integration
│   │   ├── types.ts              # Agent request/response types
│   │   └── api.ts                # Calls to agent-server
│   ├── editor/                   # Rich text editor
│   │   └── tiptap-config.ts      # Tiptap setup
│   ├── quick-dispatch/           # Quick task creation
│   │   └── parser.ts             # Parse natural language task
│   ├── prompts/                  # AI prompt templates
│   │   └── [template].ts         # Prompt builders
│   └── summaries/                # Workspace summary logic
│       └── generator.ts          # Generate summaries
├── shared/                       # Shared types & errors (separate workspace)
│   ├── src/
│   │   └── index.ts              # AgentError, DomainEvent, ExecuteAgentRequest, etc.
│   └── package.json
├── agent-server/                 # Agent execution server (separate workspace)
│   ├── src/
│   │   ├── mcp-server.ts         # MCP tool definitions
│   │   ├── db/
│   │   │   └── prisma.ts         # Separate Prisma instance
│   │   ├── agent/                # Agent orchestration
│   │   │   ├── execute.ts        # Main execution loop
│   │   │   ├── state-machine.ts  # Agent task state machine
│   │   │   └── generate-spec.ts  # Spec generation
│   │   ├── auth/                 # Agent auth
│   │   │   └── mcp-auth.ts       # MCP authentication
│   │   └── api/                  # API client calls to main app
│   ├── package.json
│   └── node_modules/
├── types/                        # Global TypeScript types
│   ├── index.ts                  # Core business types (User, Project, Task, etc.)
│   ├── profile.ts                # User profile types
│   └── summary.ts                # Summary types
├── hooks/                        # Global custom hooks
│   ├── useEffect.ts              # React effect utilities
│   └── [hook].ts
├── utils/                        # Global utilities (not lib/)
│   ├── crypto.ts                 # Encryption/decryption helpers
│   └── [util].ts
├── __tests__/                    # Test files
│   ├── [entity].repository.test.ts
│   ├── [service].service.test.ts
│   ├── utils/
│   ├── auth/
│   └── jest-setup.ts
├── __mocks__/                    # Jest mocks
├── mcp/                          # MCP server (older; being migrated to agent-server)
│   ├── server.ts                 # Main MCP server
│   └── tools/                    # MCP tool implementations
├── prisma/                       # Database schema & migrations
│   ├── schema.prisma             # Prisma data model
│   └── migrations/               # Migration history (DO NOT DELETE)
├── public/                       # Static assets
├── styles/                       # Global styles
├── constants/                    # App constants
├── extensions/                   # Browser extensions (if any)
├── scripts/                      # Build/dev scripts
├── docs/                         # Project documentation
├── .planning/                    # Codebase mapping (GSD)
│   └── codebase/
│       ├── ARCHITECTURE.md       # Architecture overview (you are here)
│       ├── STRUCTURE.md          # Directory structure (you are here)
│       ├── CONVENTIONS.md        # Coding conventions
│       ├── TESTING.md            # Testing patterns
│       ├── STACK.md              # Technology stack
│       ├── INTEGRATIONS.md       # External integrations
│       └── CONCERNS.md           # Technical debt & issues
├── .husky/                       # Git hooks
├── .claude/                      # Claude codebase mapping tools
├── config/                       # Build config files
├── prisma.config.js              # Prisma configuration
├── next.config.js                # Next.js configuration
├── tailwind.config.ts            # Tailwind configuration
├── jest.config.js                # Jest configuration
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # Root dependencies
├── .gitignore                    # Git ignores
└── .env.example                  # Environment variables template (DO NOT COMMIT .env)
```

## Directory Purposes

**app/**

- Purpose: Next.js App Router pages, layouts, and API routes
- Dynamic segments: `[workspaceUrl]`, `[projectSlug]`, `[id]` for polymorphic routing
- Workspace layout contains the main app shell (WorkspaceApp.tsx)
- API routes are thin handlers that delegate to services

**components/**

- Purpose: Shared React components (UI and domain-specific)
- ui/: shadcn/ui components (reusable, non-domain-specific)
- task/: Task-specific components (TaskDetail, TaskList, etc.)
- core/: Providers and layout components
- landing/: Landing page component library

**lib/**

- Purpose: Server-side utilities, business logic, data access, integrations
- api-client/: Browser-safe API wrapper for fetching from API routes
- auth/: Clerk integration and permission checks
- db/: Prisma client singleton
- repositories/: Prisma queries, data access layer
- services/: Business logic orchestration, side effects
- validation/: Zod schemas, input validation
- integrations/: Third-party SDKs (GitHub, Slack, Pusher) with isolation
- events/: Domain event dispatch
- utils/: General-purpose utilities
- task/: Task state machine and domain types
- workspace/: Workspace domain types

**lib/integrations/**

- Purpose: Isolate third-party SDK usage and prevent server-code leakage to client
- Structure: Barrel export (`index.ts`) + submodules
- Rule: CRITICAL — Client components must import from submodules directly (e.g., `@/lib/integrations/slack/notify`), never from the barrel
- Reason: Barrels may re-export server-only code; submodule imports are tree-shakeable and explicit
- Implemented modules:
  - `github/`: Token management, branch naming, webhook creation, PR sync, webhook verification
  - `slack/`: Channel/DM notifications, bot adapter, command handler
  - `pusher/`: Real-time event broadcasting
  - `sandbox/`: Code execution sandbox proxy and MCP wrapper

**shared/**

- Purpose: Types and errors shared across main app and agent-server
- Exports: AgentError, DomainEvent, ExecuteAgentRequest, etc.
- Workspace: Separate monorepo workspace for independent versioning

**agent-server/**

- Purpose: AI-powered code execution orchestrator running in sandbox
- Key files:
  - `src/mcp-server.ts`: Exposes tools to Claude agent (get_task, list_tasks, etc.)
  - `src/agent/execute.ts`: Main execution loop and orchestration
  - `src/agent/state-machine.ts`: Agent task state transitions
  - `src/db/prisma.ts`: Separate Prisma instance for agent-server
- Communication: REST API calls to main app, Pusher broadcasts for real-time sync
- Workspace: Separate monorepo workspace with isolated dependencies

**types/**

- Purpose: Global TypeScript type definitions
- Core business types: User, Team, Project, Task, Story, etc.
- Not for component-local types; use inline types or `types.ts` in subdirectories

****tests**/**

- Purpose: Jest test files
- Location: Mirrors source structure (e.g., `__tests__/repositories/task.repository.test.ts`)
- Pattern: `*.test.ts` files co-located conceptually with their sources
- Coverage: Services, repositories, utilities; components tested in integration tests

****mocks**/**

- Purpose: Jest mock factories and fixtures
- Usage: `jest.mock('@module', () => require('@__mocks__/module'))`

**prisma/**

- Purpose: Database schema and migrations
- Files:
  - `schema.prisma`: Data model (DO NOT HAND-EDIT after first migration)
  - `migrations/`: Migration history (DO NOT DELETE)
- Workflow: Edit schema → `npx prisma migrate dev --name description` → commit migration

**.planning/codebase/**

- Purpose: GSD codebase mapping documents
- Regenerated by `/gsd-map-codebase` command
- Read by `/gsd-plan-phase` and `/gsd-execute-phase` for context

## Key File Locations

**Entry Points:**

- `app/layout.tsx`: Root layout, wraps with ClerkProvider and ThemeProvider
- `app/workspace/[workspaceUrl]/layout.tsx`: Workspace layout
- `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`: Client-side app shell (tabs, state, real-time)
- `app/api/tasks/[id]/route.ts`: Example API route (GET, PATCH, DELETE task)

**Configuration:**

- `.env.example`: Environment variables template (copy to `.env` locally)
- `tsconfig.json`: TypeScript configuration
- `next.config.js`: Next.js app config (build optimizations, etc.)
- `tailwind.config.ts`: Tailwind CSS customization
- `jest.config.js`: Jest test runner config
- `prisma/schema.prisma`: Database schema

**Core Logic:**

- `lib/repositories/task.repository.ts`: Task data access
- `lib/services/task.service.ts`: Task business logic (creation, updates, PR sync, notifications)
- `lib/services/notification.service.ts`: Notification orchestration (email, Slack, in-app)
- `lib/integrations/github/auth.ts`: GitHub token management
- `lib/integrations/slack/notify.ts`: Slack notification sending
- `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`: Main app state container

**Testing:**

- `__tests__/[entity].repository.test.ts`: Repository tests (Prisma queries)
- `__tests__/[entity].service.test.ts`: Service tests (business logic)
- `__tests__/utils/`: Utility function tests
- `jest.config.js`: Jest configuration
- `jest-setup.ts`: Global test setup

## Naming Conventions

**Files:**

- Components: PascalCase.tsx (e.g., `TaskDetail.tsx`, `AppSidebar.tsx`)
- Utilities: camelCase.ts (e.g., `buildTaskUrl.ts`, `calculateDueDate.ts`)
- Repositories: camelCase.repository.ts (e.g., `task.repository.ts`)
- Services: camelCase.service.ts (e.g., `task.service.ts`)
- Hooks: camelCase.ts in hooks/ (e.g., `useTaskStore.ts`, `usePusher.ts`)
- Tests: \*.test.ts (e.g., `task.service.test.ts`)
- Schemas: schemas.ts (centralized in lib/validation/)

**Directories:**

- Feature directories: kebab-case (e.g., `api-client/`, `pull-requests/`)
- Component directories: kebab-case (e.g., `my-tasks/`, `task-detail/`)
- Modules in lib: camelCase or kebab-case (e.g., `quick-dispatch/`, `task/`)

**Types:**

- Domain models: PascalCase (e.g., `Task`, `Project`, `Member`)
- Enums: UPPERCASE (e.g., `TaskStatus`, `Priority`)
- Interfaces: PascalCase with `I` prefix optional (e.g., `CreateTaskInput`, `UpdateTaskInput`)
- Generic parameters: Single uppercase letter (T, U) or descriptive (TTask, TService)

**Variables & Functions:**

- Constants: UPPERCASE (e.g., `MAX_TASK_LENGTH`, `DEFAULT_PAGE_SIZE`)
- Functions: camelCase (e.g., `buildTaskUrl()`, `calculateDueDate()`)
- React hooks: camelCase with `use` prefix (e.g., `useTaskStore()`, `usePusher()`)
- React components: PascalCase (e.g., `TaskDetail`, `AppSidebar`)

## Where to Add New Code

**New Feature:**

- Primary code: `lib/services/` (new service file, e.g., `lib/services/feature.service.ts`)
- Data access: `lib/repositories/` (extend existing or add new, e.g., `lib/repositories/feature.repository.ts`)
- Validation: `lib/validation/schemas.ts` (add Zod schema)
- API routes: `app/api/feature/` (create routes matching feature)
- Components: `app/workspace/[workspaceUrl]/components/` (feature-specific components)
- Tests: `__tests__/feature.service.test.ts` and `__tests__/feature.repository.test.ts`

**New Component/Module:**

- Shared component: `components/[domain]/ComponentName.tsx` or `components/ui/` if generic
- Workspace-specific component: `app/workspace/[workspaceUrl]/components/ComponentName.tsx`
- Implementation: Follow SOLID principles (single responsibility, composition over inheritance)
- Props: Be explicit; don't pass entire objects (avoid `<TaskDetail task={fullTask} />`; instead `<TaskDetail id={id} title={title} />`)

**Utilities:**

- Shared helpers: `lib/utils/` (for server-side utilities like `buildTaskUrl.ts`)
- Domain logic: `lib/task/`, `lib/workspace/` (for state machines, domain types)
- Client-side helpers: `utils/` root directory (e.g., `utils/crypto.ts` for browser crypto)

**API Routes:**

- Grouping: By resource (tasks, projects, documents, etc.)
- Route structure: `app/api/[resource]/[id]/[action]/route.ts`
- Thin handlers: Auth check → validate → call service → return response
- Example: `app/api/tasks/[id]/route.ts` handles GET, PATCH, DELETE
- Sub-resource: `app/api/tasks/[id]/comments/route.ts` for comments under a task

**Tests:**

- Location: `__tests__/` directory (mirrors source structure conceptually)
- Naming: `[entity].test.ts` (e.g., `task.service.test.ts`)
- Pattern: Jest with @testing-library for components
- Coverage: Unit tests for services/repos; integration tests for API routes

## Barrel vs. Submodule Import Patterns

**Barrel Exports (index.ts):**

- Used in: `lib/repositories/index.ts`, `lib/services/index.ts`, `lib/api-client/index.ts`
- Pattern: Re-export named exports from submodules
- When to use: Stable, server-side only, no risk of tree-shaking
- Example:
  ```typescript
  // lib/repositories/index.ts
  export { taskRepository } from './task.repository'
  export { projectRepository } from './project.repository'
  ```

**Submodule Imports (CRITICAL for Integrations):**

- Used in: `lib/integrations/` submodules
- Pattern: Import directly from feature module, not barrel
- When to use: Risk of server-code leakage, need tree-shakeable imports
- Example:

  ```typescript
  // CORRECT: Client component
  import { sendChannelNotification } from '@/lib/integrations/slack/notify'

  // WRONG: Would bundle entire barrel including server-only code
  // import { sendChannelNotification } from '@/lib/integrations/slack'
  ```

**Integration Barrel Rule:**

- Reason: Barrel exports might re-export server-only submodules
- Client components importing from barrel get server code in bundle
- Solution: Always import from specific submodule
- Review: Check `lib/integrations/[service]/index.ts` before importing from it

## Special Directories

**prisma/migrations/**

- Purpose: Track database schema changes over time
- Generated: `npx prisma migrate dev` creates new files
- Committed: YES, always commit migrations
- Rule: NEVER DELETE migration files; only add new ones
- Workflow: Schema change → `prisma migrate dev --name description` → test → commit

**agent-server/node_modules/** & **node_modules/**

- Purpose: Package dependencies
- Generated: `npm install` or `npm ci`
- Committed: NO, excluded in `.gitignore`

**.next/**

- Purpose: Next.js build cache
- Generated: `next build` or dev server
- Committed: NO, excluded in `.gitignore`

**.env**

- Purpose: Local environment variables (secrets, database URL, API keys)
- Generated: Copy from `.env.example` and fill in
- Committed: NO, excluded in `.gitignore`
- CRITICAL: Never commit `.env` with real secrets

---

_Structure analysis: 2026-04-09_
