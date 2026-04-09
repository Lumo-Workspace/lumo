# Modular Refactoring Design Spec

**Date:** 2026-04-09
**Goal:** Establish clear module boundaries, add an integrations layer, define module interfaces, slim down API routes, split the agent module, and fix frontend-layer violations.

## Approach

Bottom-up refactoring (Approach A):

1. Build `lib/integrations/` layer and module interfaces
2. Split `lib/agent/` into services + integrations
3. Move `lib/notifications/` orchestration logic into services
4. Add `types.ts` + `index.ts` interfaces to all modules
5. Slim 12 oversized API routes by extracting business logic into services
6. Fix Components/Hooks that bypass the API client

---

## 1. Target Architecture

### Directory Structure

```
lib/
├── repositories/          # Data access layer (compliant, keep as-is)
│   ├── types.ts           # NEW: Repository input/output types
│   └── index.ts           # NEW: barrel exports
│
├── services/              # Business logic layer (expand)
│   ├── types.ts           # NEW: Service layer shared types
│   ├── index.ts           # NEW: barrel exports
│   ├── task.service.ts    # EXPAND: +createTask, +buildActivityEvents
│   ├── agent-orchestration.service.ts  # NEW: from lib/agent/
│   ├── spec-generation.service.ts      # NEW: from lib/agent/generate-spec
│   ├── clarification.service.ts        # NEW: from lib/agent/resume
│   ├── description.service.ts          # NEW: from API route
│   ├── notification-response.service.ts # NEW: from API route
│   ├── quick-dispatch.service.ts       # NEW: from API route
│   └── ...existing services
│
├── integrations/          # NEW: External integrations layer
│   ├── github/
│   │   ├── types.ts
│   │   ├── index.ts
│   │   ├── auth.ts        # token retrieval
│   │   ├── branch.ts      # branch operations
│   │   ├── webhooks.ts    # webhook management
│   │   ├── sync.ts        # PR sync
│   │   └── verify.ts      # signature verification
│   ├── slack/
│   │   ├── types.ts
│   │   ├── index.ts
│   │   ├── notify.ts      # message sending
│   │   ├── commands.ts    # slash commands
│   │   └── bot.ts         # adapter
│   ├── email/
│   │   ├── types.ts
│   │   ├── index.ts
│   │   ├── client.ts      # Resend client
│   │   └── templates/     # email templates
│   ├── pusher/
│   │   ├── types.ts
│   │   ├── index.ts
│   │   └── server.ts      # real-time event push
│   └── sandbox/
│       ├── types.ts
│       ├── index.ts
│       ├── execution.ts   # E2B sandbox lifecycle
│       ├── mcp.ts         # MCP server injection
│       ├── health.ts      # liveness check
│       └── proxy.ts       # optional external agent-server proxy
│
├── api-client/            # Frontend API client (keep, add missing methods)
├── validation/            # Zod schemas (keep as-is)
├── db/                    # Database client (infrastructure, keep)
├── auth/                  # Auth helpers (infrastructure, keep)
├── i18n/                  # i18n (infrastructure, keep)
├── events/                # Event dispatcher (keep, add types.ts + index.ts)
└── utils/                 # Pure utility functions
    ├── sanitize.ts        # NEW: extracted from API route
    ├── clerk-helpers.ts   # NEW: batch Clerk user lookup/transform
    └── markdown.ts        # MOVE: from lib/agent/markdown.ts
```

### Data Flow

```
Component → API Client → API Route → Service → Repository → Prisma/DB
                                        ↓
                                  Integrations (GitHub, Slack, Email, Pusher, Sandbox)
```

---

## 2. Module Interface Convention

Every module directory contains:

- **`types.ts`** — Interface/type definitions only (contract). No implementations.
- **`index.ts`** — Re-exports public functions from internal files + all types from `types.ts`.

### Import Rules

```typescript
// CORRECT: import from index
import { getGithubInstallationToken } from '@/lib/integrations/github'

// FORBIDDEN: import internal files directly
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
```

### Example — `lib/integrations/github/`

```typescript
// types.ts
export interface GitHubCredentials {
  installationId: number
  appId: string
  privateKey: string
}

export interface CreateBranchParams {
  owner: string
  repo: string
  branchName: string
  baseSha: string
  credentials: GitHubCredentials
}

export interface CreateBranchResult {
  ref: string
  sha: string
}
```

