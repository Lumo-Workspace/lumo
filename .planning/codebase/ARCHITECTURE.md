# Architecture

**Analysis Date:** 2026-04-09

## Pattern Overview

**Overall:** Next.js 14 App Router with modular layered architecture (Next.js → API Client → API Route → Service → Repository → Prisma)

**Key Characteristics:**

- Server-side business logic separated from client-side UI
- Data flows unidirectionally through well-defined layers
- Integrations (GitHub, Slack, Pusher) isolated in `lib/integrations/` with barrel exports to prevent server-code leakage into client bundles
- Workspace-centric security model with Clerk authentication
- Agent server decoupled as separate workspace (`agent-server/`) for handling AI-powered task execution
- Monorepo structure with shared domain types in `shared/` workspace

## Layers

**Component Layer:**

- Purpose: Render UI, manage client-side state, invoke API client methods
- Location: `app/workspace/[workspaceUrl]/`, `components/`
- Contains: Page components, form handlers, modal dialogs, task editors, project views
- Depends on: `lib/api-client/`, hooks in workspace app (useTaskStore, useProjects, etc.), shadcn/ui components
- Used by: Browser; entry point is `app/layout.tsx` → `app/workspace/[workspaceUrl]/layout.tsx`

**API Client Layer:**

- Purpose: Type-safe fetch wrapper, unified error handling, HTTP method abstraction
- Location: `lib/api-client/`
- Contains: Request/response functions for each domain (tasks, projects, documents, workspaces, etc.)
- Depends on: `lib/api-client/base.ts` (apiFetch helper), types
- Used by: Page components and custom hooks in workspace app
- Pattern: `apiFetch<T>(url, options)` throws `ApiClientError` on non-ok responses; `apiFetchQuiet()` for non-critical mutations

**API Route Layer:**

- Purpose: Parse request → validate with Zod → check auth + permissions → call service → return response
- Location: `app/api/`
- Contains: RESTful endpoints grouped by resource (tasks, projects, documents, etc.)
- Depends on: `lib/auth/` (requireAuth, requireWorkspaceMember), `lib/validation/` (schemas), `lib/services/`, Zod
- Used by: API client and webhooks (GitHub, Slack)
- Pattern: ~50-100 line handlers; no business logic; auth check → validate → call service → respond

**Service Layer:**

- Purpose: Orchestrate business logic, coordinate repositories, handle state machines, trigger side effects
- Location: `lib/services/`
- Contains: Domain services (task.service.ts, project.service.ts, notification.service.ts, etc.)
- Depends on: `lib/repositories/`, `lib/integrations/` (Slack, GitHub, Pusher), `lib/events/`, `lib/validation/`
- Used by: API routes and other services
- Pattern: Throws errors with `Object.assign(new Error(msg), { status })` for API error handling; uses `waitUntil` from `@/lib/runtime/wait-until` for async side effects (LUM-1022: delegates to `@vercel/functions` on Vercel; on self-hosted Node the task runs in the background with rejections logged, and work still in flight when the process exits is lost)

**Repository Layer:**

- Purpose: Encapsulate Prisma queries, return domain models, use `select` to fetch only required fields
- Location: `lib/repositories/`
- Contains: Data access objects per entity (task.repository.ts, project.repository.ts, etc.)
- Depends on: `lib/db/prisma` (Prisma client), types
- Used by: Services exclusively; never called directly from API routes or components
- Pattern: Named exports (e.g., `taskRepository.getTaskDetail(id)`); uses include/select to optimize queries

**Database Layer:**

- Purpose: Persist state using Neon PostgreSQL via Prisma adapter
- Location: `prisma/schema.prisma`
- Driver: `@prisma/adapter-pg` (native PostgreSQL adapter)
- Connection: `DATABASE_URL` env var, sanitized for SSL cert verification
- Logging: Dev mode logs queries; production logs errors only

## Data Flow

**Happy Path - Update Task:**

1. User submits form in `TaskDetail` (component)
2. Component calls `taskClient.update(id, data)` from `lib/api-client/tasks.ts`
3. API client → `PATCH /api/tasks/[id]` (route handler)
4. Route handler:
   - Calls `requireAuth()` → `requireWorkspaceMember()`
   - Parses body with `updateTaskSchema.safeParse()`
   - Calls `taskService.updateTaskWithSideEffects(id, data, task, actorId, userId)`
