# Quick Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `Cmd+K` quick dispatch input that parses natural language into task fields, shows a confirmation card, and creates the task in one step.

**Architecture:** A new API route (`/api/tasks/parse-quick-dispatch`) uses Claude to extract structured task fields from natural language input, matching against the workspace's projects and members. A new `QuickDispatchModal` component provides the minimal input box → confirmation card → create flow. It reuses the existing `handleCreateTask` from WorkspaceApp and the existing field select components.

**Tech Stack:** Next.js API route, Vercel AI SDK (`generateObject`), Zod schemas, React (shadcn Modal + existing field selects), react-intl for i18n.

---

### Task 1: AI Prompt & Response Schema (`lib/prompts/quick-dispatch.ts`)

**Files:**

- Create: `lib/prompts/quick-dispatch.ts`
- Test: `__tests__/quick-dispatch-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/quick-dispatch-prompt.test.ts
import {
  QUICK_DISPATCH_SYSTEM_PROMPT,
  QuickDispatchResponseSchema,
  buildQuickDispatchPrompt,
} from '@/lib/prompts/quick-dispatch'

describe('QUICK_DISPATCH_SYSTEM_PROMPT', () => {
  it('includes priority mapping keywords', () => {
    expect(QUICK_DISPATCH_SYSTEM_PROMPT).toContain('URGENT')
    expect(QUICK_DISPATCH_SYSTEM_PROMPT).toContain('HIGH')
    expect(QUICK_DISPATCH_SYSTEM_PROMPT).toContain('MEDIUM')
    expect(QUICK_DISPATCH_SYSTEM_PROMPT).toContain('LOW')
  })
})

describe('buildQuickDispatchPrompt', () => {
  const projects = [
    { id: 'p1', name: 'Lumo Backend', description: 'API server' },
    { id: 'p2', name: 'Lumo Frontend', description: null },
  ]
  const members = [
    { name: 'Chao', actorId: 'a1' },
    { name: 'Alice', actorId: 'a2' },
  ]

  it('includes user input in prompt', () => {
    const result = buildQuickDispatchPrompt({
      input: '帮 Chao 做一个 P1 的 OAuth 集成',
      projects,
      members,
      currentDate: '2026-04-07',
    })
    expect(result).toContain('帮 Chao 做一个 P1 的 OAuth 集成')
  })

  it('includes project list with IDs', () => {
    const result = buildQuickDispatchPrompt({
      input: 'test',
      projects,
      members,
      currentDate: '2026-04-07',
    })
    expect(result).toContain('p1')
    expect(result).toContain('Lumo Backend')
    expect(result).toContain('p2')
    expect(result).toContain('Lumo Frontend')
  })

  it('includes member list with actor IDs', () => {
    const result = buildQuickDispatchPrompt({
      input: 'test',
      projects,
      members,
      currentDate: '2026-04-07',
    })
    expect(result).toContain('a1')
    expect(result).toContain('Chao')
    expect(result).toContain('a2')
    expect(result).toContain('Alice')
  })

  it('includes current date for relative date resolution', () => {
    const result = buildQuickDispatchPrompt({
      input: 'test',
      projects,
      members,
      currentDate: '2026-04-07',
    })
    expect(result).toContain('2026-04-07')
  })
})

describe('QuickDispatchResponseSchema', () => {
  it('accepts a fully populated response', () => {
    const valid = {
      title: 'OAuth 集成',
      description: '<p>实现 OAuth 2.0 登录集成</p>',
      priority: 'URGENT',
      projectId: 'p1',
      projectName: 'Lumo Backend',
      assigneeActorId: 'a1',
      assigneeName: 'Chao',
      dueDate: '2026-04-08T00:00:00.000Z',
      status: 'TODO',
      titleTooVague: false,
      missingProject: false,
    }
    expect(QuickDispatchResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts response with null optional fields', () => {
    const valid = {
      title: 'Fix bug',
      description: '<p>Fix the bug</p>',
      priority: 'MEDIUM',
      projectId: 'p1',
      projectName: 'Lumo Backend',
      assigneeActorId: null,
      assigneeName: null,
      dueDate: null,
      status: 'TODO',
      titleTooVague: false,
      missingProject: false,
    }
    expect(QuickDispatchResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a vague title response', () => {
    const valid = {
      title: 'new task',
      description: '',
      priority: 'MEDIUM',
      projectId: null,
      projectName: null,
      assigneeActorId: null,
      assigneeName: null,
      dueDate: null,
      status: 'TODO',
      titleTooVague: true,
      missingProject: true,
    }
    expect(QuickDispatchResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid priority', () => {
    const invalid = {
      title: 'Test',
      description: '',
      priority: 'CRITICAL',
      projectId: null,
      projectName: null,
      assigneeActorId: null,
      assigneeName: null,
      dueDate: null,
      status: 'TODO',
      titleTooVague: false,
      missingProject: false,
    }
    expect(QuickDispatchResponseSchema.safeParse(invalid).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/quick-dispatch-prompt.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// lib/prompts/quick-dispatch.ts
import { z } from 'zod'

export const QUICK_DISPATCH_SYSTEM_PROMPT = `You are a task dispatcher for a project management tool. Parse the user's natural language input into structured task fields.

