# Task Decomposition Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-powered "Break down" button in TaskDetailPanel that decomposes a task into 2-4 subtasks, previewed as editable drafts, then batch-created.

**Architecture:** New `SubtasksSection` component inside TaskDetailPanel. Two new API routes: `/api/tasks/[id]/decompose` (AI generation) and `/api/projects/[id]/tasks/batch` (batch create). AI calls use Vercel AI SDK with `@ai-sdk/openai` provider.

**Tech Stack:** Next.js 14 App Router, Vercel AI SDK (`ai` + `@ai-sdk/openai`), Prisma, Zod, Tailwind CSS, shadcn/ui, lucide-react.

---

### Task 1: Install `@ai-sdk/openai` dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && npm install @ai-sdk/openai
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && node -e "require('@ai-sdk/openai')" && echo "OK"
```

Expected: `OK` (no errors)

- [ ] **Step 3: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add package.json package-lock.json
git commit -m "chore: install @ai-sdk/openai for task decomposition"
```

---

### Task 2: Add batch create validation schema

**Files:**

- Modify: `lib/validation/schemas.ts`

- [ ] **Step 1: Add `batchCreateTasksSchema` to `lib/validation/schemas.ts`**

Add after the existing `updateTaskSchema` (after line 102):

```typescript
// ─── Batch Task Creation ───────────────────────────────────────────────────

export const batchCreateTasksSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z
          .string()
          .trim()
          .min(1, 'Title is required')
          .max(500, 'Title must be at most 500 characters'),
        status: z
          .enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
          .optional()
          .default('TODO'),
        priority: z
          .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
          .optional()
          .default('MEDIUM'),
        assigneeActorId: z.string().nullable().optional(),
        parentTaskId: z.string(),
      })
    )
    .min(1, 'At least one task is required')
    .max(10, 'Cannot create more than 10 tasks at once'),
})
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add lib/validation/schemas.ts
git commit -m "feat: add batch create tasks validation schema"
```

---

### Task 3: Create decompose API route

**Files:**

- Create: `app/api/tasks/[id]/decompose/route.ts`

- [ ] **Step 1: Create the decompose route**

Create `app/api/tasks/[id]/decompose/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireTaskMember } from '@/lib/api/helpers'

const subtasksSchema = z.object({
  subtasks: z
    .array(z.object({ title: z.string() }))
    .min(2)
    .max(4),
})

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult
  const { id } = await params

  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      project: { select: { workspaceId: true } },
    },
  })

  const memberResult = await requireTaskMember(task, userId)
  if (memberResult instanceof NextResponse) return memberResult

  const prompt = `You are a project management assistant. Given a task, break it down into 2-4 specific, actionable subtasks.

Task title: ${task.title}
${task.description ? `Task description: ${task.description}` : ''}

Rules:
- Return 2-4 subtasks
- Each subtask title should be concise (under 100 characters)
- Subtasks should be specific and actionable
- Together they should cover the full scope of the parent task
- Do not include generic tasks like "testing" or "code review" unless the parent task is specifically about those`

  try {
    const { object } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: subtasksSchema,
      prompt,
    })

    return NextResponse.json(object)
  } catch (error) {
    console.error('[decompose] AI generation failed:', error)
    return NextResponse.json(
      { error: 'Failed to generate subtasks' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/api/tasks/\[id\]/decompose/route.ts
git commit -m "feat: add AI task decompose API route"
```

---

### Task 4: Create batch create API route

**Files:**

- Create: `app/api/projects/[id]/tasks/batch/route.ts`

- [ ] **Step 1: Create the batch create route**

