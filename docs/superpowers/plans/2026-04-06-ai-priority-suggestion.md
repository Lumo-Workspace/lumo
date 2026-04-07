# AI Priority Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating a task, AI silently suggests a priority level based on historical tasks and user preference overrides, displayed inline without blocking the form.

**Architecture:** New Prisma model `PriorityOverride` stores override history. Two new API routes (`suggest-priority`, `priority-override`) handle AI suggestion and override recording. A custom hook `usePrioritySuggestion` manages the two-stage debounce/fetch lifecycle. The existing `PrioritySelect` component is extended with an AI label and tooltip.

**Tech Stack:** Vercel AI SDK (`generateObject`), Zod, Prisma, Next.js App Router API routes, React hooks, shadcn/ui Tooltip/Popover

---

## File Structure

| Action | Path                                                              | Responsibility                                                 |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Modify | `prisma/schema.prisma`                                            | Add `PriorityOverride` model                                   |
| Create | `lib/validation/schemas.ts` (append)                              | Add `suggestPrioritySchema` and `priorityOverrideSchema`       |
| Create | `lib/prompts/priority.ts`                                         | System prompt + user prompt builder + Zod output schema        |
| Create | `app/api/tasks/suggest-priority/route.ts`                         | POST handler for AI suggestion                                 |
| Create | `app/api/tasks/priority-override/route.ts`                        | POST handler to record overrides                               |
| Create | `app/workspace/[workspaceUrl]/hooks/usePrioritySuggestion.ts`     | Debounce, fetch, abort, state management                       |
| Modify | `app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx`    | Add `AiPrioritySelect` wrapper with label + tooltip            |
| Modify | `app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx` | Wire up hook, replace `PrioritySelect` with `AiPrioritySelect` |
| Modify | `lib/i18n/en.json`                                                | Add i18n keys for AI priority UI                               |
| Modify | `lib/i18n/zh.json`                                                | Add i18n keys for AI priority UI                               |
| Create | `__tests__/priority-prompt.test.ts`                               | Tests for prompt builder                                       |
| Create | `__tests__/suggest-priority-api.test.ts`                          | Tests for suggestion API                                       |
| Create | `__tests__/priority-override-api.test.ts`                         | Tests for override API                                         |

---

### Task 1: Prisma Schema — Add PriorityOverride Model

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add PriorityOverride model to schema**

Add the following at the end of `prisma/schema.prisma`, before the closing of the file. Also add the reverse relations on `Task` and `Project`.

```prisma
model PriorityOverride {
  id              String       @id @default(cuid())
  taskId          String
  task            Task         @relation(fields: [taskId], references: [id], onDelete: Cascade)
  memberId        String
  projectId       String
  project         Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  aiSuggested     TaskPriority
  userChosen      TaskPriority
  taskTitle       String
  taskDescription String?
  createdAt       DateTime     @default(now())

  @@index([memberId, projectId])
}
```

Add `priorityOverrides PriorityOverride[]` to the `Task` model's relation list (after `documentMentions`).

Add `priorityOverrides PriorityOverride[]` to the `Project` model's relation list.

- [ ] **Step 2: Generate and apply migration**

Run:

```bash
npx prisma migrate dev --name add-priority-override
```

Expected: Migration created successfully, no errors.

- [ ] **Step 3: Verify Prisma client generation**

Run:

```bash
npx prisma generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add PriorityOverride model for AI priority suggestions [LUM-18]"
```

---

### Task 2: Validation Schemas

**Files:**

- Modify: `lib/validation/schemas.ts`

- [ ] **Step 1: Add suggestPrioritySchema and priorityOverrideSchema**

Append to the end of `lib/validation/schemas.ts`:

```typescript
// ─── AI Priority Suggestion ────────────────────────────────────────────────

export const suggestPrioritySchema = z.object({
  title: z
    .string()
    .trim()
    .min(4, 'Title must be at least 4 characters')
    .max(500),
  projectId: z.string().min(1, 'Project ID is required'),
  description: z.string().max(10000).optional(),
})

export const priorityOverrideSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  aiSuggested: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  userChosen: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  taskTitle: z.string().min(1).max(500),
  taskDescription: z.string().max(10000).optional(),
})
```

- [ ] **Step 2: Commit**

```bash
git add lib/validation/schemas.ts
git commit -m "feat: add validation schemas for priority suggestion [LUM-18]"
```

---