Priority mapping:
- P0, P1, 紧急, urgent, blocker → URGENT
- P2, 高, high, important → HIGH
- P3, 中, medium, normal (or no priority mentioned) → MEDIUM
- P4, 低, low, minor, nice-to-have → LOW

Status mapping:
- doing, 进行中, in progress, started → IN_PROGRESS
- review, 评审, in review → IN_REVIEW
- done, 完成, finished → DONE
- (default or no status mentioned) → TODO

Rules:
1. Extract a clear, actionable task title. Remove meta-info (assignee names, dates, priority keywords) from the title.
2. Match assignee names against the provided member list using fuzzy matching. Output the exact actorId from the list.
3. Match project references against the provided project list using fuzzy matching. Output the exact projectId from the list.
4. Parse dates relative to the provided current date. Output ISO 8601 datetime (midnight UTC).
5. Generate a concise 1-2 sentence HTML description focused on execution steps. Use only: <p>, <strong>, <code>, <ul>/<li>.
6. Set titleTooVague=true if the title is generic/meaningless: "new task", "新任务", "做个东西", "task", "something", "test", or under 4 meaningful characters.
7. Set missingProject=true if no project could be confidently matched from the input.
8. If a field is not mentioned or cannot be resolved, use null for optional fields and MEDIUM/TODO for defaults.`

export const QuickDispatchResponseSchema = z.object({
  title: z.string().describe('Clean task title with meta-info removed'),
  description: z
    .string()
    .describe('1-2 sentence HTML description of execution steps'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  projectId: z
    .string()
    .nullable()
    .describe('Matched project ID from the provided list, or null'),
  projectName: z
    .string()
    .nullable()
    .describe('Matched project name for display, or null'),
  assigneeActorId: z
    .string()
    .nullable()
    .describe('Matched member actorId from the provided list, or null'),
  assigneeName: z
    .string()
    .nullable()
    .describe('Matched member name for display, or null'),
  dueDate: z
    .string()
    .nullable()
    .describe('ISO 8601 datetime string, or null if no date mentioned'),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']),
  titleTooVague: z
    .boolean()
    .describe('True if the extracted title is too generic to be useful'),
  missingProject: z
    .boolean()
    .describe('True if no project could be confidently resolved'),
})

export type QuickDispatchResponse = z.infer<typeof QuickDispatchResponseSchema>

interface BuildPromptParams {
  input: string
  projects: { id: string; name: string; description: string | null }[]
  members: { name: string; actorId: string }[]
  currentDate: string
}

export function buildQuickDispatchPrompt({
  input,
  projects,
  members,
  currentDate,
}: BuildPromptParams): string {
  const projectList = projects
    .map(
      p =>
        `- id="${p.id}" name="${p.name}"${p.description ? ` description="${p.description}"` : ''}`
    )
    .join('\n')

  const memberList = members
    .map(m => `- name="${m.name}" actorId="${m.actorId}"`)
    .join('\n')

  return `Current date: ${currentDate}