5. Service:
   - Validates state transition with `isValidTaskTransition()`
   - Calls `taskRepository.updateTask(id, data)` → executes Prisma query
   - Syncs PR status from GitHub via `getRepoToken(workspaceId, repo)` (confirmed repositories only, LUM-883)
   - Calls `dispatchTaskUpdateNotifications()` → queues email/Slack messages
   - Dispatches `pushTaskEvent()` to Pusher for real-time UI updates
   - Returns updated task + changed fields
6. Route handler returns `NextResponse.json({ task })`
7. Component receives response, updates local state, UI refreshes

**Integration Flow - GitHub PR Webhook:**

1. GitHub sends POST to `POST /api/webhooks/github` (not yet fully implemented; structure in place)
2. Route verifies signature with `verifyGitHubSignature()` from `lib/integrations/github/verify.ts`
3. Route parses event (pull_request, push, etc.)
4. Route calls `githubService.handlePrStatusUpdate()` or equivalent
5. Service queries affected tasks via `taskRepository.findByBranchName()`
6. Service updates task PR state, calls notification service
7. Service dispatches Pusher event for real-time sync

**Real-time Updates:**

- Pusher client-side listener in `useRealtimeNotifications()` hook receives `task:updated` events
- Hook updates `useTaskStore()` or re-fetches data
- Component re-renders with fresh state

## State Management

**Server-side State:**

- Database (Prisma) is source of truth
- Repositories fetch snapshots
- Services apply business logic and mutations

**Client-side State:**

- Zustand stores (`useTaskStore`, hooks in workspace app) manage UI state
- Tanstack React Query patterns used for caching
- Local form state via React Hook Form
- Real-time Pusher subscriptions propagate server mutations to UI

## Key Abstractions

**Service Layer:**

- Purpose: Encapsulate complex workflows (task creation with auto-assignment, approval cascades, etc.)
- Examples: `lib/services/task.service.ts`, `lib/services/notification.service.ts`
- Pattern: Async methods that throw on error; call repositories, dispatch events, trigger integrations

**Repository Layer:**

- Purpose: Hide Prisma query complexity
- Examples: `lib/repositories/task.repository.ts` with `TASK_DETAIL_INCLUDE` query templates
- Pattern: Returns Prisma models; uses `select` for field-level optimization

**Integration Modules (Barrel + Submodule Pattern):**

- Purpose: Isolate third-party SDK usage, prevent server-code from leaking to client
- Structure:
  - `lib/integrations/slack/` (barrel at `index.ts`)
  - `lib/integrations/slack/notify.ts` (notification logic)
  - `lib/integrations/slack/bot.ts` (Slack adapter)
  - `lib/integrations/slack/commands.ts` (command handler)
- Rule: Client components import from `lib/integrations/{slack,github}/notify` or `lib/integrations/{slack,github}/auth` directly, never from the barrel
- Reason: Barrel exports might re-export server-only code; submodule imports are explicit and tree-shakeable

**API Client Wrapper:**

- Purpose: Type-safe, single error-handling approach
- Location: `lib/api-client/base.ts`
- Pattern: `apiFetch<T>(url, options)` → parses JSON, throws ApiClientError on non-ok

**Validation Schemas:**

- Purpose: Single source of truth for input validation
- Location: `lib/validation/schemas.ts`
- Pattern: Zod schemas exported per domain (createTaskSchema, updateTaskSchema, etc.)

## Entry Points

**Main Application:**

- `app/layout.tsx` → Root layout, wraps with Providers (Clerk, Theme)
- `app/workspace/[workspaceUrl]/layout.tsx` → Workspace layout
- `app/workspace/[workspaceUrl]/WorkspaceApp.tsx` → Client-side app shell managing tabs, modals, real-time subscriptions
- Pages under `app/workspace/[workspaceUrl]/`:
  - `projects/` → list projects
  - `projects/[projectSlug]/` → project detail
  - `my-tasks/` → user's assigned tasks
  - `dashboard/` → workspace overview
  - `documents/` → document browser
  - `documents/[docId]/` → document editor

