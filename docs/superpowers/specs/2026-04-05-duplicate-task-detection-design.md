# Duplicate Task Detection — Design Spec

## Overview

When creating a new task, detect similar/duplicate tasks in the same project and warn the user before creation. Uses a two-phase approach: instant client-side string matching during typing, and AI semantic matching on submit.

## Scope

- **In scope:** Detection within the currently selected project, warning UI, "still create" and "view" actions
- **Out of scope:** Cross-project detection, "merge into" action (future iteration), detection when editing existing tasks

## Architecture

```
User types title
    │
    ├─ debounce 500ms → Client-side matching (bigram + containment)
    │                    → Show inline warning below title (non-blocking)
    │
    └─ Clicks "Create task" → AI semantic matching API
                               → No match: proceed with creation
                               → Has match: show confirmation view (blocking)
```

### Two Phases

| Phase           | Trigger                      | Algorithm                 | Threshold | Max Results         | Blocking?               |
| --------------- | ---------------------------- | ------------------------- | --------- | ------------------- | ----------------------- |
| 1 — Quick match | Title input (debounce 500ms) | Bigram Dice + containment | ≥ 50%     | 3                   | No (inline hint)        |
| 2 — AI match    | Click "Create task"          | Claude Sonnet semantic    | ≥ 40%     | 5 (merged, deduped) | Yes (confirmation view) |

## Phase 1: Client-Side Quick Match

### Algorithm (`lib/similarity.ts`)

Pure function, no dependencies:

1. **Containment check:** If A contains B or B contains A (case-insensitive, trimmed) → score = 1.0
2. **Bigram Dice coefficient:** `2 * |shared bigrams| / |bigrams(A)| + |bigrams(B)|`
   - Normalize: lowercase, trim whitespace
   - Works for both Chinese and English characters
   - Minimum title length: 3 characters (skip if shorter)

### Hook (`useDuplicateCheck.ts`)

```typescript
interface SimilarTask {
  task: ApiTask
  score: number // 0–1
}

function useDuplicateCheck(
  title: string,
  tasks: ApiTask[],
  projectId: string
): {
  clientMatches: SimilarTask[]
  checking: boolean
}
```

- Filter tasks to current `projectId`
- Skip if `title.trim().length < 3`
- Debounce 500ms
- Compute similarity for each task, keep ≥ 0.5, sort descending, take top 3

### UI (`DuplicateWarning.tsx`)

- Renders below the title input field, above AiDescriptionPrompt
- No matches → nothing rendered
- Has matches → amber/yellow hint bar: "发现 N 个相似任务"
  - Expandable list showing: similarity %, task title, task identifier
  - Click a row → `window.open()` opens task detail page in new tab
  - URL: `/workspace/{workspaceUrl}/project/{projectSlug}/tasks/{identifier}`
- Non-blocking: user can continue filling the form and submit normally

## Phase 2: AI Semantic Match

### API Endpoint

`POST /api/tasks/check-duplicates`

**Request:**

```typescript
{
  title: string // new task title (1-500 chars)
  projectId: string // current project ID
}
```

**Response:**

```typescript
{
  matches: {
    taskId: string
    title: string
    number: number
    teamIdentifier: string
    status: string
    score: number // 0–1
    assigneeName: string | null
    priority: string
  }
  ;[]
}
```

### Server Flow

1. `requireAuth()` — verify user is authenticated
2. `loadProjectAndMember()` — verify user has access to the project
3. Query tasks: `prisma.task.findMany` for the project
   - Select: `id, title, number, status, priority, assignee (name), team.identifier`
   - Order by: `updatedAt desc`
   - **TODO: Limit to 200 most recently updated tasks when project has > 200 tasks. Future optimization: use full-text search to pre-filter before sending to AI.**
4. Call `generateObject` via `gateway('anthropic/claude-sonnet-4.5')`:
   - Prompt with XML-delimited user content (injection defense)
   - Zod schema for structured output
5. Filter results ≥ 0.4, sort descending, take top 5
6. Merge with task metadata and return

### AI Prompt Structure

```
You are a duplicate task detector for a project management system.
Given a new task title and a list of existing tasks, identify semantically similar or duplicate tasks.

New task title: <title>{userInput}</title>

Existing tasks:
<tasks>
{taskId}: {taskTitle}
...
</tasks>

Return tasks that are semantically similar, with a similarity score between 0 and 1.
Only include tasks with score >= 0.4. Focus on semantic meaning, not just keyword overlap.
```

### Cost Control

- Only called when user clicks "Create task" — not real-time
- Only task titles sent (no descriptions) to minimize tokens
- Max 200 tasks per query (TODO — see above)

## Submit Interception Flow

### State Machine

```
editing → checking → (no match) → creating
                   → (has match) → confirming → creating (user clicks "仍然创建")
                                              → editing  (user clicks "取消")
```

### States in NewTaskModal

- `editing` — normal form state, user is filling fields
- `checking` — user clicked "Create task", AI API in flight, button shows "检测中..."
- `confirming` — AI found matches, modal body replaced with `DuplicateConfirm` view
- `creating` — user confirmed, proceed with original `onSubmit` flow

### UI: DuplicateConfirm Component

Replaces the modal body when in `confirming` state:

- **Warning banner** (amber): "发现 N 个相似任务，请确认是否重复创建"
- **Match list:** Each item shows:
  - Similarity badge: `相似度 92%` (color-coded: ≥80% red, ≥60% amber, <60% gray)
  - Task title (bold)
  - Meta line: `LUM-12 · In Progress · Chao Li · P1`
  - "查看" button → `window.open()` new tab to task detail
- **Footer actions:**
  - "仍然创建" (primary button) → proceed to create
  - "取消" (ghost button) → return to editing state, form data preserved

### Deduplication

Phase 2 results are merged with Phase 1 results by `taskId`:

- If same task appears in both, use AI score (more accurate)
- Final list: up to 5 items, sorted by score descending

## New Files

| File                                                           | Purpose                                   |
| -------------------------------------------------------------- | ----------------------------------------- |
| `lib/similarity.ts`                                            | Bigram + containment similarity functions |
| `app/workspace/[workspaceUrl]/hooks/useDuplicateCheck.ts`      | Client-side matching hook                 |
| `app/workspace/[workspaceUrl]/components/DuplicateWarning.tsx` | Phase 1 inline hint                       |
| `app/workspace/[workspaceUrl]/components/DuplicateConfirm.tsx` | Phase 2 confirmation view                 |
| `app/api/tasks/check-duplicates/route.ts`                      | AI semantic matching endpoint             |

## Modified Files

| File                        | Change                                                                        |
| --------------------------- | ----------------------------------------------------------------------------- |
| `NewTaskModal.tsx`          | Integrate hook, add state machine, render DuplicateWarning + DuplicateConfirm |
| `lib/validation/schemas.ts` | Add `checkDuplicatesSchema`                                                   |

## Not Modified

- `WorkspaceApp.tsx` — `onSubmit` callback unchanged; interception happens inside modal
- `TaskDrawer.tsx`, `TaskDetailPanel.tsx` — not involved

## Props Flow

```
WorkspaceApp
  └── NewTaskModal (receives tasks?: ApiTask[])
        ├── useDuplicateCheck(title, tasks, projectId)
        ├── DuplicateWarning(clientMatches, workspaceUrl, projectSlug)
        └── DuplicateConfirm(matches, onConfirm, onCancel, workspaceUrl)
```

## Error Handling

- AI API failure → skip detection, proceed with creation (log error, don't block user)
- Network timeout → same as above, with 10s timeout
- Empty project (no tasks) → skip both phases, create directly