<projects>
${projectList}
</projects>

<members>
${memberList}
</members>

<user_input>${input}</user_input>`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/quick-dispatch-prompt.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/prompts/quick-dispatch.ts __tests__/quick-dispatch-prompt.test.ts
git commit -m "feat: add quick dispatch prompt and response schema [LUM-19]"
```

---

### Task 2: Validation Schema (`lib/validation/schemas.ts`)

**Files:**

- Modify: `lib/validation/schemas.ts`
- Test: `__tests__/quick-dispatch-prompt.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/quick-dispatch-prompt.test.ts`:

```typescript
import { quickDispatchSchema } from '@/lib/validation/schemas'

describe('quickDispatchSchema', () => {
  it('accepts valid input', () => {
    const valid = {
      input: '帮 Chao 做一个 P1 的 OAuth 集成，明天截止',
      workspaceUrl: 'my-workspace',
    }
    expect(quickDispatchSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects empty input', () => {
    const invalid = { input: '', workspaceUrl: 'my-workspace' }
    expect(quickDispatchSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects missing workspaceUrl', () => {
    const invalid = { input: 'some task' }
    expect(quickDispatchSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects input over 500 chars', () => {
    const invalid = { input: 'a'.repeat(501), workspaceUrl: 'ws' }
    expect(quickDispatchSchema.safeParse(invalid).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/quick-dispatch-prompt.test.ts --no-coverage`
Expected: FAIL — `quickDispatchSchema` not exported

- [ ] **Step 3: Add schema to validation file**

Add to the end of `lib/validation/schemas.ts`, before the closing of the file (after `suggestPrioritySchema`):

```typescript
// ─── Quick Dispatch ─────────────────────────────────────────────────────────

export const quickDispatchSchema = z.object({
  input: z
    .string()
    .trim()
    .min(1, 'Input is required')
    .max(500, 'Input must be at most 500 characters'),
  workspaceUrl: z.string().min(1, 'Workspace URL is required'),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/quick-dispatch-prompt.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/validation/schemas.ts __tests__/quick-dispatch-prompt.test.ts
git commit -m "feat: add quick dispatch validation schema [LUM-19]"
```

---

### Task 3: API Route (`app/api/tasks/parse-quick-dispatch/route.ts`)

**Files:**

- Create: `app/api/tasks/parse-quick-dispatch/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
// app/api/tasks/parse-quick-dispatch/route.ts
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { quickDispatchSchema } from '@/lib/validation/schemas'
import {
  QUICK_DISPATCH_SYSTEM_PROMPT,
  QuickDispatchResponseSchema,
  buildQuickDispatchPrompt,
} from '@/lib/prompts/quick-dispatch'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = quickDispatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { input, workspaceUrl } = parsed.data

    // Verify workspace membership
    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const workspaceId = wsResult.workspace.id

    // Fetch projects and members for context
    const [projects, memberRows] = await Promise.all([
      prisma.project.findMany({
        where: { workspaceId, isIdea: false },
        select: { id: true, name: true, description: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: {
          actor: { select: { id: true, displayName: true } },
          user: { select: { name: true } },
        },
      }),
    ])

    const members = memberRows
      .filter(m => m.actor !== null)
      .map(m => ({
        name: m.actor!.displayName ?? m.user?.name ?? 'Unknown',
        actorId: m.actor!.id,
      }))

    const currentDate = new Date().toISOString().split('T')[0]

    const prompt = buildQuickDispatchPrompt({
      input,
      projects,
      members,
      currentDate,
    })

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: QuickDispatchResponseSchema,
      system: QUICK_DISPATCH_SYSTEM_PROMPT,
      prompt,
    })

    return NextResponse.json(object)
  } catch (error) {
    console.error('POST /api/tasks/parse-quick-dispatch error:', error)
    return NextResponse.json(
      { error: 'Failed to parse task input' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify — check Prisma schema for member/actor relations**

Before committing, verify that the Prisma query shape above matches the actual schema. Run:

```bash
npx tsc --noEmit 2>&1 | grep "parse-quick-dispatch"
```

Expected: No errors for this file. If there are type errors with the `workspaceMember` query, adjust the `select` to match the actual Prisma schema fields.

- [ ] **Step 3: Commit**

```bash
git add app/api/tasks/parse-quick-dispatch/route.ts
git commit -m "feat: add quick dispatch API route [LUM-19]"
```

---

### Task 4: i18n Keys

**Files:**

- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/zh.json`