```typescript
// index.ts
export type {
  GitHubCredentials,
  CreateBranchParams,
  CreateBranchResult,
} from './types'
export { getGithubInstallationToken } from './auth'
export { parseBranchIdentifier, generateBranchName } from './branch'
export { createRepoWebhook, deleteRepoWebhook } from './webhooks'
export { syncRepoPRs } from './sync'
export { verifyGitHubSignature } from './verify'
```

### Example — `lib/services/types.ts`

```typescript
export interface CreateTaskParams {
  projectId: string
  title: string
  assigneeId?: string
  description?: string
  priority?: TaskPriority
}

export interface CreateTaskResult {
  task: Task
  events: DomainEvent[]
}

export interface ActivityEventDiff {
  field: string
  oldValue: string | null
  newValue: string | null
}
```

---

## 3. API Route Slimming

**Target:** Each route stays within 50-100 lines. Routes only do: auth check → validate input → call service → return response.

### Routes to Slim

| Route                                   | Current LOC | Extract To                                  | What to Extract                           |
| --------------------------------------- | ----------- | ------------------------------------------- | ----------------------------------------- |
| `tasks/[id]/route.ts`                   | 318         | `taskService.buildActivityEvents()`         | 145-line if-else activity event builder   |
| `projects/[id]/tasks/route.ts`          | 268         | `taskService.createTask()`                  | Order calc + sequence gen + notifications |
| `notifications/[id]/respond/route.ts`   | 268         | `notificationResponseService.handle*()`     | 3 notification type handler branches      |
| `tasks/generate-description/route.ts`   | 264         | `descriptionService.generate()`             | Prompt building + sanitize + AI call      |
| `tasks/[id]/comments/route.ts`          | 231         | `commentService.notifyMentions()`           | 85-line @mention batch notifications      |
| `notifications/route.ts`                | 178         | `notificationService.enrichNotifications()` | 46-line enrichment mapping                |
| `tasks/quick-dispatch/execute/route.ts` | 175         | `quickDispatchService.executeActions()`     | 100-line batch action loop                |
| `github/repos/route.ts`                 | 175         | `githubService.updateAuthorizedRepos()`     | 80-line webhook management                |
| `slack/create-channel/route.ts`         | 168         | `slackService.createChannelWithInvite()`    | 100-line channel creation + invitation    |
| `tasks/[id]/branch/route.ts`            | 159         | `githubService.createBranchForTask()`       | 85-line GitHub API call                   |
| `users/preferences/route.ts`            | 153         | `preferenceService.updatePreferences()`     | 50-line field validation                  |
| `tasks/parse-quick-dispatch/route.ts`   | 152         | `quickDispatchService.parseWithAI()`        | AI context building + Clerk lookup        |

### Slimmed Route Pattern

```typescript
// app/api/tasks/[id]/route.ts — after refactor (~60 lines)
export async function PATCH(req, { params }) {
  const { userId } = await requireAuth()
  const { id } = await params
  const body = await req.json()
  const validated = taskUpdateSchema.parse(body)

  const result = await taskService.updateTask(id, validated, userId)

  return NextResponse.json(result.task)
}
```

---

## 4. Agent Module Split

### Current State

`lib/agent/` — 3,095 lines, 13 files. Business logic and infrastructure tangled in `execute.ts` (1,438 lines).

### Split Mapping

