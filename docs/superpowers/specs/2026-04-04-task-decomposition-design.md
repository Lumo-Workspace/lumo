# Task Decomposition Assistant — Design Spec

## Overview

Add an AI-powered "Break down" feature to the Task Detail Panel that decomposes a task into 2-4 actionable subtasks. Users preview, edit, and confirm before subtasks are created.

## UI — Subtasks Section in TaskDetailPanel

A new **Subtasks** section is added below the description area in `TaskDetailPanel.tsx`.

### States

**Default (no children):**

- Section heading "Subtasks"
- `✨ Break down` text button

**Default (has children):**

- List of existing subtasks: status icon + title (clickable, navigates to child task)
- `✨ Break down` button remains available for further decomposition

**Loading:**

- Button replaced by spinner + "AI is generating subtasks..."

**Draft preview (after AI returns):**

- 2-4 draft rows, each with:
  - Editable title input field
  - Delete (X) icon button to remove a draft
- Action bar: "Add all" (primary button) + "Cancel" (ghost button)

**After creation:**

- Drafts disappear, subtask list refreshes to show newly created real tasks

### Component Structure

- `SubtasksSection` — new component rendered inside TaskDetailPanel
  - Receives `taskDetail` (for id, title, description, priority, assigneeActorId, projectId, children)
  - Manages local state: `drafts`, `isGenerating`, `isCreating`
  - Calls decompose API, then batch create API on confirm

## API — Decompose

**`POST /api/tasks/[id]/decompose`**

Generates subtask suggestions without creating database records.

- **Auth:** `auth()` from Clerk, verify user belongs to workspace
- **Input:** Task ID from URL path
- **Logic:**
  1. Fetch task (title + description) from DB
  2. Call LLM via Vercel AI SDK `generateObject` with zod schema
  3. Prompt: given task title and description, produce 2-4 executable subtask titles
- **Output:** `{ subtasks: [{ title: string }] }`
- **Error:** 404 if task not found, 401 if unauthorized, 500 if AI call fails

### AI Details

- Provider: `@ai-sdk/openai` (OpenAI provider for Vercel AI SDK)
- Model: `gpt-4o-mini` (fast, cheap for short structured output)
- Uses `generateObject` with zod schema for guaranteed structured response
- Prompt instructs: return 2-4 subtask titles that are specific, actionable, and collectively cover the parent task

## API — Batch Create

**`POST /api/projects/[id]/tasks/batch`**

Creates multiple tasks in a single transaction.

- **Auth:** `auth()` from Clerk, verify user belongs to workspace
- **Input:**
  ```typescript
  {
    tasks: Array<{
      title: string
      status: 'TODO'
      priority: ApiPriority
      assigneeActorId: string | null
      parentTaskId: string
    }>
  }
  ```
- **Logic:**
  1. Validate input array (max 10 tasks per batch)
  2. Verify parentTaskId exists and belongs to the same project
  3. Create all tasks in a Prisma `$transaction`
  4. Auto-calculate `order` for each (based on existing sibling count)
  5. Fire Pusher events for each created task
- **Output:** `{ tasks: ApiTask[] }`
- **Error:** 400 if validation fails, 404 if project/parent not found, 401 if unauthorized

## Inheritance

Subtasks inherit from parent:

- **Priority** — copied from parent
- **Assignee** — copied from parent (assigneeActorId)

Subtasks use defaults for:

- **Status** — always `TODO`
- **Description** — null

## Dependencies

**New package:**

- `@ai-sdk/openai` — OpenAI provider for Vercel AI SDK (works with existing `ai` package)

**Environment variable:**

- `OPENAI_API_KEY` — required for AI decomposition

**No schema changes needed** — `parentTaskId` and `children` relation already exist in Prisma schema.

## Files to Create/Modify

| File                                                          | Action                           |
| ------------------------------------------------------------- | -------------------------------- |
| `app/api/tasks/[id]/decompose/route.ts`                       | New — AI decompose endpoint      |
| `app/api/projects/[id]/tasks/batch/route.ts`                  | New — batch create endpoint      |
| `app/workspace/[workspaceUrl]/components/SubtasksSection.tsx` | New — UI component               |
| `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx` | Modify — add SubtasksSection     |
| `lib/validation/schemas.ts`                                   | Modify — add batch create schema |

## Out of Scope

- Recursive decomposition (breaking down subtasks further)
- Drag-reorder of subtasks
- Subtask progress bar on parent
- Custom prompt/instructions for decomposition