- [ ] **Step 1: Add English i18n keys**

Add before the closing `}` in `lib/i18n/en.json`:

```json
  "quickDispatch.title": "Quick Dispatch",
  "quickDispatch.placeholder": "Describe a task in one sentence...",
  "quickDispatch.parsing": "Parsing...",
  "quickDispatch.confirm": "Create task",
  "quickDispatch.edit": "Edit",
  "quickDispatch.cancel": "Cancel",
  "quickDispatch.back": "Back",
  "quickDispatch.titleVague": "Please describe the task more specifically",
  "quickDispatch.missingProject": "Please specify a project, e.g. add the project name",
  "quickDispatch.fieldTitle": "Title",
  "quickDispatch.fieldProject": "Project",
  "quickDispatch.fieldPriority": "Priority",
  "quickDispatch.fieldAssignee": "Assignee",
  "quickDispatch.fieldDueDate": "Due date",
  "quickDispatch.fieldStatus": "Status",
  "quickDispatch.fieldDescription": "Description",
  "quickDispatch.none": "None",
  "quickDispatch.created": "Task created"
```

- [ ] **Step 2: Add Chinese i18n keys**

Add before the closing `}` in `lib/i18n/zh.json`:

```json
  "quickDispatch.title": "快速派发",
  "quickDispatch.placeholder": "用一句话描述任务...",
  "quickDispatch.parsing": "解析中...",
  "quickDispatch.confirm": "创建任务",
  "quickDispatch.edit": "编辑",
  "quickDispatch.cancel": "取消",
  "quickDispatch.back": "返回",
  "quickDispatch.titleVague": "请更具体地描述任务",
  "quickDispatch.missingProject": "请指定项目，例如加上项目名",
  "quickDispatch.fieldTitle": "标题",
  "quickDispatch.fieldProject": "项目",
  "quickDispatch.fieldPriority": "优先级",
  "quickDispatch.fieldAssignee": "负责人",
  "quickDispatch.fieldDueDate": "截止日期",
  "quickDispatch.fieldStatus": "状态",
  "quickDispatch.fieldDescription": "描述",
  "quickDispatch.none": "无",
  "quickDispatch.created": "任务已创建"
```

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/en.json lib/i18n/zh.json
git commit -m "feat: add quick dispatch i18n keys [LUM-19]"
```

---

### Task 5: `useQuickDispatch` Hook

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useQuickDispatch.ts`

- [ ] **Step 1: Create the hook**