### Task 3: Prompt Builder and Output Schema

**Files:**

- Create: `lib/prompts/priority.ts`
- Test: `__tests__/priority-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/priority-prompt.test.ts`:

```typescript
import {
  buildPriorityPrompt,
  PRIORITY_SYSTEM_PROMPT,
  PrioritySuggestionSchema,
} from '@/lib/prompts/priority'

describe('PRIORITY_SYSTEM_PROMPT', () => {
  it('includes all four priority levels', () => {
    expect(PRIORITY_SYSTEM_PROMPT).toContain('LOW')
    expect(PRIORITY_SYSTEM_PROMPT).toContain('MEDIUM')
    expect(PRIORITY_SYSTEM_PROMPT).toContain('HIGH')
    expect(PRIORITY_SYSTEM_PROMPT).toContain('URGENT')
  })
})

describe('buildPriorityPrompt', () => {
  it('includes task title and project name', () => {
    const result = buildPriorityPrompt({
      title: 'Fix login bug',
      projectName: 'Auth Service',
      historicalTasks: [],
      overrides: [],
    })
    expect(result).toContain('Fix login bug')
    expect(result).toContain('Auth Service')
  })

  it('shows "Not provided" when description is absent', () => {
    const result = buildPriorityPrompt({
      title: 'Fix login bug',
      projectName: 'Auth Service',
      historicalTasks: [],
      overrides: [],
    })
    expect(result).toContain('Not provided')
  })

  it('includes description when provided', () => {
    const result = buildPriorityPrompt({
      title: 'Fix login bug',
      description: 'Users cannot log in after password reset',
      projectName: 'Auth Service',
      historicalTasks: [],
      overrides: [],
    })
    expect(result).toContain('Users cannot log in after password reset')
    expect(result).not.toContain('Not provided')
  })

  it('serializes historical tasks with priority and number', () => {
    const result = buildPriorityPrompt({
      title: 'New task',
      projectName: 'My Project',
      historicalTasks: [
        { id: 'task1', number: 42, title: 'Fix timeout', priority: 'HIGH' },
        { id: 'task2', number: 38, title: 'Add caching', priority: 'MEDIUM' },
      ],
      overrides: [],
    })
    expect(result).toContain('[HIGH] #42 Fix timeout')
    expect(result).toContain('[MEDIUM] #38 Add caching')
  })

  it('serializes override records', () => {
    const result = buildPriorityPrompt({
      title: 'New task',
      projectName: 'My Project',
      historicalTasks: [],
      overrides: [
        { taskTitle: 'Old task', aiSuggested: 'HIGH', userChosen: 'MEDIUM' },
      ],
    })
    expect(result).toContain('"Old task"')
    expect(result).toContain('HIGH')
    expect(result).toContain('MEDIUM')
  })

  it('truncates historical tasks to 50', () => {
    const tasks = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      number: i + 1,
      title: `Task ${i}`,
      priority: 'MEDIUM' as const,
    }))
    const result = buildPriorityPrompt({
      title: 'New',
      projectName: 'P',
      historicalTasks: tasks,
      overrides: [],
    })
    expect(result).toContain('#50')
    expect(result).not.toContain('#51')
  })

  it('truncates overrides to 30', () => {
    const overrides = Array.from({ length: 35 }, (_, i) => ({
      taskTitle: `Override ${i}`,
      aiSuggested: 'HIGH' as const,
      userChosen: 'LOW' as const,
    }))
    const result = buildPriorityPrompt({
      title: 'New',
      projectName: 'P',
      historicalTasks: [],
      overrides,
    })
    expect(result).toContain('Override 29')
    expect(result).not.toContain('Override 30')
  })
})

describe('PrioritySuggestionSchema', () => {
  it('accepts a valid suggestion', () => {
    const valid = {
      priority: 'HIGH',
      reason: 'Affects core auth flow',
      stats: { total: 5, distribution: { HIGH: 3, MEDIUM: 1, URGENT: 1 } },
      similarTasks: [
        { id: 'abc', number: 42, title: 'Fix login', priority: 'HIGH' },
      ],
    }
    expect(PrioritySuggestionSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid priority', () => {
    const invalid = {
      priority: 'CRITICAL',
      reason: 'test',
      stats: { total: 0, distribution: {} },
      similarTasks: [],
    }
    expect(PrioritySuggestionSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects more than 2 similar tasks', () => {
    const invalid = {
      priority: 'HIGH',
      reason: 'test',
      stats: { total: 0, distribution: {} },
      similarTasks: [
        { id: '1', number: 1, title: 'A', priority: 'HIGH' },
        { id: '2', number: 2, title: 'B', priority: 'HIGH' },
        { id: '3', number: 3, title: 'C', priority: 'HIGH' },
      ],
    }
    expect(PrioritySuggestionSchema.safeParse(invalid).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/priority-prompt.test.ts`

