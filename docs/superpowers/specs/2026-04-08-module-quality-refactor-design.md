# Module Quality Refactor — Type Unification + Prisma Convergence + Component Split

**Date:** 2026-04-08
**Goal:** Improve module quality across 10 dimensions: coupling, cohesion, independence, interface clarity, reusability, replaceability, testability, documentation, version control, and maintenance cost.

**Approach:** Incremental (3 phases), each independently mergeable. Phase C → A → B.

---

## Phase C: Type System Unification

### Problem

- `types/index.ts` contains legacy types (User, Task, Notification, Priority) that don't match actual API responses
- Runtime code uses `app/workspace/[workspaceUrl]/types.ts` Api\* types exclusively
- Priority enums conflict: `low/medium/high/critical` (types/) vs `P0/P1/P2` (workspace types)
- 6 input/output types scattered in `lib/services/*.ts` files
- 44 files import directly from `@prisma/client` for types

### Solution

1. **Clean legacy types**: Remove or deprecate unused types in `types/index.ts` (User, Task, Notification, Priority). Grep for references first — zero-reference types are deleted, low-reference types are deprecated with a comment pointing to the correct type.

2. **Centralize service/repository type exports**: Ensure all input/output types are re-exported through `lib/services/index.ts` and `lib/repositories/index.ts` barrel files. Consumers import from barrel, never from individual files.

3. **Reduce `@prisma/client` type imports**: Where API routes import Prisma enums (Status, Priority, etc.) for type annotations only, switch to importing from repository or workspace types. Goal: only `lib/repositories/*.ts` files import from `@prisma/client`.

4. **No directory restructuring**: Files stay in current locations to avoid import path churn.

### Estimated Impact

~10-15 files modified, low risk.

---

## Phase A: Prisma Complete Convergence

### Problem

- 6 repositories cover 6 models; 24 models accessed via direct `prisma.` calls in 65 API routes
- 3 service files (`task.service.ts`, `project.service.ts`, `document.service.ts`) leak Prisma access
- API routes contain business logic mixed with data access

### Solution: Domain-Aggregated Repositories

New repository files (each encapsulates related Prisma models):

| Repository File              | Prisma Models                                                                               | Route Count |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ----------- |
| `notification.repository.ts` | notification, agentClarify                                                                  | ~5          |
| `agent.repository.ts`        | agentRun, agentProfile                                                                      | ~8          |
| `github.repository.ts`       | gitHubIntegration, gitHubWebhook, taskBranch                                                | ~6          |
| `slack.repository.ts`        | slackIntegration, slackChannel                                                              | ~6          |
| `invite.repository.ts`       | workspaceInvite                                                                             | ~4          |
| `view.repository.ts`         | view, viewTaskOrder                                                                         | ~3          |
| `member.repository.ts`       | workspaceMember (split from workspace.repository)                                           | ~4          |
| `draft.repository.ts`        | draft                                                                                       | ~2          |
| `summary.repository.ts`      | workspaceSummary, projectSummary                                                            | ~3          |
| `misc.repository.ts`         | waitlistEntry, apiKey, userPreference, priorityOverride, projectRepository, documentMention | ~8          |

### Corresponding Services

New service files for each domain: `notification.service.ts`, `agent.service.ts`, `github.service.ts`, `slack.service.ts`, `invite.service.ts`, `view.service.ts`, `member.service.ts`, `draft.service.ts`, `summary.service.ts`.

Exception: `misc.repository.ts` models are too scattered for a meaningful service. Their routes call the repository directly.

### API Route Migration Rule

Every route follows: `auth check → Zod validate → call service → return Response`. No Prisma imports in routes.

### Service Prisma Leak Fixes

- `task.service.ts`: Move parent task, project, actor existence checks into repository methods
- `project.service.ts`: Move reviewer validation into `member.repository`
- `document.service.ts`: Move mention sync transaction into `document.repository`

### Migration Batches

1. notification + agent (most independent)
2. github + slack (integration domain)
3. invite + member + view
4. draft + summary
5. misc (waitlist, apiKey, etc.)
6. Fix 3 existing service Prisma leaks

### Estimated Impact

~80 files modified, ~20 new files. Each batch ~15 files.

---

## Phase B: God Component Split

### Target

4 components >700 lines, goal <500 lines each. Components 500-550 lines are not touched.

### TaskDetailPage.tsx (1,409 → ~450 lines)

Extract:

- `useTaskDetailState` hook — consolidate 10 useState (task, breadcrumb, branch, deletion state)
- `useTaskDetailActions` hook — consolidate 5 useCallback (copy branch/link, delete, commit description/spec)
- `TaskDetailHeader` sub-component — breadcrumb + action toolbar

### TaskDetailPanel.tsx (1,312 → ~450 lines)

Extract:

- `useTaskSync` hook — liveTask synchronization + Pusher event handling
- `CommentSection` sub-component — comment list + CommentEditor (expand existing)
- `TaskFieldsSection` sub-component — status/priority/assignee/reviewer field editing area

### InboxPage.tsx (847 → ~400 lines)

Extract:

- `useResizablePanel` hook — divider drag logic (mousedown/mousemove/mouseup + refs)
- `NotificationDetailPanel` sub-component — right detail panel (AgentClarifyWidget, ApprovalWidget, TaskActionWidget)

### ProjectDetailPage.tsx (742 → ~400 lines)

Extract:

- `useProjectViewState` hook — consolidate tab, viewMode, displayOptions, filter/sort (9 useState)
- `ProjectHeader` sub-component — breadcrumb + repo controls + project settings

### Not Touched

MembersPage (548), WorkspaceSettingsPage (532), GlobalDocTree (520), DocumentsPage (518) — marginally over 500, not worth the churn.

### Estimated Impact

~15 new files (hooks + sub-components), 4 main files modified.

---

## Testing Strategy

- Every new repository gets unit tests (mock Prisma, verify query params)
- Every new service gets unit tests (mock repository, verify orchestration logic)
- Extracted hooks: no tests required (UI hooks, covered by existing integration behavior)
- Run `npx tsc --noEmit` and `npm test` after each batch

## Success Criteria

- Zero `prisma.` imports outside `lib/repositories/`
- Zero type conflicts between `types/` and `app/workspace/types.ts`
- No component >500 lines in `app/workspace/[workspaceUrl]/components/` (for the 4 targets)
- All existing tests pass
- Zero TypeScript errors