```typescript
// app/workspace/[workspaceUrl]/hooks/useQuickDispatch.ts
'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import type { QuickDispatchResponse } from '@/lib/prompts/quick-dispatch'
import { apiFetch } from '../utils'

type DispatchPhase = 'input' | 'loading' | 'preview' | 'editing'

export function useQuickDispatch() {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [phase, setPhase] = useState<DispatchPhase>('input')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<QuickDispatchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const parse = useCallback(
    async (rawInput: string) => {
      const trimmed = rawInput.trim()
      if (!trimmed) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setError(null)
      setPhase('loading')

      try {
        const res = await apiFetch('/api/tasks/parse-quick-dispatch', {
          method: 'POST',
          body: { input: trimmed, workspaceUrl },
        })

        if (controller.signal.aborted) return

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? 'Failed to parse input')
        }

        const data: QuickDispatchResponse = await res.json()
        setResult(data)

        // If validation issues, stay in input phase with error message
        if (data.titleTooVague || data.missingProject) {
          setPhase('input')
        } else {
          setPhase('preview')
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setPhase('input')
      }
    },
    [workspaceUrl]
  )

  const enterEditMode = useCallback(() => {
    setPhase('editing')
  }, [])

  const exitEditMode = useCallback(() => {
    setPhase('preview')
  }, [])

  const updateField = useCallback(
    <K extends keyof QuickDispatchResponse>(
      key: K,
      value: QuickDispatchResponse[K]
    ) => {
      setResult(prev => (prev ? { ...prev, [key]: value } : prev))
    },
    []
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setInput('')
    setResult(null)
    setError(null)
  }, [])

  const backToInput = useCallback(() => {
    setPhase('input')
  }, [])

  return {
    phase,
    input,
    setInput,
    result,
    error,
    parse,
    enterEditMode,
    exitEditMode,
    updateField,
    reset,
    backToInput,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useQuickDispatch.ts
git commit -m "feat: add useQuickDispatch hook [LUM-19]"
```

---

### Task 6: QuickDispatchModal Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/modals/QuickDispatchModal.tsx`

- [ ] **Step 1: Create the modal component**