Expected: FAIL — module `@/lib/prompts/priority` not found.

- [ ] **Step 3: Write the implementation**

Create `lib/prompts/priority.ts`:

```typescript
import { z } from 'zod'

export const PRIORITY_SYSTEM_PROMPT = `You are a task priority analysis assistant. Based on the project's historical task patterns and user preferences, recommend a priority for the new task.

Priority definitions:
- LOW: Does not affect core functionality, can be deferred
- MEDIUM: Normal iteration requirement
- HIGH: Affects core flows or multiple users
- URGENT: Production incident or blocking issue

When recommending, prioritize:
1. User's historical preferences (override records have highest weight)
2. Priority distribution of similar tasks in the same project
3. Urgency signals in the task description

You MUST reference only tasks from the provided historical task list. Do NOT fabricate task IDs, numbers, or titles.`

export const PrioritySuggestionSchema = z.object({
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  reason: z
    .string()
    .max(100)
    .describe('One-line reason for the recommendation'),
  stats: z.object({
    total: z.number().describe('Number of similar historical tasks found'),
    distribution: z
      .record(z.number())
      .describe(
        'Priority distribution of similar tasks, e.g. { "HIGH": 3, "MEDIUM": 1 }'
      ),
  }),
  similarTasks: z
    .array(
      z.object({
        id: z.string(),
        number: z.number(),
        title: z.string(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
      })
    )
    .max(2)
    .describe('Up to 2 most similar historical tasks'),
})

export type PrioritySuggestion = z.infer<typeof PrioritySuggestionSchema>

interface HistoricalTask {
  id: string
  number: number
  title: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
}

interface OverrideRecord {
  taskTitle: string
  aiSuggested: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  userChosen: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
}

interface BuildPromptParams {
  title: string
  description?: string
  projectName: string
  historicalTasks: HistoricalTask[]
  overrides: OverrideRecord[]
}

const MAX_HISTORICAL_TASKS = 50
const MAX_OVERRIDES = 30

export function buildPriorityPrompt({
  title,
  description,
  projectName,
  historicalTasks,
  overrides,
}: BuildPromptParams): string {
  const truncatedTasks = historicalTasks.slice(0, MAX_HISTORICAL_TASKS)
  const truncatedOverrides = overrides.slice(0, MAX_OVERRIDES)

  const taskLines =
    truncatedTasks.length > 0
      ? truncatedTasks
          .map(t => `[${t.priority}] #${t.number} ${t.title}`)
          .join('\n')
      : 'No historical tasks available.'

  const overrideLines =
    truncatedOverrides.length > 0
      ? truncatedOverrides
          .map(
            o =>
              `"${o.taskTitle}" → AI suggested ${o.aiSuggested}, user chose ${o.userChosen}`
          )
          .join('\n')
      : 'No preference records available.'

  return `## Current Task
Title: ${title}
Description: ${description || 'Not provided'}
Project: ${projectName}

## User's Preference Records in This Project (recent ${MAX_OVERRIDES} overrides)
${overrideLines}

## Project Historical Tasks (recent ${MAX_HISTORICAL_TASKS})
${taskLines}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/priority-prompt.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/prompts/priority.ts __tests__/priority-prompt.test.ts
git commit -m "feat: add prompt builder and schema for priority suggestion [LUM-18]"
```

---

### Task 4: Suggest Priority API Route

**Files:**

- Create: `app/api/tasks/suggest-priority/route.ts`
- Test: `__tests__/suggest-priority-api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/suggest-priority-api.test.ts`:

```typescript
import {
  buildPriorityPrompt,
  PrioritySuggestionSchema,
} from '@/lib/prompts/priority'

// Test the data-fetching and prompt-assembly logic in isolation.
// The actual API route depends on auth + AI SDK which are integration-tested separately.

describe('suggest-priority data assembly', () => {
  it('builds a valid prompt from tasks and overrides', () => {
    const prompt = buildPriorityPrompt({
      title: 'Fix authentication timeout',
      description: 'Users report being logged out after 5 minutes',
      projectName: 'Auth Service',
      historicalTasks: [
        { id: 't1', number: 12, title: 'Add OAuth login', priority: 'HIGH' },
        { id: 't2', number: 8, title: 'Fix session bug', priority: 'URGENT' },
      ],
      overrides: [
        {
          taskTitle: 'Token refresh',
          aiSuggested: 'MEDIUM',
          userChosen: 'HIGH',
        },
      ],
    })

    // Verify prompt structure
    expect(prompt).toContain('Fix authentication timeout')
    expect(prompt).toContain('Users report being logged out after 5 minutes')
    expect(prompt).toContain('Auth Service')
    expect(prompt).toContain('[HIGH] #12 Add OAuth login')
    expect(prompt).toContain('[URGENT] #8 Fix session bug')
    expect(prompt).toContain('"Token refresh"')
  })

  it('handles cold start with no tasks and no overrides', () => {
    const prompt = buildPriorityPrompt({
      title: 'First task ever',
      projectName: 'New Project',
      historicalTasks: [],
      overrides: [],
    })

    expect(prompt).toContain('First task ever')
    expect(prompt).toContain('No historical tasks available')
    expect(prompt).toContain('No preference records available')
  })

  it('output schema validates a well-formed suggestion', () => {
    const suggestion = {
      priority: 'HIGH' as const,
      reason: 'Auth-related issues affect all users',
      stats: {
        total: 3,
        distribution: { HIGH: 2, URGENT: 1 },
      },
      similarTasks: [
        {
          id: 't1',
          number: 12,
          title: 'Add OAuth login',
          priority: 'HIGH' as const,
        },
      ],
    }
    const result = PrioritySuggestionSchema.safeParse(suggestion)
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/suggest-priority-api.test.ts`

Expected: PASS (these test the prompt builder which exists). If these pass immediately, that's fine — they validate the integration contract.

- [ ] **Step 3: Write the API route**

Create `app/api/tasks/suggest-priority/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { suggestPrioritySchema } from '@/lib/validation/schemas'
import {
  PRIORITY_SYSTEM_PROMPT,
  PrioritySuggestionSchema,
  buildPriorityPrompt,
} from '@/lib/prompts/priority'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = suggestPrioritySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { title, projectId, description } = parsed.data

    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult
    const { project } = projectResult

    // Fetch recent tasks for context (any status, ordered by newest)
    const historicalTasks = await prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        number: true,
        title: true,
        priority: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    // Fetch user's override history for this project
    const overrides = await prisma.priorityOverride.findMany({
      where: { memberId: userId, projectId },
      select: {
        taskTitle: true,
        aiSuggested: true,
        userChosen: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })

    const prompt = buildPriorityPrompt({
      title,
      description,
      projectName: project.name,
      historicalTasks,
      overrides,
    })

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: PrioritySuggestionSchema,
      system: PRIORITY_SYSTEM_PROMPT,
      prompt,
    })

    return NextResponse.json(object)
  } catch (error) {
    console.error('POST /api/tasks/suggest-priority error:', error)
    return NextResponse.json(
      { error: 'Failed to generate priority suggestion' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/suggest-priority-api.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/tasks/suggest-priority/route.ts __tests__/suggest-priority-api.test.ts
git commit -m "feat: add suggest-priority API route [LUM-18]"
```

---

### Task 5: Priority Override API Route

**Files:**

- Create: `app/api/tasks/priority-override/route.ts`
- Test: `__tests__/priority-override-api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/priority-override-api.test.ts`:

```typescript
import { priorityOverrideSchema } from '@/lib/validation/schemas'

describe('priorityOverrideSchema', () => {
  it('accepts valid override data', () => {
    const valid = {
      taskId: 'clxyz123',
      projectId: 'clxyz456',
      aiSuggested: 'HIGH',
      userChosen: 'MEDIUM',
      taskTitle: 'Fix login bug',
      taskDescription: 'Users cannot log in',
    }
    expect(priorityOverrideSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts override without description', () => {
    const valid = {
      taskId: 'clxyz123',
      projectId: 'clxyz456',
      aiSuggested: 'HIGH',
      userChosen: 'MEDIUM',
      taskTitle: 'Fix login bug',
    }
    expect(priorityOverrideSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects missing taskId', () => {
    const invalid = {
      projectId: 'clxyz456',
      aiSuggested: 'HIGH',
      userChosen: 'MEDIUM',
      taskTitle: 'Fix login bug',
    }
    expect(priorityOverrideSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects invalid priority value', () => {
    const invalid = {
      taskId: 'clxyz123',
      projectId: 'clxyz456',
      aiSuggested: 'CRITICAL',
      userChosen: 'MEDIUM',
      taskTitle: 'Fix login bug',
    }
    expect(priorityOverrideSchema.safeParse(invalid).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/priority-override-api.test.ts`