Create `app/api/projects/[id]/tasks/batch/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { batchCreateTasksSchema } from '@/lib/validation/schemas'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult
  const { id: projectId } = await params

  const result = await loadProjectAndMember(projectId, userId)
  if (result instanceof NextResponse) return result
  const { project } = result

  const body = await request.json()
  const parsed = batchCreateTasksSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const { tasks: taskInputs } = parsed.data

  // Verify all parentTaskIds belong to this project
  const parentIds = [...new Set(taskInputs.map(t => t.parentTaskId))]
  const parents = await prisma.task.findMany({
    where: { id: { in: parentIds }, projectId },
    select: { id: true },
  })
  const validParentIds = new Set(parents.map(p => p.id))
  for (const t of taskInputs) {
    if (!validParentIds.has(t.parentTaskId)) {
      return NextResponse.json(
        { error: `Parent task ${t.parentTaskId} not found in this project` },
        { status: 400 }
      )
    }
  }

  // Get teamId from project
  const projectWithTeam = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { teamId: true },
  })

  const tasks = await prisma.$transaction(async tx => {
    // Increment task sequence by the number of tasks to create
    const { taskSeq } = await tx.team.update({
      where: { id: projectWithTeam.teamId },
      data: { taskSeq: { increment: taskInputs.length } },
      select: { taskSeq: true },
    })

    // Count existing children for order calculation
    const siblingCounts = new Map<string, number>()
    for (const parentId of parentIds) {
      const count = await tx.task.count({
        where: { parentTaskId: parentId },
      })
      siblingCounts.set(parentId, count)
    }

    const created = []
    for (let i = 0; i < taskInputs.length; i++) {
      const input = taskInputs[i]
      const siblingCount = siblingCounts.get(input.parentTaskId) ?? 0

      const task = await tx.task.create({
        data: {
          projectId,
          teamId: projectWithTeam.teamId,
          number: taskSeq - taskInputs.length + 1 + i,
          title: input.title,
          status: input.status,
          priority: input.priority,
          assigneeActorId: input.assigneeActorId ?? null,
          parentTaskId: input.parentTaskId,
          order: siblingCount + i,
        },
        include: {
          team: { select: { identifier: true } },
          assignee: {
            select: {
              id: true,
              type: true,
              member: { select: { id: true, clerkId: true } },
              agent: { select: { id: true, name: true, avatarColor: true } },
            },
          },
        },
      })

      created.push({
        ...task,
        teamIdentifier: task.team.identifier,
      })

      siblingCounts.set(input.parentTaskId, siblingCount + i + 1)
    }

    return created
  })

  return NextResponse.json({ tasks }, { status: 201 })
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/api/projects/\[id\]/tasks/batch/route.ts
git commit -m "feat: add batch create tasks API route"
```

---

### Task 5: Create SubtasksSection component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/SubtasksSection.tsx`

- [ ] **Step 1: Create the SubtasksSection component**