```typescript
// app/workspace/[workspaceUrl]/components/modals/QuickDispatchModal.tsx
'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { AnimatePresence } from 'motion/react'
import { Loader2 } from 'lucide-react'
import { Modal } from '../Modal'
import { Button } from '@/components/ui/button'
import {
  StatusSelect,
  ProjectSelect,
  AssigneeSelect,
  PrioritySelect,
  DueDatePicker,
  PRIORITY_CONFIG,
  FIELD_TRIGGER_CLS,
} from '../TaskFieldSelects'
import { DescriptionEditor } from '../DescriptionEditor'
import { useQuickDispatch } from '../../hooks/useQuickDispatch'
import type { NewTaskFormData } from './NewTaskModal'
import type {
  ApiProject,
  ApiPriority,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { isSubmitShortcut } from '../../utils'

interface QuickDispatchModalProps {
  isOpen: boolean
  onClose: () => void
  projects: ApiProject[]
  members: WorkspaceMemberInfo[]
  onSubmit: (data: NewTaskFormData) => Promise<void>
}

export function QuickDispatchModal({
  isOpen,
  onClose,
  projects,
  members,
  onSubmit,
}: QuickDispatchModalProps) {
  const intl = useIntl()
  const {
    phase,
    input,
    setInput,
    result,
    error,
    parse,
    enterEditMode,
    exitEditMode,
    updateField,
    reset,
    backToInput,
  } = useQuickDispatch()

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const handleSubmit = useCallback(() => {
    if (!result || !result.projectId) return

    const data: NewTaskFormData = {
      title: result.title,
      description: result.description,
      status: result.status as ApiStatus,
      priority: result.priority as ApiPriority,
      projectId: result.projectId,
      assigneeId: result.assigneeActorId ?? '',
      repositoryId: null,
      dueDate: result.dueDate,
    }

    reset()
    onClose()
    onSubmit(data).catch(() => {})
  }, [result, reset, onClose, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (phase === 'input' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        parse(input)
      }
      if (phase === 'preview' && isSubmitShortcut(e)) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        if (phase === 'editing') {
          exitEditMode()
        } else if (phase === 'preview') {
          backToInput()
        } else {
          handleClose()
        }
      }
    },
    [phase, input, parse, handleSubmit, exitEditMode, backToInput, handleClose]
  )

  const priorityConfig =
    result && result.priority in PRIORITY_CONFIG
      ? PRIORITY_CONFIG[result.priority as ApiPriority]
      : null

  const memberName =
    result?.assigneeName ??
    members.find(m => m.actorId === result?.assigneeActorId)?.name ??
    null

  return (
    <AnimatePresence>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={intl.formatMessage({ id: 'quickDispatch.title' })}
        expandable={false}
        footer={
          phase === 'preview' || phase === 'editing' ? (
            <div className='flex items-center gap-3 ml-auto'>
              {phase === 'editing' ? (
                <Button variant='ghost' onClick={exitEditMode}>
                  {intl.formatMessage({ id: 'quickDispatch.back' })}
                </Button>
              ) : (
                <>
                  <Button variant='ghost' onClick={backToInput}>
                    {intl.formatMessage({ id: 'quickDispatch.back' })}
                  </Button>
                  <Button variant='outline' onClick={enterEditMode}>
                    {intl.formatMessage({ id: 'quickDispatch.edit' })}
                  </Button>
                </>
              )}
              <Button
                onClick={handleSubmit}
                disabled={!result?.projectId}
              >
                {intl.formatMessage({ id: 'quickDispatch.confirm' })}
              </Button>
            </div>
          ) : undefined
        }
      >
        {() => (
          <div onKeyDown={handleKeyDown}>
            {/* ── Input Phase ──────────────────────────── */}
            {(phase === 'input' || phase === 'loading') && (
              <div className='space-y-3'>
                <div className='relative'>
                  <input
                    autoFocus
                    className='w-full bg-transparent border-none p-0 text-lg font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
                    placeholder={intl.formatMessage({
                      id: 'quickDispatch.placeholder',
                    })}
                    type='text'
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    disabled={phase === 'loading'}
                  />
                </div>
                {phase === 'loading' && (
                  <div className='flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400'>
                    <Loader2 className='size-4 animate-spin' />
                    {intl.formatMessage({ id: 'quickDispatch.parsing' })}
                  </div>
                )}
                {error && (
                  <div className='rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400'>
                    {error}
                  </div>
                )}
                {result?.titleTooVague && (
                  <div className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'>
                    {intl.formatMessage({ id: 'quickDispatch.titleVague' })}
                  </div>
                )}
                {result?.missingProject && !result?.titleTooVague && (
                  <div className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'>
                    {intl.formatMessage({
                      id: 'quickDispatch.missingProject',
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Preview Phase (read-only card) ────────── */}
            {phase === 'preview' && result && (
              <div className='space-y-3'>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldTitle',
                  })}
                >
                  <span className='font-medium text-zinc-900 dark:text-zinc-100'>
                    {result.title}
                  </span>
                </FieldRow>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldProject',
                  })}
                >
                  <span>{result.projectName ?? '—'}</span>
                </FieldRow>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldPriority',
                  })}
                >
                  {priorityConfig && (
                    <span className='flex items-center gap-1.5'>
                      <priorityConfig.Icon
                        size={14}
                        className={priorityConfig.iconColor}
                      />
                      {priorityConfig.label}
                    </span>
                  )}
                </FieldRow>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldAssignee',
                  })}
                >
                  <span>
                    {memberName ??
                      intl.formatMessage({ id: 'quickDispatch.none' })}
                  </span>
                </FieldRow>
                <FieldRow
                  label={intl.formatMessage({
                    id: 'quickDispatch.fieldDueDate',
                  })}
                >
                  <span>
                    {result.dueDate
                      ? new Date(result.dueDate).toLocaleDateString()
                      : intl.formatMessage({ id: 'quickDispatch.none' })}
                  </span>
                </FieldRow>
                {result.description && (
                  <FieldRow
                    label={intl.formatMessage({
                      id: 'quickDispatch.fieldDescription',
                    })}
                  >
                    <div
                      className='prose prose-sm max-w-none text-zinc-600 dark:prose-invert dark:text-zinc-400'
                      dangerouslySetInnerHTML={{
                        __html: result.description,
                      }}
                    />
                  </FieldRow>
                )}
              </div>
            )}

            {/* ── Editing Phase ─────────────────────────── */}
            {phase === 'editing' && result && (
              <div className='space-y-4'>
                <input
                  className='w-full bg-transparent border-none p-0 text-lg font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
                  type='text'
                  value={result.title}
                  onChange={e => updateField('title', e.target.value)}
                />
                <DescriptionEditor
                  value={result.description || null}
                  onCommit={html => updateField('description', html ?? '')}
                  onChange={html => updateField('description', html ?? '')}
                />
                <div className='flex flex-wrap items-center gap-2 pt-1'>
                  <StatusSelect
                    value={result.status as ApiStatus}
                    onChange={v => updateField('status', v)}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                  <ProjectSelect
                    value={result.projectId ?? ''}
                    onChange={v => {
                      updateField('projectId', v)
                      const p = projects.find(proj => proj.id === v)
                      updateField('projectName', p?.name ?? null)
                    }}
                    projects={projects}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                  <AssigneeSelect
                    value={result.assigneeActorId ?? null}
                    onChange={v => {
                      updateField('assigneeActorId', v ?? null)
                      const m = members.find(mem => mem.actorId === v)
                      updateField('assigneeName', m?.name ?? null)
                    }}
                    members={members.filter(
                      (m): m is WorkspaceMemberInfo & { actorId: string } =>
                        m.actorId !== null
                    )}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                  <PrioritySelect
                    value={result.priority as ApiPriority}
                    onChange={v => updateField('priority', v)}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                  <DueDatePicker
                    value={result.dueDate}
                    onChange={v => updateField('dueDate', v)}
                    triggerClassName={FIELD_TRIGGER_CLS}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </AnimatePresence>
  )
}

function FieldRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex items-start gap-3'>
      <span className='w-20 shrink-0 text-sm text-zinc-500 dark:text-zinc-400 pt-0.5'>
        {label}
      </span>
      <div className='flex-1 text-sm text-zinc-700 dark:text-zinc-300'>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "QuickDispatchModal"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/modals/QuickDispatchModal.tsx
git commit -m "feat: add QuickDispatchModal component [LUM-19]"
```

