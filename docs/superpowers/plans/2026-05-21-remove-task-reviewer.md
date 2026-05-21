# Remove Task Reviewer Field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the `Task.reviewerActorId` field and every UI/API/notification surface that referenced it, while keeping the project `owner` concept and its UI control (renamed from `ReviewerSelect` → `OwnerSelect`).

**Architecture:** Strip the schema first (drop column, drop index, drop relation, delete historical `REVIEWER_CHANGED` activity rows + enum value) so the TypeScript compiler enumerates every remaining reference. Work through the compile errors layer-by-layer: repositories → services → notifications → events → agent-server → API/webhooks → frontend → i18n → tests → docs. The `notifyReviewerOrOwners` helper (and its agent-server twin) is replaced by a slimmer `notifyWorkspaceOwners` helper that contains only the owner fan-out logic. Linear task: [LUM-60](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-60).

**Tech Stack:** Prisma + Postgres, Next.js 14 App Router, TypeScript strict, react-intl (16 locales), Jest.

**Branch:** `lumo/LUM-60-remove-task-reviewer`

**Working tree:** Per the user's worktree preference, work in a sibling worktree at `/Users/chaoli/Desktop/lumo/lumo-LUM-60`. All `git -C <path>` / `cd <path>` patterns from prior plans apply.

---

## File Inventory (informational — derived from Explore agent inventory)

**Schema / migration**
- `prisma/schema.prisma` (Task model, Actor model, TaskActivityType enum)
- `prisma/migrations/<new>/migration.sql`

**Backend — services & repositories**
- `lib/repositories/task.repository.ts`
- `lib/repositories/project.repository.ts`
- `lib/services/task-state.service.ts`
- `lib/services/task-types.ts`
- `lib/services/task-notifications.service.ts`
- `lib/services/task-creation.service.ts`
- `lib/services/quick-dispatch.service.ts`
- `lib/services/project.service.ts`
- `lib/validation/schemas.ts`

**Backend — notifications & events**
- `lib/notifications/notifyReviewerOrOwners.ts` (delete)
- `lib/notifications/notifyWorkspaceOwners.ts` (new)
- `lib/notifications/notifyTaskInReview.ts`
- `lib/notifications/notifyTaskChange.ts`
- `lib/notifications/notifyAgentActions.ts`
- `lib/events/types/task-activity.ts`
- `lib/events/handlers/record-activity.ts`
- `app/api/webhooks/github/handlers.ts`

**Agent-server mirrors**
- `agent-server/src/notifications/notifyReviewerOrOwners.ts` (delete)
- `agent-server/src/notifications/notifyWorkspaceOwners.ts` (new)
- `agent-server/src/notifications/notifyTaskInReview.ts`
- `agent-server/src/notifications/notifyAgentActions.ts`
- `agent-server/src/events/handlers/notify-task-in-review.ts`
- `agent-server/src/events/handlers/notify-spec-ready.ts`

**Frontend**
- `app/workspace/[workspaceUrl]/components/fields/ReviewerSelect.tsx` → rename to `OwnerSelect.tsx`
- `app/workspace/[workspaceUrl]/components/fields/index.ts`
- `app/workspace/[workspaceUrl]/components/TaskFieldsSection.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`
- `app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx`
- `app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectOverviewTab.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActivityTimeline.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CompactActivityItem.tsx`
- `app/workspace/[workspaceUrl]/types.ts`
- `app/workspace/[workspaceUrl]/my-tasks/[identifier]/page.tsx`
- `app/workspace/[workspaceUrl]/project/[slug]/tasks/[identifier]/page.tsx`
- `app/workspace/[workspaceUrl]/hooks/useTaskMutation.ts`
- `app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskHandlers.ts`
- `app/workspace/[workspaceUrl]/hooks/useTaskSync.ts`

**i18n (16 locales)**
- `lib/i18n/{en,en-AU,en-GB,de,es,es-419,fr,ja,ko,zh-CN,zh-TW,vi,hi,id,ms,ru}.json`

**Tests**
- `__tests__/lib/slack/commands.test.ts`
- `__tests__/lib/events/handlers/notify-task-in-review.test.ts`
- `__tests__/lib/events/handlers/notify-spec-ready.test.ts`

**Docs**
- `.claude/skills/lumo/SKILL.md` (out-of-scope line listing reviewer)

---

## Phase 0: Workspace setup

### Task 0.1: Create worktree and branch

**Files:** none yet.

- [ ] **Step 1: Create worktree from main**

Run from main checkout:
```bash
git -C /Users/chaoli/Desktop/lumo/lumo fetch origin
git -C /Users/chaoli/Desktop/lumo/lumo worktree add /Users/chaoli/Desktop/lumo/lumo-LUM-60 -b lumo/LUM-60-remove-task-reviewer origin/main
```
Expected: prints `Preparing worktree (new branch ...)` then `HEAD is now at <sha> ...`.

- [ ] **Step 2: cd into worktree (and pin for state-changing commands)**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60
pwd
```
Expected: `/Users/chaoli/Desktop/lumo/lumo-LUM-60`.

For every subsequent state-changing git/prisma command in this plan, prefix with `git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60` or re-`cd` first — `cwd` is best-effort in this environment.

- [ ] **Step 3: Verify clean state**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 status
npx prisma --version
```
Expected: `nothing to commit, working tree clean`; Prisma version prints.

---

## Phase 1: Schema migration — rip the band-aid

The migration is intentionally first so `npx tsc --noEmit` produces a complete punch-list of remaining references.

### Task 1.1: Update `prisma/schema.prisma`

**Files:**
- Modify: `prisma/schema.prisma:108` (TaskActivityType enum)
- Modify: `prisma/schema.prisma:305` (Actor.reviewerTasks)
- Modify: `prisma/schema.prisma:384,407,432` (Task.reviewerActorId field, reviewer relation, index)

- [ ] **Step 1: Remove `REVIEWER_CHANGED` from the `TaskActivityType` enum**

In `prisma/schema.prisma`, locate the `TaskActivityType` enum (~line 108) and delete the `REVIEWER_CHANGED` line. Leave the surrounding enum values intact.

- [ ] **Step 2: Remove `reviewerTasks` from the `Actor` model**

Locate `reviewerTasks Task[] @relation("TaskReviewer")` in the Actor model (~line 305) and delete that single line.

- [ ] **Step 3: Remove `reviewerActorId`, `reviewer` relation, and the index from the `Task` model**