Expected: FAIL — `priorityOverrideSchema` not found (if Task 2 not yet done) or PASS (if Task 2 done).

- [ ] **Step 3: Write the API route**

Create `app/api/tasks/priority-override/route.ts`:

```typescript
import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { priorityOverrideSchema } from '@/lib/validation/schemas'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = priorityOverrideSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const {
      taskId,
      projectId,
      aiSuggested,
      userChosen,
      taskTitle,
      taskDescription,
    } = parsed.data

    await prisma.priorityOverride.create({
      data: {
        taskId,
        memberId: userId,
        projectId,
        aiSuggested,
        userChosen,
        taskTitle,
        taskDescription,
      },
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error('POST /api/tasks/priority-override error:', error)
    return NextResponse.json(
      { error: 'Failed to record priority override' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/priority-override-api.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/tasks/priority-override/route.ts __tests__/priority-override-api.test.ts
git commit -m "feat: add priority-override API route [LUM-18]"
```

---

### Task 6: Frontend Hook — usePrioritySuggestion

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/usePrioritySuggestion.ts`

- [ ] **Step 1: Create the hook**

Create `app/workspace/[workspaceUrl]/hooks/usePrioritySuggestion.ts`:

```typescript
'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { apiFetch } from '../utils'
import type { ApiPriority } from '../types'

interface SimilarTask {
  id: string
  number: number
  title: string
  priority: ApiPriority
}

export interface PrioritySuggestion {
  priority: ApiPriority
  reason: string
  stats: {
    total: number
    distribution: Record<string, number>
  }
  similarTasks: SimilarTask[]
}

interface UsePrioritySuggestionOptions {
  projectId: string
  /** Whether the user has manually changed the priority */
  userHasOverridden: boolean
}

const TITLE_DEBOUNCE_MS = 500
const DESCRIPTION_DEBOUNCE_MS = 800
const MIN_TITLE_LENGTH = 4
const TIMEOUT_MS = 5000