---

### Task 7: Wire Up in WorkspaceApp + Global Shortcut

**Files:**

- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`

- [ ] **Step 1: Add import for QuickDispatchModal**

Add to the imports section of `WorkspaceApp.tsx`:

```typescript
import { QuickDispatchModal } from './components/modals/QuickDispatchModal'
```

- [ ] **Step 2: Add state for the modal**

Add next to the `isNewTaskModalOpen` state:

```typescript
const [isQuickDispatchOpen, setIsQuickDispatchOpen] = useState(false)
```

- [ ] **Step 3: Add `Cmd+K` global keyboard shortcut**

Add a `useEffect` in WorkspaceApp (near the other state declarations):

```typescript
useEffect(() => {
  function handleGlobalKeyDown(e: KeyboardEvent) {
    // Cmd+K / Ctrl+K → open quick dispatch
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      fetchMembers()
      fetchProjects()
      setIsQuickDispatchOpen(true)
    }
  }
  window.addEventListener('keydown', handleGlobalKeyDown)
  return () => window.removeEventListener('keydown', handleGlobalKeyDown)
}, [fetchMembers, fetchProjects])
```

- [ ] **Step 4: Render the QuickDispatchModal**

Add next to the existing `NewTaskModal` render block:

```tsx
{
  isQuickDispatchOpen && (
    <QuickDispatchModal
      isOpen={isQuickDispatchOpen}
      onClose={() => setIsQuickDispatchOpen(false)}
      projects={projects}
      members={members}
      onSubmit={handleCreateTask}
    />
  )
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v "similarity.test.ts"`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add app/workspace/[workspaceUrl]/WorkspaceApp.tsx
git commit -m "feat: wire up QuickDispatchModal with Cmd+K shortcut [LUM-19]"
```

---

### Task 8: TypeScript Check + Manual Smoke Test

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit`
Expected: No new errors (only pre-existing `similarity.test.ts` errors)

- [ ] **Step 2: Run all tests**

Run: `npx jest --no-coverage`
Expected: All tests pass (including new `quick-dispatch-prompt.test.ts`)

- [ ] **Step 3: Final commit if any lint fixes were auto-applied**

```bash
git status
# If there are changes from linting:
git add -A && git commit -m "chore: lint fixes for quick dispatch [LUM-19]"
```