In the `Task` model:
- Delete the `reviewerActorId String?` field (~line 384).
- Delete the `reviewer Actor? @relation("TaskReviewer", ...)` line (~line 407).
- Delete the `@@index([reviewerActorId])` line (~line 432).

- [ ] **Step 4: Update the comments referencing reviewer in `NotificationType` enum**

In `NotificationType` (~line 65), update the trailing comments so they no longer say "sent to reviewer":
- Line 69 — change `TASK_IN_REVIEW // task moved to IN_REVIEW — sent to reviewer / OWNERs` → `TASK_IN_REVIEW // task moved to IN_REVIEW — sent to workspace owners`
- Line 73 — change `TASK_SPEC_READY // agent generated a spec draft — sent to reviewer` → `TASK_SPEC_READY // agent generated a spec draft — sent to workspace owners`

- [ ] **Step 5: Validate the schema**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx prisma validate
```
Expected: `The schema at prisma/schema.prisma is valid 🚀`.

### Task 1.2: Generate the migration

**Files:**
- Create: `prisma/migrations/<timestamp>_remove_task_reviewer/migration.sql`

- [ ] **Step 1: Generate migration**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx prisma migrate dev --create-only --name remove_task_reviewer
```
Expected: prints `The following migration(s) have been created and applied from new schema changes: <timestamp>_remove_task_reviewer`. `--create-only` keeps it un-applied so we can edit the SQL.

- [ ] **Step 2: Inspect the generated SQL**

Open the new file under `prisma/migrations/<timestamp>_remove_task_reviewer/migration.sql`. Prisma should emit roughly:
```sql
-- DropForeignKey / DropIndex
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_reviewerActorId_fkey";
DROP INDEX "tasks_reviewerActorId_idx";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "reviewerActorId";

-- AlterEnum (Postgres enum value drop pattern)
BEGIN;
CREATE TYPE "TaskActivityType_new" AS ENUM (...without REVIEWER_CHANGED...);
ALTER TABLE "task_activities" ALTER COLUMN "type" TYPE "TaskActivityType_new" USING ("type"::text::"TaskActivityType_new");
ALTER TYPE "TaskActivityType" RENAME TO "TaskActivityType_old";
ALTER TYPE "TaskActivityType_new" RENAME TO "TaskActivityType";
DROP TYPE "TaskActivityType_old";
COMMIT;
```
If Prisma's output materially differs, adapt the rest of this task accordingly.

- [ ] **Step 3: Prepend the `DELETE` for historical activity rows**

Postgres will fail the `ALTER COLUMN ... TYPE USING` step if any row has `type = 'REVIEWER_CHANGED'`. Add a `DELETE` at the very top of the migration file so the enum rewrite proceeds cleanly. The first three lines of `migration.sql` should now be:

```sql
-- Drop historical REVIEWER_CHANGED activity rows before the enum value is removed.
DELETE FROM "task_activities" WHERE "type" = 'REVIEWER_CHANGED';

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_reviewerActorId_fkey";
... (rest unchanged) ...
```

- [ ] **Step 4: Apply the migration locally**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx prisma migrate dev
```
Expected: prints `Applying migration <timestamp>_remove_task_reviewer` and finishes without error. (Prisma will also regenerate the client.)

- [ ] **Step 5: Capture the compile-error baseline**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | tee /tmp/LUM-60-tsc-baseline.txt | tail -50
wc -l /tmp/LUM-60-tsc-baseline.txt
```
Expected: many errors mentioning `reviewerActorId`, `REVIEWER_CHANGED`, `task:reviewer_changed`, `reviewerTasks`. This is the punch-list for the rest of the plan; subsequent phases will drive this count to zero.

- [ ] **Step 6: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add prisma/
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "feat(schema): drop Task.reviewer field and REVIEWER_CHANGED activity [LUM-60]"
```

---

## Phase 2: Backend — repositories, services, validation

### Task 2.1: Strip `reviewerActorId` from `task.repository.ts`

**Files:**
- Modify: `lib/repositories/task.repository.ts:19,52,663,678-698`

- [ ] **Step 1: Remove `reviewerActorId` from `TaskUpdateInput`**

Open `lib/repositories/task.repository.ts`. Find the `TaskUpdateInput` type (~line 19) and delete the `reviewerActorId?: string | null | undefined` line.

- [ ] **Step 2: Remove `reviewer` from `TASK_DETAIL_INCLUDE`**

In `TASK_DETAIL_INCLUDE` (~line 52), delete the `reviewer: { select: { actor: { select: ActorSelectShape } } },` entry.

- [ ] **Step 3: Drop the default-reviewer resolution in the task-creation helper**

Around line 660–700 there's a transaction block that resolves a default reviewer:
```ts
let ownerActorId: string | null = null
if (reviewerActorId) {
  const reviewerActor = await tx.actor.findUnique(...)
  ownerActorId = reviewerActor?.id ?? null
}
// ...
reviewerActorId: ownerActorId,
```
Delete the `reviewerActorId` parameter from this helper's signature, delete the entire reviewer-resolution block, and delete the `reviewerActorId: ownerActorId` field from the `data:` payload it builds. Trace callers (`task-creation.service.ts`, `quick-dispatch.service.ts`) and stop passing the now-removed argument — these will be fixed in Task 2.4 / 2.5 anyway, but updating the signature here surfaces them.

- [ ] **Step 4: Re-run tsc**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep -E "lib/repositories/task.repository" | head -20
```
Expected: no errors mentioning `task.repository.ts`. Errors in *callers* are fine — they'll be fixed in following tasks.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/repositories/task.repository.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(task-repo): drop reviewerActorId field handling [LUM-60]"
```

### Task 2.2: Strip reviewer field from `task-types.ts` + validation schema

**Files:**
- Modify: `lib/services/task-types.ts:17,33`
- Modify: `lib/validation/schemas.ts:124`

- [ ] **Step 1: Remove `reviewerActorId` from `TaskInput`**

In `lib/services/task-types.ts`, delete:
```ts
reviewerActorId?: string | null | undefined
```
from `TaskInput` (line 17 area).

- [ ] **Step 2: Remove `reviewerActorId` from `TaskState`**

Same file, delete:
```ts
reviewerActorId: string | null
```
from `TaskState` (line 33 area).

- [ ] **Step 3: Remove the Zod schema entry**

In `lib/validation/schemas.ts` (line 124), delete the `reviewerActorId: z.string().nullable().optional(),` line.

- [ ] **Step 4: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep -E "task-types|schemas" | head
```
Expected: no errors in these files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/services/task-types.ts lib/validation/schemas.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(types): drop reviewerActorId from TaskInput/TaskState + zod [LUM-60]"
```

### Task 2.3: Strip reviewer logic from `task-state.service.ts`

**Files:**
- Modify: `lib/services/task-state.service.ts:37,62,131-135,161`

- [ ] **Step 1: Remove reviewer validation block**

Open `lib/services/task-state.service.ts`. Around lines 131–135 there is a "Validate reviewer" block:
```ts
// Validate reviewer
if (reviewerActorId !== undefined && reviewerActorId !== null) {
  const actor = await taskRepository.findActorById(reviewerActorId)
  if (!actor || actor.workspaceId !== workspaceId) {
    throw Object.assign(new Error('Reviewer must be a workspace member'), { status: 400 })
  }
}
```
Delete the entire block.

- [ ] **Step 2: Remove the `reviewerActorId` parameter destructure**

Around line 62 the function destructures `reviewerActorId` from its input. Delete just that destructured name from the parameter list.

- [ ] **Step 3: Remove the `reviewerActorId` write back**

Around line 161:
```ts
if (reviewerActorId !== undefined) data.reviewerActorId = reviewerActorId
```
Delete the entire line.

- [ ] **Step 4: Update the JSDoc comment**

Around line 37 there's a comment mentioning "assignee / reviewer workspace membership". Change it to `assignee workspace membership` (no other rephrasing needed).

- [ ] **Step 5: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep -E "task-state" | head
```
Expected: clean for this file.