```
lib/agent/ (current)                  →  Target
──────────────────────────────────────────────────
state-machine.ts (165)                →  services/agent-orchestration.service.ts
comment-handler.ts (330)              →  services/agent-orchestration.service.ts
context-builder.ts (427)              →  services/agent-orchestration.service.ts
generate-spec.ts (93)                 →  services/spec-generation.service.ts
resume.ts (37)                        →  services/clarification.service.ts

execute.ts (1,438) splits into:
  ├─ Business orchestration (~400 LOC) →  services/agent-orchestration.service.ts
  │  (prepareTaskForExecution, interpretAgentResult, finalizeAgentRun)
  ├─ Sandbox lifecycle (~600 LOC)      →  integrations/sandbox/execution.ts
  │  (createSandbox, cloneRepo, runClaudeCode, cleanup)
  └─ GitHub PR operations (~200 LOC)   →  integrations/github/ (expand)
     (createPullRequest, parsePRFromOutput)

sandbox-mcp.ts (344)                  →  integrations/sandbox/mcp.ts
sandbox-health.ts (16)                →  integrations/sandbox/health.ts
clerk-cache.ts (51)                   →  lib/utils/clerk-helpers.ts (merge)
proxy.ts (37)                         →  integrations/sandbox/proxy.ts
markdown.ts (55)                      →  lib/utils/markdown.ts
errors.ts (45)                        →  shared/ (already has AgentError)
utils.ts (57)                         →  Remove duplicates, distribute
```

### Post-Split Call Chain

```
API Route (agent/execute)
    ↓
services/agent-orchestration.service.ts
    ├─ prepareTaskForExecution()    — load task, build context, transition state
    ├─ call integrations/sandbox/   — create sandbox, clone, run Claude
    └─ finalizeAgentRun()           — parse result, create PR, final state
         └─ call integrations/github/ — PR operations
```

### Key Interface — `integrations/sandbox/types.ts`

```typescript
export interface SandboxExecutionParams {
  taskContext: string
  repoUrl: string
  branch: string
  credentials: GitHubCredentials
  allowedTools: string[]
}

export interface SandboxExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
  changedFiles: string[]
  prUrl?: string
}
```

The business layer interacts with sandbox only through `SandboxExecutionParams/Result`, decoupled from E2B SDK details.

---

## 5. Frontend Layer Fixes

### Components with Direct fetch() (3 files)

| File                               | Current Issue                         | Fix                                    |
| ---------------------------------- | ------------------------------------- | -------------------------------------- |
| `LogoUploader.tsx`                 | Direct fetch() for image upload       | Add `uploadLogo()` to `api-client/`    |
| `task/AgentPanel.tsx`              | Direct fetch() for Pusher auth        | Add `getPusherAuth()` to `api-client/` |
| `task/agent/AgentClarifyPanel.tsx` | Direct fetch() to `/api/agent/resume` | Add `resumeAgent()` to `api-client/`   |

### Hooks with Direct fetch() (2 files)

| File                   | Current Issue                              | Fix                                                       |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `useProfileUpdates.ts` | Direct fetch() to `/api/profile`           | Use `api-client/` wrapper                                 |
| `usePerformance.ts`    | `useLazyLoad` accepts generic loadFunction | No change needed — callers should pass api-client methods |

### Shared Utility Extraction

| Utility                                 | Source                                | Target                       |
| --------------------------------------- | ------------------------------------- | ---------------------------- |
| `sanitizeHtml()`                        | `tasks/generate-description/route.ts` | `lib/utils/sanitize.ts`      |
| `markdownToHtml()` / `htmlToMarkdown()` | `lib/agent/markdown.ts`               | `lib/utils/markdown.ts`      |
| Clerk user batch lookup + transform     | 3+ routes (duplicated)                | `lib/utils/clerk-helpers.ts` |

---

## 6. Implementation Order (Bottom-Up)

1. **Phase 1:** Create `lib/integrations/` — move github, slack, email, pusher with `types.ts` + `index.ts`
2. **Phase 2:** Split `lib/agent/` — business logic → services, infrastructure → integrations/sandbox
3. **Phase 3:** Move `lib/notifications/` orchestration into services
4. **Phase 4:** Add `types.ts` + `index.ts` to all existing services/repositories
5. **Phase 5:** Slim 12 oversized API routes, extract business logic to services
6. **Phase 6:** Fix frontend layer (components + hooks direct fetch), extract shared utils
7. **Phase 7:** Update all import paths, verify no internal file imports leak

---

## 7. Success Criteria

- No API route exceeds 100 lines
- No component or hook calls fetch() directly (except `usePerformance.ts` generic hook)
- All modules have `types.ts` (contract) + `index.ts` (barrel export)
- External imports only go through `index.ts`, never internal files
- Services never import Prisma directly
- API routes never contain business logic
- `lib/agent/` directory removed, replaced by services + integrations
- All existing tests continue to pass