**API Routes:**

- `app/api/tasks/[id]` → GET (fetch detail), PATCH (update), DELETE
- `app/api/projects/[id]/tasks` → POST (create task), GET (list)
- `app/api/agent/*` → Agent execution (execute, cancel, confirm-spec)
- `app/api/webhooks/github` → GitHub webhook receiver (structure in place)
- Full list in `app/api/` directory

**Agent Server:**

- `agent-server/src/mcp-server.ts` → MCP server exposing tools for Claude agent
- `agent-server/src/agent/execute.ts` → Main agent execution orchestrator
- Separate workspace with isolated dependencies and Prisma instance
- Communicates with main app via API and MCP protocol

## Cross-Cutting Concerns

**Authentication:**

- Clerk SDK (`@clerk/nextjs`)
- Server-side: `lib/auth/index.ts` exports `requireAuth()`, `requireWorkspaceMember()`, `getUserWorkspace()`
- Client-side: `ClerkProvider` wraps app in `components/core/Providers.tsx`
- Pattern: Check auth early in API routes; workspace membership verified per-request

**Authorization:**

- Workspace-centric: All resources (tasks, projects, docs) scoped to a workspace
- Member check: `requireWorkspaceMember(workspaceId, clerkId)` returns WorkspaceMember or 403
- Workspace role: Stored in Prisma; not yet enforced for all operations (feature in progress)

**Validation:**

- Centralized Zod schemas in `lib/validation/schemas.ts`
- Used in API routes before calling service
- Pattern: `const parsed = schema.safeParse(body); if (!parsed.success) return zodError(parsed);`

**Error Handling:**

- Services throw errors with status: `Object.assign(new Error(msg), { status: 400 })`
- API routes catch and return NextResponse with appropriate status
- Client receives ApiClientError with message and status
- Zod validation errors → 400 Bad Request
- Missing resources → 404 Not Found
- Auth failures → 401 Unauthorized
- Permission failures → 403 Forbidden

**Logging:**

- No console.log in production code (CLAUDE.md rule)
- Logger pattern not yet centralized; needs consideration for next phase
- Prisma logs queries in dev, errors in prod

**Notifications:**

- Multiple channels: Email (Resend), Slack (chat-adapter), in-app (Pusher real-time)
- Service: `lib/services/notification.service.ts` orchestrates dispatch
- Slack integration: `lib/integrations/slack/notify.ts` sends channel/DM notifications
- Pusher integration: `lib/integrations/pusher/server.ts` broadcasts real-time events

**Real-time Broadcasting:**

- Pusher SDK (`pusher` server-side, `pusher-js` client-side)
- Channels: `workspace:{workspaceId}:tasks`, `task:{taskId}`
- Events: `task:updated`, `task:created`, `comment:added`, etc.
- Server pushes events via `pushTaskEvent()` after mutations

## Integration Boundaries

**Main App ↔ Agent Server:**

- Main app: User-facing app, API routes for CRUD, real-time UI
- Agent server: Separate workspace, MCP tools, sandboxed code execution
- Communication: REST API calls from agent-server to main app, Pusher broadcasts from main to agent
- Shared types: `shared/` workspace exports AgentError, ExecuteAgentRequest, etc.

**Main App ↔ GitHub:**

- Oauth app installed on user's repos
- Token fetched via `getRepoToken(workspaceId, repo)` (confirmed repositories only, LUM-883) (cached, from `lib/integrations/github/auth.ts`)
- Webhooks received at `POST /api/webhooks/github` (receives PR/push events)
- Client: Octokit SDK via `@octokit/auth-app` for bot auth

**Main App ↔ Slack:**

- Workspace app token stored in DB (encrypted)
- Notifications sent via Web API
- Commands received via HTTP POST to `POST /api/integrations/slack/commands`
- Adapter: `@chat-adapter/slack` for bot framework

**Main App ↔ Database:**

- Prisma client with PostgreSQL adapter (Neon)
- Single instance: `lib/db/prisma.ts` exports singleton `prisma` client
- Connection pooling: Handled by Neon adapter
- Agent server has separate Prisma instance in `agent-server/src/db/prisma.ts`

---

_Architecture analysis: 2026-04-09_