- [ ] **Step 6: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/services/task-state.service.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(task-state): drop reviewer validation and write path [LUM-60]"
```

### Task 2.4: Strip reviewer from `task-creation.service.ts` + `quick-dispatch.service.ts`

**Files:**
- Modify: `lib/services/task-creation.service.ts:96,160`
- Modify: `lib/services/quick-dispatch.service.ts:156`

- [ ] **Step 1: Remove the two `reviewerActorId: null,` lines in `task-creation.service.ts`**

There are two occurrences (line ~96 and ~160) that default the field on new tasks. Delete both lines. If their host objects are passed to the helper signature updated in Task 2.1 Step 3, double-check that nothing else needs the field.

- [ ] **Step 2: Remove the `reviewerActorId: null,` line in `quick-dispatch.service.ts`**

Line ~156. Same shape — delete the single line.

- [ ] **Step 3: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep -E "task-creation|quick-dispatch" | head
```
Expected: clean for these files.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/services/task-creation.service.ts lib/services/quick-dispatch.service.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(task-create): drop default reviewer field [LUM-60]"
```

### Task 2.5: Strip reviewer-change emission from `task-notifications.service.ts`

**Files:**
- Modify: `lib/services/task-notifications.service.ts:162-171,313`

- [ ] **Step 1: Remove the `task:reviewer_changed` emission block**

Around lines 162–171 there is a block that emits a `task:reviewer_changed` event when `result.changedFields.includes('reviewerActorId')`. Delete the entire block (from the `if` through its closing brace), including the surrounding blank line.

- [ ] **Step 2: Remove `updatedReviewerActorId` from the change notification payload**

Around line 313:
```ts
updatedReviewerActorId: (result.task.reviewerActorId as string) ?? null,
```
Delete this line. The receiving `notifyTaskChange.ts` will lose the corresponding parameter in Task 3.3.

- [ ] **Step 3: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep -E "task-notifications" | head
```
Expected: clean for this file.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/services/task-notifications.service.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(task-notif): drop reviewer change event emission [LUM-60]"
```

### Task 2.6: Update `project.service.ts` comments (no behavior change)

`project.service.ts` already deals with `ownerId` (renamed earlier from `defaultReviewerId`). The remaining references are stale comments / variable names.

**Files:**
- Modify: `lib/services/project.service.ts:18,25,59,141`

- [ ] **Step 1: Rename a misleading local variable**

Line 59: `const reviewerActorId = owner?.actor?.id ?? null` → `const ownerActorId = owner?.actor?.id ?? null`. Update the one downstream use (the next line, `ownerId: reviewerActorId,`) to `ownerId: ownerActorId,`.

- [ ] **Step 2: Update the stale doc comments**

- Line 18 — change "Clerk-resolved reviewer name" → "Clerk-resolved owner name".
- Line 25 — change "Batch-resolve reviewer display names" → "Batch-resolve owner display names".
- Line 141 — change "same id space the UI's ReviewerSelect uses for tasks" → "same id space the UI's OwnerSelect uses for project owner".

(`OwnerSelect` doesn't exist yet — it's introduced in Task 5.1. That's fine; this is a comment.)

- [ ] **Step 3: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "project.service" | head
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/services/project.service.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(project-service): rename stale reviewer references to owner [LUM-60]"
```

### Task 2.7: Drop the doc comment in `project.repository.ts`

**Files:**
- Modify: `lib/repositories/project.repository.ts:160`

- [ ] **Step 1: Update the doc comment**

Line 160 comment "Find project by ID with default reviewer and workspace slug" → "Find project by ID with default owner and workspace slug".

- [ ] **Step 2: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/repositories/project.repository.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "docs(project-repo): drop reviewer wording in jsdoc [LUM-60]"
```

---

## Phase 3: Notifications & events

### Task 3.1: Introduce `notifyWorkspaceOwners` helper (main app)

**Files:**
- Create: `lib/notifications/notifyWorkspaceOwners.ts`

- [ ] **Step 1: Write the new helper**

Create `lib/notifications/notifyWorkspaceOwners.ts` with the owner-fan-out half of the old helper:

```ts
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { getActorClerkId } from '@/lib/actor'
import { pushUserEvent } from '@/lib/integrations/pusher'
import type { NotificationType } from '@prisma/client'

/**
 * Send an inbox notification (and real-time push) to every workspace OWNER,
 * skipping the triggering actor if they are themselves an owner.
 */
export async function notifyWorkspaceOwners(params: {
  workspaceId: string
  taskId: string
  type: NotificationType
  triggerActorId: string | null
}): Promise<void> {
  const { workspaceId, taskId, type, triggerActorId } = params

  const ownerActors = await prisma.actor.findMany({
    where: { workspaceId, type: 'HUMAN', member: { role: 'OWNER' } },
    select: { id: true, member: { select: { clerkId: true } } },
  })
  const recipients = ownerActors.filter(a => a.id !== triggerActorId)
  if (recipients.length === 0) return

  await prisma.notification.createMany({
    data: recipients.map(a => ({
      workspaceId,
      recipientActorId: a.id,
      type,
      taskId,
      triggerActorId,
    })),
  })

  for (const a of recipients) {
    if (a.member?.clerkId) {
      waitUntil(pushUserEvent(a.member.clerkId, { type: 'notification:new' }))
    }
  }
}
```

- [ ] **Step 2: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "notifyWorkspaceOwners" | head
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/notifications/notifyWorkspaceOwners.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "feat(notif): add notifyWorkspaceOwners helper [LUM-60]"
```

