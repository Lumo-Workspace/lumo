# Memory management UI — design

**Task:** [LUM-70](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-70) — Memory management UI: view, promote, edit, delete project & task memory
**Date:** 2026-05-29
**Status:** Design approved, ready for implementation plan
**Related:** LUM-64 (layer1 extraction, PR #107), LUM-68 (auto-scope), LUM-69 (auto-promote)

## Problem

After LUM-64, the only way for a human to influence what memory Claude sees is
to wait for layer1 extraction or directly `INSERT` into the database. There is
no API, no UI. The system grows a write-only memory by design but offers no
correction path when it gets something wrong.

LUM-70 adds the manual management surface: list, create, edit, delete, and
promote (TASK→PROJECT) memories tied to task and project detail pages.

## Decisions

These were settled during brainstorming and frame the rest of the design:

1. **Delete is hard-delete.** No `archivedAt` column. Recovery path is "create
   a new row." Reasoning: keeps the schema and layer1/2 prompts simple; user
   can always recreate.
2. **All workspace members can create / edit / delete / promote.** Memory is
   shared team context; restricting writes contradicts its purpose. Auto-extracted
   memories have no `createdByMemberId`, so per-creator restrictions would
   leave them un-deletable.
3. **PATCH is the minimum viable set.** Allowed fields: `content` (always), and
   `scope: PROJECT` (promote). Forbidden: `category` change, `scope: PROJECT→TASK`
   (demote), `taskId` re-binding. Rationale: the forbidden operations are rare,
   risk data loss, and have viable "delete + recreate" workarounds.
4. **Schema additions:** `updatedAt @updatedAt`, `createdByMemberId String?`
   (null = layer1/2 auto-extracted). **No** `humanEdited` or `lastEditedByMemberId`.
5. **Last-write-wins.** No protection against layer1 overwriting human edits.
   layer1 already sees the latest text; the LLM tends to preserve human phrasing.
   Reopen if LUM-68/69 surfaces real conflicts.
6. **API route shape: parent-nested list/create + singleton PATCH/DELETE.**
   Matches the task spec and the codebase convention (e.g. comments).
   PATCH naturally carries promote without needing a `/promote` verb.
7. **UI placement:** new "Memory" tab in `TimelineTabs` (Task detail, after
   "Agent") and in the Project detail tab strip (after "Summary").
8. **Create / edit form: shadcn Dialog.** Category picker first, then
   category-specific form. Edit reuses the same Dialog with category locked.

## Architecture

### Data flow

```
MemoryTab (component)
  → useMemories hook
    → memoriesClient (lib/api-client/memories.ts)
      → HTTP
        → /api/projects/[id]/memories | /api/tasks/[id]/memories | /api/memories/[id]
          → memoryManagementService
            → memoryRepository
              → Prisma
```

`memoryManagementService` is new and disjoint from `lib/services/memory/`
(layer1/layer2). Keeping them separate prevents LLM dependencies leaking into
the HTTP path.

### Schema changes

```prisma
model Memory {
  id                  String         @id @default(cuid())
  workspaceId         String
  projectId           String
  taskId              String?
  scope               MemoryScope
  category            MemoryCategory
  content             Json
  sourceSessionId     String?
  createdByMemberId   String?        // NEW: null = layer1/2 auto
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt   // NEW

  workspace        Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  project          Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  task             Task?            @relation(fields: [taskId], references: [id], onDelete: SetNull)
  session          Session?         @relation(fields: [sourceSessionId], references: [id], onDelete: SetNull)
  createdByMember  WorkspaceMember? @relation(fields: [createdByMemberId], references: [id], onDelete: SetNull)

  @@index([projectId, scope])
  @@index([taskId])
  @@map("memories")
}
```

Single migration, both columns nullable, no backfill, no destructive step.
Old rows show `updatedAt = createdAt` after first write because Prisma fills
`@updatedAt` on insert.

### Repository extension

Existing methods (`create`, `updateContent`, `delete`,
`findActiveTaskMemories`, `findActiveProjectMemories`,
`findRecentTaskScopeMemoriesByProject`, `findByTaskIdWithSession`,
`applyPlansAtomically`) stay untouched. layer1/layer2 keep calling
`create` and `updateContent` exactly as before.

New methods:

```ts
listForProject(projectId: string): Promise<MemoryRow[]>
listForTask(taskId: string): Promise<MemoryRow[]>

update(
  id: string,
  patch: {
    content?: Prisma.InputJsonValue
    scope?: MemoryScope
    taskId?: string | null
  },
  tx?: Prisma.TransactionClient
): Promise<{ id: string }>

findByIdWithWorkspace(id: string): Promise<{
  id: string
  workspaceId: string
  projectId: string
  taskId: string | null
  scope: MemoryScope
  category: MemoryCategory
} | null>
```

`MemoryRow` returns `{ id, scope, category, content, taskId, createdByMemberId,
createdAt, updatedAt }`.

`CreateMemoryInput` gains one field, both for HTTP path and layer1/2:

```ts
interface CreateMemoryInput {
  workspaceId: string
  projectId: string
  taskId: string | null
  scope: MemoryScope
  category: MemoryCategory
  content: Prisma.InputJsonValue
  sourceSessionId: string | null
  createdByMemberId: string | null // NEW; layer1/2 pass null
}
```

layer1-apply / layer2-apply call sites add `createdByMemberId: null` (2-3
line edit).

### Service: `lib/services/memory-management.service.ts`

```ts
export const memoryManagementService = {
  listProjectMemories(projectId: string): Promise<MemoryRow[]>
  listTaskMemories(taskId: string): Promise<MemoryRow[]>

  createForProject(input: {
    projectId: string
    workspaceId: string
    category: MemoryCategory
    content: MemoryContent
    actorMemberId: string
  }): Promise<MemoryRow>

  createForTask(input: {
    taskId: string
    projectId: string
    workspaceId: string
    category: MemoryCategory
    content: MemoryContent
    actorMemberId: string
  }): Promise<MemoryRow>

  editContent(memoryId: string, content: MemoryContent): Promise<MemoryRow>

  // Promote may carry an optional content update so the combined PATCH
  // case (edit + promote) is one repository.update call inside one row write,
  // not two sequential mutations.
  promoteToProject(
    memoryId: string,
    content?: MemoryContent,
  ): Promise<MemoryRow>
  // throws 409 if already PROJECT

  delete(memoryId: string): Promise<void>
}
```

Error pattern: `throw Object.assign(new Error(msg), { status: 409 })`.
`content` reaches the service already validated by `parseMemoryContent`.

### API routes

All four use `requireIdentity` (bearer + Clerk).

#### `POST /api/projects/[id]/memories`

```
Body: { category: MemoryCategory, content: unknown }

1. requireIdentity → identity
2. projectRepository.findWithWorkspaceId(id) → 404
3. project.workspaceId !== identity.workspaceId → 403
4. parseMemoryContent(category, content) → 400 on schema fail
5. memoryManagementService.createForProject({
     projectId: id, workspaceId, category, content,
     actorMemberId: identity.memberId,
   })
→ 201 { memory }
```

#### `POST /api/tasks/[id]/memories`

Mirrors the above but resolves task → project → workspaceId for the
authorization check. Service is `createForTask`.

#### `PATCH /api/memories/[memoryId]`

```
Body (Zod oneOf, at least one of content/scope):
  { content?: unknown, scope?: 'PROJECT' }

1. requireIdentity
2. memoryRepository.findByIdWithWorkspace(memoryId) → 404
3. memory.workspaceId !== identity.workspaceId → 403
4. scope === 'PROJECT' && memory.scope === 'PROJECT' → 409
5. content !== undefined → parseMemoryContent(memory.category, content) → 400
6. Dispatch:
   - content only: service.editContent(memoryId, content)
   - scope only: service.promoteToProject(memoryId)
   - both: service.promoteToProject(memoryId, content) — single repository.update
→ 200 { memory }
```

#### `DELETE /api/memories/[memoryId]`

```
1. requireIdentity
2. memoryRepository.findByIdWithWorkspace(memoryId) → 404
3. memory.workspaceId !== identity.workspaceId → 403
4. service.delete(memoryId)
→ 204
```

### API client: `lib/api-client/memories.ts`

```ts
export const memoriesClient = {
  listForProject(projectId: string): Promise<{ memories: MemoryRow[] }>
  listForTask(taskId: string): Promise<{ memories: MemoryRow[] }>
  createForProject(projectId: string, body: { category: MemoryCategory; content: unknown }): Promise<{ memory: MemoryRow }>
  createForTask(taskId: string, body: { category: MemoryCategory; content: unknown }): Promise<{ memory: MemoryRow }>
  editContent(memoryId: string, content: unknown): Promise<{ memory: MemoryRow }>
  promoteToProject(memoryId: string): Promise<{ memory: MemoryRow }>
  delete(memoryId: string): Promise<void>
}
```

Re-exported from `lib/api-client/index.ts`.

### Validation: `lib/validation/memory.ts`

```ts
export const createMemoryBodySchema = z.object({
  category: z.nativeEnum(MemoryCategory),
  content: z.unknown(), // category-specific shape validated by parseMemoryContent
})

export const patchMemoryBodySchema = z
  .object({
    content: z.unknown().optional(),
    scope: z.literal('PROJECT').optional(),
  })
  .refine(b => b.content !== undefined || b.scope !== undefined, {
    message: 'At least one of content or scope must be provided',
  })
```

The content's category-specific structure is validated by the existing
`parseMemoryContent` in `lib/memory/schemas.ts`.

## Frontend

### Files (new)

```
app/workspace/[workspaceUrl]/components/memory/
├── MemoryCard.tsx              (existing)
├── MemoryTab.tsx               (NEW: list + add button + dialog state)
├── MemoryListItem.tsx          (NEW: MemoryCard + action menu)
├── MemoryEditDialog.tsx        (NEW: create/edit shared)
└── forms/
    ├── TrapForm.tsx
    ├── DecisionForm.tsx
    ├── ConventionForm.tsx
    └── ProceduralForm.tsx

app/workspace/[workspaceUrl]/hooks/
└── useMemories.ts              (NEW)
```

### `useMemories(scope, parentId)`

```ts
type Scope = 'project' | 'task'

function useMemories(
  scope: Scope,
  parentId: string
): {
  memories: MemoryRow[]
  loading: boolean
  error: Error | null
  refetch: () => void
  create: (input: {
    category: MemoryCategory
    content: unknown
  }) => Promise<void>
  edit: (id: string, content: unknown) => Promise<void>
  promote: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}
```

Dispatches to the right `memoriesClient.*` based on `scope`. Refetch on every
mutation (no optimistic update in v1).

### `MemoryTab`

Used by both Task and Project. Props: `{ scope: Scope; parentId: string }`.

- Header: `"+ Add memory"` button + count `"3 memories"`.
- List: `MemoryListItem` rendered in `createdAt desc`.
- Empty state: brief explainer + CTA.
- Dialog state owned here: `{ open: bool; mode: 'create' | 'edit'; editing?: MemoryRow }`.

### `MemoryListItem`

- Renders `<MemoryCard item={...} showSedimentedLabel={false} />`.
- shadcn `DropdownMenu` in the corner:
  - Task: `Edit / Promote to project / Delete`
  - Project: `Edit / Delete`
- Delete goes through shadcn `AlertDialog` confirm.
- Footer line: `Edited {updatedAt}` + source label:
  - `createdByMemberId != null` → "Added by Alice"
  - else → "Sedimented by Claude"

### `MemoryEditDialog`

- **Create mode:** Step 1 — category picker (4 radio/segmented). Step 2 — render
  the matching form.
- **Edit mode:** Skip step 1; render the matching form with category locked.
- Submit button: `Create` vs `Save changes`.
- Form validation: client-side Zod (reuse `trapContentSchema` etc.), inline
  errors on blur or submit.

### Per-category forms

Each renders the fields defined in `lib/memory/schemas.ts`:

| Category   | Required          | Optional                          |
| ---------- | ----------------- | --------------------------------- |
| TRAP       | trigger, outcome  | workaround                        |
| DECISION   | what, why         | alternatives, implications        |
| CONVENTION | rule, scope¹      | —                                 |
| PROCEDURAL | workflow, trigger | steps (array, dynamic add/remove) |

`*` in the label marks required.

¹ Convention's `scope` field is a free-text "where it applies" description, not
the Memory `MemoryScope` enum. Distinct concepts that happen to share the word.

### Tab integration

**Task** (`TimelineTabs.tsx`):

```ts
type TabValue = 'comments' | 'activity' | 'context' | 'agent' | 'memory'
```

Tab order in UI: Comments | Activity | Context | Agent | Memory.

**Project** (`ProjectDetailPage.tsx`):

```ts
const tabs = ['overview', 'milestones', 'tasks', 'summary', 'memory'] as const
```

Both use the same i18n key `memory.tab.title`.

### Cross-tab interaction

Promote: the row disappears from the Task tab (scope changes to PROJECT) and
shows up on the Project tab on next refetch. No global cache invalidation;
refetch fires when the user switches into a tab.

## i18n

17 locales × 38 new keys ≈ 646 translations. Per CLAUDE.md, every locale gets
a proper local translation — no English fallback. Key list:

```
memory.tab.title
memory.tab.empty.title
memory.tab.empty.description
memory.tab.empty.cta
memory.tab.count                            (pluralized)

memory.action.add
memory.action.edit
memory.action.delete
memory.action.promote

memory.dialog.create.title
memory.dialog.edit.title
memory.dialog.create.cta
memory.dialog.edit.cta
memory.dialog.cancel
memory.dialog.categoryStep

memory.form.trap.trigger.label
memory.form.trap.outcome.label
memory.form.trap.workaround.label
memory.form.decision.what.label
memory.form.decision.why.label
memory.form.decision.alternatives.label
memory.form.decision.implications.label
memory.form.convention.rule.label
memory.form.convention.scope.label
memory.form.procedural.workflow.label
memory.form.procedural.trigger.label
memory.form.procedural.steps.label
memory.form.procedural.steps.add
memory.form.required.error

memory.delete.confirm.title
memory.delete.confirm.body

memory.source.byMember                      ({name})
memory.source.auto
memory.meta.editedAt                        ({when})
memory.meta.createdAt                       ({when})

memory.promote.confirm.title
memory.promote.confirm.body
memory.promote.confirm.cta
```

Reused existing keys: `memory.category.{trap,decision,convention,procedural}`,
`memory.field.*` (still used by `MemoryCard`).

## Testing

### Backend unit (Jest, `__tests__/`)

| Module                              | Cases                                                                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory-management.service.test.ts` | createForProject writes correct columns / createForTask requires taskId / editContent doesn't touch scope / promoteToProject TASK→PROJECT clears taskId / promoteToProject already PROJECT throws 409 / delete is hard-delete |
| `memory.repository.test.ts`         | listForProject filters scope=PROJECT / listForTask filters by taskId / update applies content+scope+taskId atomically / findByIdWithWorkspace returns the right shape                                                         |
| validation                          | createMemoryBodySchema rejects empty / patchMemoryBodySchema with empty body fails refine / parseMemoryContent rejects per-category missing fields                                                                            |

### Backend integration (route layer)

| Route                              | Cases                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/projects/[id]/memories` | 401 no auth / 403 cross workspace / 404 project missing / 400 content schema mismatch / 201 success + createdByMemberId = current member   |
| `POST /api/tasks/[id]/memories`    | Same + cross-workspace task blocked                                                                                                        |
| `PATCH /api/memories/[id]`         | content only / scope only / content+scope all succeed / promote when already PROJECT throws 409 / content mismatch for category throws 400 |
| `DELETE /api/memories/[id]`        | 204 success / 404 missing / 403 cross workspace                                                                                            |

### Frontend unit (Jest + RTL)

| Component          | Cases                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `MemoryEditDialog` | create flow picks category then renders form / edit flow locks category / empty required field disables submit / Procedural steps add/remove |
| `MemoryTab`        | empty state renders / list in createdAt desc / Promote button only on task scope / delete goes through AlertDialog                           |
| `useMemories`      | refetch triggers / error surfaces to component                                                                                               |

### Not testing

- E2E (repo has no Playwright/Cypress suite).
- Locale translation correctness (static strings, untestable in CI).
- layer1/layer2 regression beyond the existing service tests — only change
  there is `createdByMemberId: null` added to two `create` call sites.

## Out of scope

| Item                                              | Reason                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Audit log (who edited/deleted when)               | Task spec defers to follow-up; needs a separate table and a global hook         |
| Demote PROJECT → TASK                             | Rare; complex UX (which task?); workaround = "create new TASK + delete PROJECT" |
| Category change                                   | content schema differs; workaround = "delete + recreate"                        |
| Bulk multi-select operations                      | YAGNI                                                                           |
| Search / filter                                   | <50 memories typical; Ctrl+F suffices                                           |
| Cross-task "this lesson appeared in N tasks" view | layer2 diagnostic surface, not management                                       |
| Workspace-scope memories                          | Schema does not support `scope: WORKSPACE`                                      |
| Human-edit protection (`humanEdited` flag)        | last-write-wins; reopen if LUM-68/69 surfaces conflicts                         |
| `lastEditedByMemberId`                            | YAGNI; audit log task will cover this if needed                                 |
| Optimistic UI                                     | tab off the main path; refetch is fine                                          |

## Risks

| Risk                                                                                      | Mitigation                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| layer1/2 still writing while a human edits                                                | last-write-wins; layer1 prompt sees the latest text. Open a new task if real conflicts surface after LUM-68/69.                                                        |
| `createdByMemberId` column requires layer1-apply / layer2-apply call sites to pass `null` | Plan calls this out as its own step — two `create` call sites in `lib/services/memory/layer{1,2}-apply.ts`.                                                            |
| 17 locales × 33 keys translation volume                                                   | Independent "i18n fan-out" step in the plan; use existing `memory.*` keys as style baseline. **No English fallback** (CLAUDE.md hard rule).                            |
| Prisma checksum drift in dev                                                              | Standard `prisma migrate dev`; if drift hits, fall back to hand-write SQL + `db execute` + `migrate resolve --applied` (memory `feedback_prisma_drift_workaround.md`). |
| Production needs `prisma migrate deploy`                                                  | PR description must say "requires `migrate deploy` on next deploy" — see memory `project_milestone_slug_migration_trap.md`.                                            |
| Unsaved draft loss when canceling Dialog                                                  | Accepted v1 behavior; shadcn Dialog default close.                                                                                                                     |

## Relationship to sibling tasks

- **LUM-64** (merged, PR #107): layer1 sediment. This task reuses its schemas and render.
- **LUM-68** (auto-scope): manual `Promote to project` is the human override on top of its automation.
- **LUM-69** (auto-promote): same. Once auto-promote ships, this task's button becomes a manual-override / confirm path.

## Implementation surface (handoff to writing-plans)

Order of work the plan will sequence:

1. **Schema migration** — add `updatedAt`, `createdByMemberId`; update layer1/2 call sites with `createdByMemberId: null`.
2. **Repository extensions** — `listForProject`, `listForTask`, `update`, `findByIdWithWorkspace`.
3. **Service** — `memory-management.service.ts` (new file).
4. **Validation** — `lib/validation/memory.ts` (new file).
5. **API routes** — 4 new route files under `app/api/`.
6. **API client** — `lib/api-client/memories.ts` (new file) + index re-export.
7. **Hook** — `useMemories`.
8. **Components** — `MemoryEditDialog`, four category forms, `MemoryListItem`, `MemoryTab`.
9. **Tab wiring** — `TimelineTabs.tsx` and `ProjectDetailPage.tsx`.
10. **i18n fan-out** — 17 locales × ~33 keys.
11. **Tests** — per the testing section.

PR title (per CLAUDE.md): `feat: memory management UI — create/edit/promote/delete [LUM-70]`.
Branch: `lumo/LUM-70-memory-management-ui`.