export function usePrioritySuggestion({
  projectId,
  userHasOverridden,
}: UsePrioritySuggestionOptions) {
  const [suggestion, setSuggestion] = useState<PrioritySuggestion | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      if (descTimerRef.current) clearTimeout(descTimerRef.current)
    }
  }, [])

  const fetchSuggestion = useCallback(
    async (title: string, description?: string) => {
      if (!projectId || title.trim().length < MIN_TITLE_LENGTH) return

      // Abort previous request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setIsLoading(true)

      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        const res = await fetch('/api/tasks/suggest-priority', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            projectId,
            ...(description ? { description } : {}),
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (res.ok) {
          const data: PrioritySuggestion = await res.json()
          setSuggestion(data)
        }
      } catch {
        // Silent failure — AbortError or network error
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    },
    [projectId]
  )

  /** Call after title input blur or debounce */
  const onTitleChange = useCallback(
    (title: string) => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)

      if (title.trim().length < MIN_TITLE_LENGTH) {
        setSuggestion(null)
        return
      }

      titleTimerRef.current = setTimeout(() => {
        fetchSuggestion(title)
      }, TITLE_DEBOUNCE_MS)
    },
    [fetchSuggestion]
  )

  /** Call after description input blur or debounce */
  const onDescriptionChange = useCallback(
    (title: string, description: string) => {
      if (descTimerRef.current) clearTimeout(descTimerRef.current)

      if (title.trim().length < MIN_TITLE_LENGTH) return

      descTimerRef.current = setTimeout(() => {
        fetchSuggestion(title, description)
      }, DESCRIPTION_DEBOUNCE_MS)
    },
    [fetchSuggestion]
  )

  /** Reset all state (call when modal closes) */
  const reset = useCallback(() => {
    abortRef.current?.abort()
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    if (descTimerRef.current) clearTimeout(descTimerRef.current)
    setSuggestion(null)
    setIsLoading(false)
  }, [])

  return {
    suggestion,
    isLoading,
    onTitleChange,
    onDescriptionChange,
    reset,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/usePrioritySuggestion.ts
git commit -m "feat: add usePrioritySuggestion hook [LUM-18]"
```

---

### Task 7: i18n Keys

**Files:**

- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/zh.json`

- [ ] **Step 1: Add English i18n keys**

Add the following keys to `lib/i18n/en.json` (after the existing `newTask.*` keys):

```json
"priority.aiRecommended": "AI Recommended",
"priority.preferenceRecorded": "Preference recorded",
"priority.recommended": "Recommended: {priority}",
"priority.similarTasks": "{count} similar tasks:",
```

- [ ] **Step 2: Add Chinese i18n keys**

Add the following keys to `lib/i18n/zh.json` (at the same location):

```json
"priority.aiRecommended": "AI 推荐",
"priority.preferenceRecorded": "已记录偏好",
"priority.recommended": "推荐: {priority}",
"priority.similarTasks": "{count} 个类似任务:",
```

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/en.json lib/i18n/zh.json
git commit -m "feat: add i18n keys for AI priority suggestion [LUM-18]"
```

---

### Task 8: AiPrioritySelect Component

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx`

- [ ] **Step 1: Add AiPrioritySelect component**

Add the following imports at the top of `TaskFieldSelects.tsx`:

```typescript
import { Loader2, Sparkles } from 'lucide-react'
```

(Add `Loader2` and `Sparkles` to the existing lucide-react import.)

Also add this import:

```typescript
import type { PrioritySuggestion } from '../../hooks/usePrioritySuggestion'
```

(The `PrioritySuggestion` interface is exported from the hook file.)

Then add this component after the existing `PrioritySelect` function:

```typescript
// ─── AiPrioritySelect ────────────────────────────────────────────────────────

export function AiPrioritySelect({
  value,
  onChange,
  triggerClassName,
  suggestion,
  isLoadingSuggestion,
  overrideRecorded,
}: {
  value: ApiPriority
  onChange: (v: ApiPriority) => void
  triggerClassName?: string
  suggestion: PrioritySuggestion | null
  isLoadingSuggestion: boolean
  overrideRecorded: boolean
}) {
  const intl = useIntl()
  const { label } = PRIORITY_CONFIG[value] ?? PRIORITY_CONFIG.MEDIUM

  const tooltipContent = suggestion ? (
    <div className='space-y-1.5 text-xs max-w-64'>
      <div className='font-medium'>
        {intl.formatMessage(
          { id: 'priority.recommended' },
          { priority: PRIORITY_CONFIG[suggestion.priority]?.label ?? suggestion.priority }
        )}
      </div>
      <div className='text-zinc-400 italic'>"{suggestion.reason}"</div>
      {suggestion.stats.total > 0 && (
        <>
          <div className='text-zinc-400'>
            {intl.formatMessage(
              { id: 'priority.similarTasks' },
              { count: suggestion.stats.total }
            )}{' '}
            {Object.entries(suggestion.stats.distribution)
              .map(([k, v]) => `${k} ×${v}`)
              .join(', ')}
          </div>
          {suggestion.similarTasks.map(t => (
            <div key={t.id} className='text-zinc-500'>
              • #{t.number} {t.title} — {t.priority}
            </div>
          ))}
        </>
      )}
    </div>
  ) : null

  return (
    <div className='flex items-center gap-1'>
      <Select value={value} onValueChange={v => onChange(v as ApiPriority)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger className={triggerClassName}>
              <div className='flex items-center gap-1.5'>
                <PriorityIcon priority={value} />
                <span>{label}</span>
              </div>
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent>Priority</TooltipContent>
        </Tooltip>
        <SelectContent>
          {(
            Object.entries(PRIORITY_CONFIG) as [
              ApiPriority,
              (typeof PRIORITY_CONFIG)[ApiPriority],
            ][]
          ).map(([val, { label: lbl, Icon, iconColor }]) => (
            <SelectItem key={val} value={val}>
              <div className='flex items-center gap-2'>
                <span className={iconColor}>
                  <Icon className='size-4' />
                </span>
                {lbl}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isLoadingSuggestion && (
        <Loader2 className='size-3 animate-spin text-zinc-400' />
      )}

      {!isLoadingSuggestion && suggestion && !overrideRecorded && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex items-center gap-0.5 text-[10px] text-violet-500 cursor-default'>
              <Sparkles className='size-3' />
              {intl.formatMessage({ id: 'priority.aiRecommended' })}
            </span>
          </TooltipTrigger>
          <TooltipContent side='bottom' align='start'>
            {tooltipContent}
          </TooltipContent>
        </Tooltip>
      )}

      {overrideRecorded && (
        <span className='text-[10px] text-emerald-500 animate-fade-out'>
          {intl.formatMessage({ id: 'priority.preferenceRecorded' })}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add fade-out animation**

If not already present, add to `app/globals.css` (or the project's Tailwind CSS config):

```css
@keyframes fade-out {
  0% {
    opacity: 1;
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

.animate-fade-out {
  animation: fade-out 2s ease-out forwards;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx app/globals.css
git commit -m "feat: add AiPrioritySelect component with AI label and tooltip [LUM-18]"
```

---

### Task 9: Wire Up NewTaskModal

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx`

- [ ] **Step 1: Add imports and hook**

Add to imports in `NewTaskModal.tsx`:

```typescript
import { usePrioritySuggestion } from '../../hooks/usePrioritySuggestion'
import {
  StatusSelect,
  AssigneeSelect,
  ProjectSelect,
  AiPrioritySelect,
  DueDatePicker,
  FIELD_TRIGGER_CLS,
} from '../TaskFieldSelects'
```

Replace `PrioritySelect` with `AiPrioritySelect` in the import.

- [ ] **Step 2: Add hook and state to the component**

Inside the `NewTaskModal` function, after the existing `dueDate` state, add:

```typescript
const [userHasOverriddenPriority, setUserHasOverriddenPriority] =
  useState(false)
const [overrideRecorded, setOverrideRecorded] = useState(false)
const aiSuggestedRef = useRef<ApiPriority | null>(null)

const {
  suggestion: prioritySuggestion,
  isLoading: isPriorityLoading,
  onTitleChange: onTitleChangePriority,
  onDescriptionChange: onDescriptionChangePriority,
  reset: resetPrioritySuggestion,
} = usePrioritySuggestion({
  projectId: effectiveProjectId,
  userHasOverridden: userHasOverriddenPriority,
})
```

- [ ] **Step 3: Handle suggestion arrival — auto-apply priority**

Add a `useEffect` after the hook call to apply the suggestion when it arrives:

```typescript
useEffect(() => {
  if (prioritySuggestion && !userHasOverriddenPriority) {
    setPriority(prioritySuggestion.priority)
    aiSuggestedRef.current = prioritySuggestion.priority
  }
}, [prioritySuggestion, userHasOverriddenPriority])
```

- [ ] **Step 4: Wire title input to trigger stage 1**

Update the title `<input>` `onChange` handler:

```typescript
onChange={e => {
  setTitle(e.target.value)
  onTitleChangePriority(e.target.value)
}}
```

- [ ] **Step 5: Wire description editor to trigger stage 2**

Update the `DescriptionEditor` `onChange` callback:

```typescript
onChange={html => {
  descriptionRef.current = html
  setDescriptionValue(html)
  onDescriptionChangePriority(title, html ?? '')
}}
```

- [ ] **Step 6: Handle priority override**

Create a wrapper for priority changes:

```typescript
const handlePriorityChange = (v: ApiPriority) => {
  setPriority(v)
  setUserHasOverriddenPriority(true)
  if (aiSuggestedRef.current && v !== aiSuggestedRef.current) {
    setOverrideRecorded(true)
  }
}
```

- [ ] **Step 7: Record override after task creation**

In the `doCreate` function, after `onSubmit(data)`, add the override recording. Replace the existing `doCreate`:

```typescript
const doCreate = () => {
  const data = {
    title: title.trim(),
    description: descriptionRef.current ?? '',
    status,
    priority,
    projectId: effectiveProjectId,
    assigneeId,
    repositoryId,
    dueDate,
  }

  // Capture override info before reset
  const shouldRecordOverride =
    aiSuggestedRef.current !== null && priority !== aiSuggestedRef.current

  const overridePayload = shouldRecordOverride
    ? {
        projectId: effectiveProjectId,
        aiSuggested: aiSuggestedRef.current!,
        userChosen: priority,
        taskTitle: title.trim(),
        taskDescription: descriptionRef.current ?? undefined,
      }
    : null

  reset()
  onClose()
  onSubmit(data)
    .then(async () => {
      // Record override in background (fire-and-forget)
      // Note: taskId is not available here since onSubmit is async.
      // We'll need the task ID from the creation response.
      // For now, we skip taskId — see alternative approach below.
    })
    .catch(console.error)
}
```

**Important note:** The `doCreate` function doesn't have access to the created task's ID. Instead, modify the approach: record the override with a dedicated call that looks up the most recent task. A simpler approach is to make `onSubmit` return the task ID. However, since `onSubmit` is typed as `Promise<void>`, the override recording should be handled by the parent component that has the task ID after creation.

The cleanest solution: store the override payload in a ref, and let `NewTaskModal` accept an optional `onTaskCreated` callback with the task ID:

Update `NewTaskFormData` to include AI suggestion info:

```typescript
export interface NewTaskFormData {
  title: string
  description: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  assigneeId: string
  repositoryId: string | null
  dueDate: string | null
  aiSuggestedPriority?: ApiPriority | null
}
```

Then in `doCreate`, pass it through:

```typescript
const doCreate = () => {
  const data: NewTaskFormData = {
    title: title.trim(),
    description: descriptionRef.current ?? '',
    status,
    priority,
    projectId: effectiveProjectId,
    assigneeId,
    repositoryId,
    dueDate,
    aiSuggestedPriority: aiSuggestedRef.current,
  }
  reset()
  onClose()
  onSubmit(data).catch(console.error)
}
```

The parent component (which calls the task creation API and gets the task ID back) can then fire the override recording if `data.aiSuggestedPriority !== null && data.aiSuggestedPriority !== data.priority`.

- [ ] **Step 8: Replace PrioritySelect with AiPrioritySelect in JSX**

Replace:

```tsx
<PrioritySelect
  value={priority}
  onChange={setPriority}
  triggerClassName={triggerClass}
/>
```

With:

```tsx
<AiPrioritySelect
  value={priority}
  onChange={handlePriorityChange}
  triggerClassName={triggerClass}
  suggestion={prioritySuggestion}
  isLoadingSuggestion={isPriorityLoading}
  overrideRecorded={overrideRecorded}
/>
```

- [ ] **Step 9: Update reset function**

Add to the existing `reset` function:

```typescript
setUserHasOverriddenPriority(false)
setOverrideRecorded(false)
aiSuggestedRef.current = null
resetPrioritySuggestion()
```

- [ ] **Step 10: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx
git commit -m "feat: wire AI priority suggestion into NewTaskModal [LUM-18]"
```

---

### Task 10: Record Override in Parent Component

**Files:**

- Find and modify the parent component that calls `onSubmit` with `NewTaskFormData`

- [ ] **Step 1: Find the parent component**

Search for where `NewTaskModal` is rendered and `onSubmit` is passed. This is likely in `WorkspaceApp.tsx` or a project detail page. The `onSubmit` handler calls the task creation API and gets the created task back.

- [ ] **Step 2: Add override recording after task creation**

In the `onSubmit` handler, after the task creation API call succeeds and you have the `taskId`, add:

```typescript
// After successful task creation, record priority override if needed
if (data.aiSuggestedPriority && data.aiSuggestedPriority !== data.priority) {
  apiFetch('/api/tasks/priority-override', {
    method: 'POST',
    body: {
      taskId: createdTask.id, // from the creation API response
      projectId: data.projectId,
      aiSuggested: data.aiSuggestedPriority,
      userChosen: data.priority,
      taskTitle: data.title,
      taskDescription: data.description || undefined,
    },
  }).catch(() => {
    // Silent failure — override recording is non-critical
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add <parent-component-file>
git commit -m "feat: record priority override after task creation [LUM-18]"
```

---

### Task 11: Final Integration Verification

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: No TypeScript errors.

- [ ] **Step 3: Manual verification checklist**

1. Open NewTaskModal
2. Type a task title (4+ characters) → spinner appears next to priority
3. Wait ~1-2 seconds → priority auto-updates, "AI Recommended" label shows
4. Hover the label → tooltip shows reason + stats + similar tasks
5. Change priority manually → label changes to "Preference recorded", fades out
6. Create the task → override is recorded (check DB or network tab)
7. Create another similar task → AI suggestion should reflect your preference

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup for AI priority suggestion [LUM-18]"
```