### Task 3.2: Rewrite `notifyTaskInReview.ts` against the new helper

**Files:**
- Modify: `lib/notifications/notifyTaskInReview.ts`

- [ ] **Step 1: Read the current file end-to-end**

```bash
sed -n '1,120p' lib/notifications/notifyTaskInReview.ts
```
Confirm what the file does: it has Slack DM logic for the effective reviewer + an inbox call to `notifyReviewerOrOwners`. After the change: Slack DM goes to the project owner (if resolvable to a Clerk ID); inbox call uses `notifyWorkspaceOwners`.

- [ ] **Step 2: Refactor**

Update the file so it:
1. Drops the `reviewerActorId` parameter from its exported function signature.
2. Resolves the project owner's Clerk ID via the existing helpers (the file already uses `ownerActorId`).
3. Sends the Slack DM to that owner's Clerk ID if present (use the same Slack code paths it currently uses for the reviewer).
4. Calls `notifyWorkspaceOwners({ workspaceId, taskId, type: 'TASK_IN_REVIEW', triggerActorId })` instead of `notifyReviewerOrOwners`.
5. Removes the unused `notifyReviewerOrOwners` import.

The exact final shape: read `notifyTaskInReview.ts` and `notifyReviewerOrOwners.ts` together, then keep only what's needed for owner notification.

- [ ] **Step 3: Update all call sites**

```bash
grep -rn "notifyTaskInReview" lib app shared 2>/dev/null
```
For each call site, remove the `reviewerActorId` argument from the call. Most likely callers are `lib/services/task-state.service.ts` and any agent-server / webhook code.

- [ ] **Step 4: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "notifyTaskInReview\|notifyReviewerOrOwners" | head
```
Expected: clean except possibly the agent-server twin (handled in Phase 4).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/notifications/notifyTaskInReview.ts lib/services/task-state.service.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(notif): notify owners directly on task review [LUM-60]"
```

### Task 3.3: Strip `updatedReviewerActorId` from `notifyTaskChange.ts`

**Files:**
- Modify: `lib/notifications/notifyTaskChange.ts:161,172,185`

- [ ] **Step 1: Remove the parameter + payload field**

Open `lib/notifications/notifyTaskChange.ts`. Delete:
- Line 161 — the `updatedReviewerActorId: string | null` parameter type entry.
- Line 172 — its destructure entry.
- Line 185 — the `reviewerActorId: updatedReviewerActorId,` line in the downstream payload.

If removing this field empties out an object literal that no longer has any fields, also delete the now-empty object construction and its surrounding code.

- [ ] **Step 2: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "notifyTaskChange" | head
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/notifications/notifyTaskChange.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(notif): drop reviewer payload from task change [LUM-60]"
```

### Task 3.4: Simplify `resolveReviewerActorId` in `notifyAgentActions.ts`

**Files:**
- Modify: `lib/notifications/notifyAgentActions.ts:88-96,147-160`

- [ ] **Step 1: Drop the `reviewerActorId` parameter and the early-return branch**

Open `lib/notifications/notifyAgentActions.ts`. Around lines 88–96, the helper `resolveReviewerActorId(reviewerActorId, projectOwnerId, ...)` returns `[reviewerActorId]` immediately when set. After the change, this helper only resolves the project owner — so:

1. Rename it to `resolveOwnerRecipients` (or similar — pick a clear name).
2. Drop the `reviewerActorId` parameter and its `if (reviewerActorId) return [reviewerActorId]` block.
3. Keep the rest of the owner-resolution logic untouched.

- [ ] **Step 2: Update the call site**

Around lines 147–160 the helper is called with `task.reviewerActorId, ...`. After Phase 1, `task.reviewerActorId` doesn't exist on the Prisma type — TS will already be erroring on that line. Update the call to pass only the owner args.

- [ ] **Step 3: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "notifyAgentActions" | head
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/notifications/notifyAgentActions.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(notif): drop reviewer recipient resolution [LUM-60]"
```

### Task 3.5: Delete `notifyReviewerOrOwners.ts`

**Files:**
- Delete: `lib/notifications/notifyReviewerOrOwners.ts`

- [ ] **Step 1: Confirm no callers remain**

```bash
grep -rn "notifyReviewerOrOwners" lib app shared agent-server __tests__ 2>/dev/null
```
Expected output: only the file itself, and (until Phase 4) the agent-server twin. If there's anything else in `lib/`, stop and clean it up.

- [ ] **Step 2: Delete the file**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 rm lib/notifications/notifyReviewerOrOwners.ts
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "chore(notif): delete notifyReviewerOrOwners helper [LUM-60]"
```

### Task 3.6: Strip `task:reviewer_changed` from event types + handler

**Files:**
- Modify: `lib/events/types/task-activity.ts:25`
- Modify: `lib/events/handlers/record-activity.ts:53-60`

- [ ] **Step 1: Remove the event type**

In `lib/events/types/task-activity.ts` (line 25), change:
```ts
type: 'task:assignee_changed' | 'task:reviewer_changed'
```
to:
```ts
type: 'task:assignee_changed'
```

If `type` is now a singleton union, you may inline it as the string literal — but the union form keeps the type extensible.

- [ ] **Step 2: Remove the case branch in `record-activity.ts`**

In `lib/events/handlers/record-activity.ts` (lines 53–60), delete the entire `case 'task:reviewer_changed':` block, including its payload construction.

- [ ] **Step 3: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep -E "events/types|record-activity" | head
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/events/
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(events): drop task:reviewer_changed event [LUM-60]"
```

---

## Phase 4: Agent-server mirrors + GitHub webhook

### Task 4.1: Introduce `notifyWorkspaceOwners` in agent-server

**Files:**
- Create: `agent-server/src/notifications/notifyWorkspaceOwners.ts`

- [ ] **Step 1: Mirror the main app helper**

Copy the file written in Task 3.1 into `agent-server/src/notifications/notifyWorkspaceOwners.ts`, adjusting the import paths to whatever agent-server already uses (it has its own `@/lib/...` aliases or relative imports — check the existing `notifyReviewerOrOwners.ts` for the right imports of `prisma`, `getActorClerkId`, `pushUserEvent`).