Create `app/workspace/[workspaceUrl]/components/SubtasksSection.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Sparkles, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '../utils'
import type { TaskDetail, ApiPriority } from '../types'

interface DraftSubtask {
  id: string
  title: string
}

interface SubtasksSectionProps {
  task: TaskDetail
  onSubtasksCreated: () => void
}

export function SubtasksSection({ task, onSubtasksCreated }: SubtasksSectionProps) {
  const [drafts, setDrafts] = useState<DraftSubtask[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const children = task.children ?? []
  const hasDrafts = drafts.length > 0

  async function handleBreakDown() {
    setError(null)
    setIsGenerating(true)
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/decompose`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to generate subtasks')
      }
      const data = await res.json()
      setDrafts(
        data.subtasks.map((s: { title: string }, i: number) => ({
          id: `draft-${i}`,
          title: s.title,
        }))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsGenerating(false)
    }
  }

  function handleDraftTitleChange(id: string, title: string) {
    setDrafts(prev => prev.map(d => (d.id === id ? { ...d, title } : d)))
  }

  function handleDeleteDraft(id: string) {
    setDrafts(prev => prev.filter(d => d.id !== id))
  }

  async function handleAddAll() {
    const validDrafts = drafts.filter(d => d.title.trim().length > 0)
    if (validDrafts.length === 0) return

    setIsCreating(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/projects/${task.projectId}/tasks/batch`, {
        method: 'POST',
        body: {
          tasks: validDrafts.map(d => ({
            title: d.title.trim(),
            status: 'TODO' as const,
            priority: task.priority as ApiPriority,
            assigneeActorId: task.assigneeActorId,
            parentTaskId: task.id,
          })),
        },
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to create subtasks')
      }
      setDrafts([])
      onSubtasksCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="pt-4">
      <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
        Subtasks
      </p>

      {/* Existing children */}
      {children.length > 0 && (
        <ul className="space-y-1 mb-2">
          {children.map(child => (
            <li
              key={child.id}
              className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 py-1"
            >
              <span className="size-4 rounded border border-zinc-300 dark:border-zinc-600 shrink-0" />
              <span className="truncate">
                {child.title}
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0">
                #{child.number}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Draft subtasks */}
      {hasDrafts && (
        <div className="space-y-1.5 mb-2">
          {drafts.map(draft => (
            <div key={draft.id} className="flex items-center gap-1.5">
              <input
                type="text"
                value={draft.title}
                onChange={e => handleDraftTitleChange(draft.id, e.target.value)}
                className="flex-1 text-sm px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
              <button
                onClick={() => handleDeleteDraft(draft.id)}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleAddAll}
              disabled={isCreating || drafts.every(d => d.title.trim().length === 0)}
            >
              {isCreating ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1" />
                  Creating...
                </>
              ) : (
                'Add all'
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDrafts([])}
              disabled={isCreating}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-500 mb-2">{error}</p>
      )}

      {/* Break down button */}
      {!hasDrafts && (
        <button
          onClick={handleBreakDown}
          disabled={isGenerating}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
        >
          {isGenerating ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              AI is generating subtasks...
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              Break down
            </>
          )}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/workspace/\[workspaceUrl\]/components/SubtasksSection.tsx
git commit -m "feat: add SubtasksSection component for task decomposition"
```

---

### Task 6: Integrate SubtasksSection into TaskDetailPanel

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

- [ ] **Step 1: Add import at the top of TaskDetailPanel.tsx**

Add after the existing imports (around line 64):

```typescript
import { SubtasksSection } from './SubtasksSection'
```

- [ ] **Step 2: Add a `refreshDetail` function**

Inside the component body (after the existing state/effect declarations, around line 400), find any existing re-fetch logic. Look for the `fetchDetail` function that loads `TaskDetail`. We need to expose it so `SubtasksSection` can trigger a refresh.

Find the `fetchDetail` or equivalent function that fetches `/api/tasks/${taskId}` and sets the `task` state. Add a stable reference:

```typescript
const refreshDetail = useCallback(() => {
  // re-trigger the detail fetch — reuse the existing fetchDetail logic
  fetchDetail()
}, [fetchDetail])
```

If `fetchDetail` is defined inside a `useEffect`, extract it to a standalone `useCallback` first.

- [ ] **Step 3: Add SubtasksSection to the render**

Insert after the `CreateBranchDialog` closing tag (line 784) and before the Description section (line 786):

```typescript
        {/* Subtasks */}
        <SubtasksSection
          task={task}
          onSubtasksCreated={refreshDetail}
        />
```

- [ ] **Step 4: Verify the task detail API returns children**

Check that `app/api/tasks/[id]/route.ts` GET handler includes `children` in its Prisma query. If not, add:

```typescript
children: {
  select: { id: true, title: true, number: true },
  orderBy: { order: 'asc' },
},
```

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/workspace/\[workspaceUrl\]/components/TaskDetailPanel.tsx
git add app/api/tasks/\[id\]/route.ts
git commit -m "feat: integrate SubtasksSection into TaskDetailPanel"
```

---

### Task 7: Verify end-to-end and push

- [ ] **Step 1: Ensure `OPENAI_API_KEY` is set in `.env.local`**

Check that `.env.local` contains `OPENAI_API_KEY=sk-...`. If not, add a placeholder and warn the user.

- [ ] **Step 2: Run TypeScript check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Start dev server and test manually**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && npm run dev
```

Open a task detail panel → click "✨ Break down" → verify loading state → verify drafts appear → edit a title → delete one → click "Add all" → verify subtasks appear in the list.

- [ ] **Step 4: Push all commits**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && git push
```