- [ ] **Step 2: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "agent-server/src/notifications/notifyWorkspaceOwners" | head
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add agent-server/src/notifications/notifyWorkspaceOwners.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "feat(agent-server): add notifyWorkspaceOwners helper [LUM-60]"
```

### Task 4.2: Rewrite agent-server notifications to use the new helper

**Files:**
- Modify: `agent-server/src/notifications/notifyTaskInReview.ts`
- Modify: `agent-server/src/notifications/notifyAgentActions.ts`
- Modify: `agent-server/src/events/handlers/notify-task-in-review.ts`
- Modify: `agent-server/src/events/handlers/notify-spec-ready.ts`

- [ ] **Step 1: Update `agent-server/src/notifications/notifyTaskInReview.ts`**

Mirror the change from Task 3.2 — drop `reviewerActorId` parameter, target owners directly via the new helper.

- [ ] **Step 2: Update `agent-server/src/notifications/notifyAgentActions.ts`**

Mirror Task 3.4 — rename `resolveReviewerActorId` to `resolveOwnerRecipients`, drop the reviewer short-circuit.

- [ ] **Step 3: Update `agent-server/src/events/handlers/notify-task-in-review.ts`**

Around line 18 the select fragment includes `reviewerActorId: true`. Remove that field from the select. Around line 33 the payload object includes `reviewerActorId: task.reviewerActorId,` — delete that line. Update the call to `notifyTaskInReview` to drop the now-removed arg.

- [ ] **Step 4: Update `agent-server/src/events/handlers/notify-spec-ready.ts`**

Same shape as Step 3: drop `reviewerActorId: true` from the select (~line 23) and the `reviewerActorId: task.reviewerActorId,` payload line (~line 35). Change the call to `notifyReviewerOrOwners` (line 31) into a call to `notifyWorkspaceOwners`, passing only `{ workspaceId, taskId, type, triggerActorId }`.

- [ ] **Step 5: Confirm no `notifyReviewerOrOwners` references remain in agent-server**

```bash
grep -rn "notifyReviewerOrOwners" agent-server 2>/dev/null
```
Expected: only the file itself (deleted in Task 4.3).

- [ ] **Step 6: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "agent-server" | head -20
```
Expected: no errors in agent-server.

- [ ] **Step 7: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add agent-server/src/
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(agent-server): drop reviewer-targeted notifications [LUM-60]"
```

### Task 4.3: Delete `agent-server/src/notifications/notifyReviewerOrOwners.ts`

- [ ] **Step 1: Delete**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 rm agent-server/src/notifications/notifyReviewerOrOwners.ts
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "chore(agent-server): delete notifyReviewerOrOwners helper [LUM-60]"
```

### Task 4.4: Strip reviewer block from GitHub webhook handler

**Files:**
- Modify: `app/api/webhooks/github/handlers.ts:155-162`

- [ ] **Step 1: Remove the reviewer notification block**

Around lines 155–162:
```ts
if (task.reviewerActorId) {
  const reviewerClerkId = await getActorClerkId(task.reviewerActorId)
  if (reviewerClerkId) {
    ... sends GitHub-related notification to reviewer ...
  }
}
```
After Phase 1 this won't compile (no `reviewerActorId` on `task`). Replace the block with the owner-equivalent: resolve the project owner's Clerk ID (or workspace owners) and notify them with the same payload. If the receiver of that notification is the same in both branches, you may simplify to one call.

If you find that the reviewer branch was the *only* recipient logic and there's no nearby owner branch to reuse, fall through to `notifyWorkspaceOwners`. Read 30 lines of surrounding context before deciding which approach matches the file's style.

- [ ] **Step 2: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "webhooks/github" | head
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/api/webhooks/github/handlers.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(github): drop reviewer DM branch [LUM-60]"
```

### Task 4.5: Backend integration checkpoint

- [ ] **Step 1: Confirm zero remaining backend references**

```bash
grep -rn "reviewerActorId\|REVIEWER_CHANGED\|task:reviewer_changed\|reviewerTasks\|notifyReviewerOrOwners" \
  lib app/api app/workspace agent-server shared types __tests__ 2>/dev/null \
  | grep -v "app/workspace/.*/components" \
  | grep -v "lib/i18n"
```
Expected: empty (or only the few remaining frontend hooks/types/components that Phase 5–8 will clean up — they show because the grep includes `app/workspace`).

- [ ] **Step 2: Run the test suite (skip frontend-only suites if scope-limiting; `npm test` is fine)**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npm test -- --testPathIgnorePatterns="components|app/workspace"
```
Expected: tests covering the rewritten notifications fail (they're updated in Phase 10). Note the failures; don't fix here.

- [ ] **Step 3: No commit (this is a checkpoint).**

---

## Phase 5: Frontend — rename `ReviewerSelect` → `OwnerSelect`

### Task 5.1: Rename and rework the field component

**Files:**
- Rename: `app/workspace/[workspaceUrl]/components/fields/ReviewerSelect.tsx` → `app/workspace/[workspaceUrl]/components/fields/OwnerSelect.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/fields/index.ts`

- [ ] **Step 1: Read the existing file**

```bash
sed -n '1,80p' app/workspace/[workspaceUrl]/components/fields/ReviewerSelect.tsx
```
Confirm prop names and structure before editing.

- [ ] **Step 2: Rename the file**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 mv app/workspace/[workspaceUrl]/components/fields/ReviewerSelect.tsx app/workspace/[workspaceUrl]/components/fields/OwnerSelect.tsx
```

- [ ] **Step 3: Rewrite identifiers inside the file**

In `OwnerSelect.tsx`:
- `export interface ReviewerSelectProps` → `export interface OwnerSelectProps`
- `export function ReviewerSelect(` → `export function OwnerSelect(`
- Update the default-value prop names from `unassignedLabel = 'No reviewer'` → `unassignedLabel = 'No owner'`
- Update `tooltipText = 'Reviewer — notified when task moves to In Review'` → `tooltipText = 'Owner — notified about project changes'` (or whatever copy matches actual usage; check what ProjectOverviewTab passes in).
- Update the comment "The project-level default reviewer ID..." → "The project-level owner ID..."
- Any local variable `const reviewer = members.find(...)` → `const owner = members.find(...)`; follow through downstream uses.

- [ ] **Step 4: Update the barrel export**

In `app/workspace/[workspaceUrl]/components/fields/index.ts`, change:
```ts
export { ReviewerSelect } from './ReviewerSelect'
```
to:
```ts
export { OwnerSelect } from './OwnerSelect'
```

- [ ] **Step 5: tsc check (expect failures in callers)**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "ReviewerSelect\|OwnerSelect" | head
```
Expected: errors only at the callers we'll fix next.

- [ ] **Step 6: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/workspace/[workspaceUrl]/components/fields/
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(ui): rename ReviewerSelect to OwnerSelect [LUM-60]"
```

### Task 5.2: Update `ProjectOverviewTab.tsx` to use `OwnerSelect`

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectOverviewTab.tsx:17,233`

- [ ] **Step 1: Update import + JSX usage**

In `ProjectOverviewTab.tsx`:
- Change the import `import { ReviewerSelect, FIELD_TRIGGER_CLS } from ...` → `import { OwnerSelect, FIELD_TRIGGER_CLS } from ...`.
- In the JSX at line ~233, change `<ReviewerSelect` → `<OwnerSelect`, and the matching closing tag if present.

- [ ] **Step 2: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep ProjectOverviewTab | head
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectOverviewTab.tsx
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(ui): point ProjectOverviewTab at OwnerSelect [LUM-60]"
```

---

## Phase 6: Frontend — remove reviewer from task UI

### Task 6.1: Strip reviewer slot from `TaskFieldsSection.tsx`

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/TaskFieldsSection.tsx:14,32,56,89-91`

- [ ] **Step 1: Remove the import**

Delete the import for `ReviewerSelect` (was line 14). If a `OwnerSelect` re-export is needed, do *not* add it here — this file is task-side and shouldn't render an owner picker.

- [ ] **Step 2: Remove the prop**

Delete `reviewerActorId: string | null` from the props interface (~line 32) and from the destructure (~line 56).

- [ ] **Step 3: Remove the rendered slot**

Around lines 89–91, delete the `<ReviewerSelect value={reviewerActorId} ...>` JSX block. If there's surrounding wrapper divs or grid cells, delete those too — don't leave an empty cell.

- [ ] **Step 4: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep TaskFieldsSection | head
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/workspace/[workspaceUrl]/components/TaskFieldsSection.tsx
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(ui): drop reviewer slot from TaskFieldsSection [LUM-60]"
```

### Task 6.2: Strip reviewer from `TaskDetailPanel.tsx`

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx:50,88-90,107,126,227,232,236`

- [ ] **Step 1: Remove the reviewer state fields**

In `TaskDetailPanel.tsx`:
- Delete `reviewerActorId: string | null` from the local state type (~line 50).
- Delete the `reviewerActorId: initialTask.reviewerActorId,` initializer line (~line 88).
- Delete the `reviewer: null,` line (~line 90).
- Delete `const projectDefaultReviewerId = task.project?.ownerId ?? null` (~line 107). Inline `task.project?.ownerId ?? null` at the one remaining use, or rename the constant to `projectOwnerId` if it's used in multiple places.
- Update the comment "Members with actorId (non-null only) for AssigneeSelect / ReviewerSelect" (~line 126) → "Members with actorId (non-null only) for AssigneeSelect / OwnerSelect" — though if this panel no longer renders an owner select, drop the OwnerSelect mention entirely.
- Update the comment "Status · Assignee · Reviewer · Project · Priority · Sprint" (~line 227) → "Status · Assignee · Project · Priority · Sprint".
- Drop the `reviewerActorId={task.reviewerActorId ?? null}` prop passed to `<TaskFieldsSection>` (~line 232) — already removed from that component in Task 6.1.
- Drop the `ownerId={projectDefaultReviewerId}` prop passed downstream (~line 236) — if it was only consumed by the now-deleted reviewer slot. If `OwnerSelect` is still rendered somewhere in this panel for project owner editing, leave that prop; otherwise delete.

- [ ] **Step 2: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep TaskDetailPanel | head
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(ui): drop reviewer state from TaskDetailPanel [LUM-60]"
```

### Task 6.3: Strip reviewer from `TaskDetailSidebar.tsx`

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx:14,116,118-120`

- [ ] **Step 1: Remove the reviewer row**

In `TaskDetailSidebar.tsx`:
- Delete the import of `ReviewerSelect` (line 14).
- Around lines 116–120 there's a sidebar row labelled `task.reviewer`. Delete the entire row entry from the rows array (including label, control component, and any commas).

- [ ] **Step 2: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep TaskDetailSidebar | head
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(ui): drop reviewer row from TaskDetailSidebar [LUM-60]"
```

### Task 6.4: Strip reviewer from `TaskDrawer.tsx` and `InboxPage.tsx`

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx:43`
- Modify: `app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx:60`

- [ ] **Step 1: Remove `reviewerActorId` from the prop / task type in both files**

Delete the single `reviewerActorId: string | null` line in each file.

- [ ] **Step 2: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep -E "TaskDrawer|InboxPage" | head
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/workspace/[workspaceUrl]/components/TaskDrawer.tsx app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(ui): drop reviewer field from TaskDrawer/InboxPage [LUM-60]"
```

---

## Phase 7: Frontend — activity timeline

### Task 7.1: Remove `REVIEWER_CHANGED` from filter + renderer

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActivityTimeline.tsx:44-47`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CompactActivityItem.tsx:207-239`

- [ ] **Step 1: Remove the filter entry**

In `ActivityTimeline.tsx`, lines 44–47 define a filter:
```ts
{ id: 'reviewer', labelId: 'activity.filter.reviewer', defaultLabel: 'Reviewer', types: new Set(['REVIEWER_CHANGED']) }
```
Delete this entire filter object (and its trailing comma if it's mid-list).

- [ ] **Step 2: Remove the renderer case**

In `CompactActivityItem.tsx`, locate the `case 'REVIEWER_CHANGED': { ... }` block (lines ~207–239). Delete the entire `case` block, including its closing `}`.

- [ ] **Step 3: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep -E "ActivityTimeline|CompactActivityItem" | head
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/workspace/[workspaceUrl]/components/TaskDetailTimeline/
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(timeline): drop REVIEWER_CHANGED filter and rendering [LUM-60]"
```

---

## Phase 8: Frontend — hooks, types, page queries

### Task 8.1: Strip reviewer from workspace types + page queries

**Files:**
- Modify: `app/workspace/[workspaceUrl]/types.ts:159,320,323`
- Modify: `app/workspace/[workspaceUrl]/my-tasks/[identifier]/page.tsx:57`
- Modify: `app/workspace/[workspaceUrl]/project/[slug]/tasks/[identifier]/page.tsx:49`

- [ ] **Step 1: Delete the type entries**

In `types.ts`:
- Line ~159: delete `reviewerActorId: string | null` from `TaskMetadata`.
- Line ~320: delete `reviewerActorId: string | null` from `Task`.
- Line ~323: delete `reviewer: ActorInfo | null` from `Task`.

If those are the only fields in their containing objects (unlikely), don't leave an empty interface — fold neighbors instead.

- [ ] **Step 2: Delete the `reviewer: { select: ActorSelectShape }` query fragment**

In both page files (~line 57 and ~line 49), delete the `reviewer: { select: ActorSelectShape },` line from the Prisma `include`/`select` block.

- [ ] **Step 3: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep -E "workspace/types|my-tasks/\[identifier\]|project/\[slug\]/tasks/\[identifier\]" | head
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/workspace/[workspaceUrl]/types.ts app/workspace/[workspaceUrl]/my-tasks/[identifier]/page.tsx app/workspace/[workspaceUrl]/project/[slug]/tasks/[identifier]/page.tsx
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(ui): drop reviewer from workspace types and page queries [LUM-60]"
```

### Task 8.2: Strip reviewer from hooks

**Files:**
- Modify: `app/workspace/[workspaceUrl]/hooks/useTaskMutation.ts:21`
- Modify: `app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskHandlers.ts:96,187`
- Modify: `app/workspace/[workspaceUrl]/hooks/useTaskSync.ts:57,68,86-88,142-144,171-173`

- [ ] **Step 1: `useTaskMutation.ts`**

Delete `reviewerActorId: string | null` from the mutation input type (line ~21).

- [ ] **Step 2: `useWorkspaceTaskHandlers.ts`**

- Line ~96: delete `reviewerActorId: string | null` from the task type.
- Line ~187: delete `reviewerActorId: null,` from the default value object.

- [ ] **Step 3: `useTaskSync.ts`**

This file has several sync points. For each, remove the `reviewerActorId` entry:
- Line ~57 equality check `prev.reviewerActorId === liveTask.reviewerActorId` — delete the `&&` chain entry.
- Line ~68 sync assignment `reviewerActorId: liveTask.reviewerActorId,` — delete the line.
- Lines ~86–88, ~142–144, ~171–173 each contain similar assignments — delete each `reviewerActorId: ...,` line.

After editing, ensure the surrounding object literals/conditionals are still syntactically valid.

- [ ] **Step 4: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | grep "hooks/" | head
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add app/workspace/[workspaceUrl]/hooks/
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "refactor(hooks): drop reviewer field sync/mutation [LUM-60]"
```

### Task 8.3: Frontend integration checkpoint

- [ ] **Step 1: Confirm zero frontend references**

```bash
grep -rn "reviewerActorId\|ReviewerSelect\|REVIEWER_CHANGED" app/workspace 2>/dev/null
```
Expected: empty.

- [ ] **Step 2: Full tsc pass**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit 2>&1 | tail -5
```
Expected: `Found 0 errors.`

- [ ] **Step 3: No commit (checkpoint).**

---

## Phase 9: i18n cleanup

### Task 9.1: Remove reviewer keys from all 16 locale files

**Files (modify each):**
- `lib/i18n/en.json`, `lib/i18n/en-AU.json`, `lib/i18n/en-GB.json`, `lib/i18n/de.json`, `lib/i18n/es.json`, `lib/i18n/es-419.json`, `lib/i18n/fr.json`, `lib/i18n/ja.json`, `lib/i18n/ko.json`, `lib/i18n/zh-CN.json`, `lib/i18n/zh-TW.json`, `lib/i18n/vi.json`, `lib/i18n/hi.json`, `lib/i18n/id.json`, `lib/i18n/ms.json`, `lib/i18n/ru.json`

The keys to remove from each:
- `task.reviewer`
- `activity.filter.reviewer`
- `activity.reviewerChanged`
- `activity.reviewerTo`
- `activity.reviewerFromTo`
- `activity.reviewerFromTo.prefix`
- `activity.reviewerFromTo.to`
- `activity.reviewerRemoved`

- [ ] **Step 1: List the keys in each file to confirm presence**

```bash
for f in lib/i18n/*.json; do
  echo "== $f =="
  grep -E '"(task\.reviewer|activity\.[^"]*reviewer[^"]*|activity\.filter\.reviewer)"' "$f" | head
done
```
Confirm every file has these 8 keys (give or take).

- [ ] **Step 2: For each locale file, delete the 8 lines**

Use the `Edit` tool one file at a time. For each `lib/i18n/<lang>.json`, delete the 8 reviewer key lines. Pay attention to trailing commas — JSON doesn't tolerate dangling commas, so if you delete the last key in an object, fix the preceding line's comma.

If a Read shows the keys interleaved with other entries (likely), just edit them one by one.

- [ ] **Step 3: Validate JSON**

```bash
for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK $f" || echo "FAIL $f"; done
```
Expected: every file prints `OK`.

- [ ] **Step 4: Confirm no leftover hits**

```bash
grep -E '"(task\.reviewer|activity\.[^"]*reviewer[^"]*|activity\.filter\.reviewer)"' lib/i18n/*.json
```
Expected: empty.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add lib/i18n/
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "chore(i18n): drop task reviewer keys from all locales [LUM-60]"
```

---

## Phase 10: Tests

### Task 10.1: Update `notify-task-in-review.test.ts`

**Files:**
- Modify: `__tests__/lib/events/handlers/notify-task-in-review.test.ts`

- [ ] **Step 1: Read the file end-to-end**

```bash
sed -n '1,120p' __tests__/lib/events/handlers/notify-task-in-review.test.ts
```
Identify the two tests: "notifies reviewer when task transitions to IN_REVIEW" and "resolves ownerId to actor ID when no task reviewer".

- [ ] **Step 2: Replace the reviewer-specific test**

Delete the first test ("notifies reviewer when task transitions to IN_REVIEW") entirely — there is no reviewer to notify anymore.

- [ ] **Step 3: Rename and rewrite the fallback test**

Rename the second test from "resolves ownerId to actor ID when no task reviewer" to "notifies workspace owners when task transitions to IN_REVIEW". Delete all `reviewerActorId` fixture entries. Update assertions to expect the call to `notifyWorkspaceOwners` (not `notifyReviewerOrOwners`).

- [ ] **Step 4: Run the test**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npm test -- __tests__/lib/events/handlers/notify-task-in-review.test.ts
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add __tests__/lib/events/handlers/notify-task-in-review.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "test(notify-task-in-review): retarget at workspace owners [LUM-60]"
```

### Task 10.2: Update `notify-spec-ready.test.ts`

**Files:**
- Modify: `__tests__/lib/events/handlers/notify-spec-ready.test.ts`

- [ ] **Step 1: Read the file**

```bash
sed -n '1,140p' __tests__/lib/events/handlers/notify-spec-ready.test.ts
```

- [ ] **Step 2: Swap the mock**

Mock `notifyWorkspaceOwners` instead of `notifyReviewerOrOwners`. Update the import and the `as jest.Mock` cast.

- [ ] **Step 3: Delete reviewer-specific fixtures + test cases**

Delete the test "notifies reviewer when agent transitions to INPUT_REQUIRED with spec_review reason" if its sole purpose was reviewer routing. Rewrite the "passes null reviewerActorId when task has no reviewer" test as "notifies workspace owners when agent emits spec_review".

- [ ] **Step 4: Run**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npm test -- __tests__/lib/events/handlers/notify-spec-ready.test.ts
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add __tests__/lib/events/handlers/notify-spec-ready.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "test(notify-spec-ready): retarget at workspace owners [LUM-60]"
```

### Task 10.3: Drop `reviewerId: null` from Slack command tests

**Files:**
- Modify: `__tests__/lib/slack/commands.test.ts:47`

- [ ] **Step 1: Delete the line**

Open the file, find the `reviewerId: null,` line in the fixture (~line 47), delete it. (Note: the field name here is `reviewerId`, not `reviewerActorId` — this likely predates the rename. After the schema drop it's also gone, so a stale fixture must be removed.)

- [ ] **Step 2: Run**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npm test -- __tests__/lib/slack/commands.test.ts
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add __tests__/lib/slack/commands.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "test(slack): drop reviewerId fixture [LUM-60]"
```

### Task 10.4: Full test suite

- [ ] **Step 1: Run everything**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npm test
```
Expected: all tests pass. If anything fails, read the failure trace, fix the root cause (don't paper over), and re-run.

- [ ] **Step 2: No commit unless fixes were needed.**

---

## Phase 11: Docs cleanup + final verification

### Task 11.1: Update `.claude/skills/lumo/SKILL.md`

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: Find the out-of-scope line**

```bash
grep -n "reviewer" .claude/skills/lumo/SKILL.md
```
Expected: one hit in the "Out of scope" section listing reviewer alongside tags, sprint, due date, parent task.

- [ ] **Step 2: Remove the word "reviewer" from that line**

Change:
> The CLI does **not** currently update tags / labels, reviewer, sprint, due date, or parent task.

to:
> The CLI does **not** currently update tags / labels, sprint, due date, or parent task.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 add .claude/skills/lumo/SKILL.md
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 commit -m "docs(skill): drop reviewer from out-of-scope list [LUM-60]"
```

### Task 11.2: Final sweep — zero references

- [ ] **Step 1: Grep for any leftover `reviewer` references in code**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60
grep -rn -iE "reviewerActorId|REVIEWER_CHANGED|task:reviewer_changed|reviewerTasks|notifyReviewerOrOwners|ReviewerSelect" \
  lib app shared agent-server __tests__ prisma/schema.prisma .claude 2>/dev/null
```
Expected: empty.

```bash
grep -rin "reviewer" lib app shared agent-server __tests__ prisma/schema.prisma .claude 2>/dev/null \
  | grep -vE "\.git/|node_modules/|docs/superpowers/plans/"
```
Expected: hits only in unrelated contexts (e.g. unrelated PR-review code, comments using the English word in an unrelated sense). Read each hit. If a hit is clearly tied to the removed field, fix it.

- [ ] **Step 2: tsc check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npx tsc --noEmit
```
Expected: `Found 0 errors.`

- [ ] **Step 3: Full test pass**

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npm test
```
Expected: all green.

- [ ] **Step 4: Smoke-test the UI (dev server)**

Start the dev server, navigate to a task detail page, and confirm:
- No "Reviewer" row in the sidebar.
- Project Overview still has the owner picker (`OwnerSelect`).
- Activity timeline no longer has a "Reviewer" filter.

```bash
cd /Users/chaoli/Desktop/lumo/lumo-LUM-60 && npm run dev
```
(Use the preview MCP tools if available, otherwise verify manually and report findings.)

- [ ] **Step 5: No commit (verification only).**

### Task 11.3: Push branch + open PR

- [ ] **Step 1: Push**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo-LUM-60 push -u origin lumo/LUM-60-remove-task-reviewer
```

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --base main \
  --title "feat: remove reviewer field from task [LUM-60]" \
  --body "$(cat <<'EOF'
## Summary
- Drops `Task.reviewerActorId`, its index, the `REVIEWER_CHANGED` activity type, and historical activity rows of that type.
- Replaces the reviewer-or-owner notification pattern with a `notifyWorkspaceOwners` helper (main app + agent-server).
- Renames `ReviewerSelect` → `OwnerSelect` (component is now used only for the project owner picker).
- Removes 8 reviewer-related i18n keys from all 16 locale files.

## Test plan
- [ ] `npx tsc --noEmit` is clean
- [ ] `npm test` is green
- [ ] Task detail page no longer renders the reviewer row
- [ ] Project Overview still renders the owner picker (`OwnerSelect`)
- [ ] Activity timeline filter no longer shows "Reviewer"
- [ ] Migration applied cleanly to a database that previously had REVIEWER_CHANGED rows

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Mark LUM-60 in-progress, then ready-for-review when the PR opens**

```bash
lumo task update LUM-60 --status in_review
```

---

## Self-Review Notes

Cross-check before executing:
1. **Spec coverage** — every category in the Explore agent's inventory is owned by exactly one Phase task. (Schema → 1, repos/services/validation → 2, notifications/events → 3, agent-server/webhooks → 4, fields rename → 5, task UI → 6, timeline → 7, hooks/types → 8, i18n → 9, tests → 10, docs/CLI → 11.)
2. **Type consistency** — `notifyWorkspaceOwners`, `OwnerSelect`, `resolveOwnerRecipients` are defined in 3.1 / 5.1 / 3.4 respectively and referenced by later tasks under the same names.
3. **Placeholder scan** — no "TBD" / "similar to" steps; every code block shows the actual code or grep command.
4. **Order safety** — schema is dropped first so tsc enumerates the punch-list. Helpers are introduced (3.1, 4.1) before old helpers are deleted (3.5, 4.3). Component rename (5.1) precedes its caller update (5.2) and the deletion of task-side usage (6.x).
5. **Migration safety** — explicit `DELETE FROM "task_activities" WHERE "type" = 'REVIEWER_CHANGED'` is prepended (1.2 step 3) before the Postgres enum-rewrite.
