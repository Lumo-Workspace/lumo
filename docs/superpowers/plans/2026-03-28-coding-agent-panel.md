# Coding Agent Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CodingAgentPanel` to the task right sidebar, allowing tasks to be assigned to the Lumo coding agent with real-time logs, clarify dialogs, and branch/PR display — triggerable by UI button or `@agent` comment mention.

**Architecture:** `assigneeType` field on Task distinguishes human vs. agent assignment. The `CodingAgentPanel` lives in the right-column properties section, subscribes to Pusher for live updates, and replaces the existing `AgentStatus` component. The `@agent` mention in comments triggers automatic assignment + execution.

**Tech Stack:** Prisma (schema), Next.js API routes, Zod validation, Pusher (real-time), Tiptap (mention), shadcn/ui, Tailwind, TypeScript strict.

---

## File Map

| File                                                                 | Change                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                               | Add `assigneeType String?` to Task                                                        |
| `lib/validation/schemas.ts`                                          | Add `assigneeType` to `updateTaskSchema`                                                  |
| `app/workspace/[workspaceUrl]/types.ts`                              | Add `assigneeType`, `sandboxId`, `clarifies` to `TaskDetail`; `assigneeType` to `ApiTask` |
| `app/workspace/[workspaceUrl]/constants.ts`                          | Add `agent` API endpoints                                                                 |
| `app/api/tasks/[id]/route.ts`                                        | GET: include `clarifies` + expose `sandboxId`; PATCH: handle `assigneeType`               |
| `app/api/tasks/[id]/comments/route.ts`                               | Detect `data-id="__agent__"`, assign + fire agent                                         |
| `app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx`       | Add Agent option to `AssigneeSelect`                                                      |
| `app/workspace/[workspaceUrl]/components/MentionList.tsx`            | Add `agent` MentionItem type + render                                                     |
| `app/workspace/[workspaceUrl]/components/mention-suggestion.ts`      | Add agent to suggestion items                                                             |
| `app/workspace/[workspaceUrl]/components/board/SortableTaskCard.tsx` | Show Bot icon when `assigneeType === 'agent'`                                             |
| `components/task/CodingAgentPanel.tsx`                               | **New** — full agent panel component                                                      |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`   | Add CodingAgentPanel to right col; remove old AgentStatus from left col                   |
| `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`        | Add CodingAgentPanel to right properties section                                          |

---

## Task 1: Schema — add `assigneeType` to Task

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, add after `sandboxId String?`:

```prisma
assigneeType   String?      // null | "human" | "agent"
```

The full block becomes:

```prisma
  agentStatus    String?
  agentError     String?
  sandboxId      String?
  assigneeType   String?      // null | "human" | "agent"
  createdAt      DateTime     @default(now())
```

- [ ] **Step 2: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client`

- [ ] **Step 3: Create and apply dev migration**

```bash
DATABASE_URL_UNPOOLED="..." DATABASE_URL="..." npx prisma migrate dev --name add-task-assignee-type
```

Expected: `Your database is now in sync with your schema.`

- [ ] **Step 4: Apply to production**

```bash
DATABASE_URL_UNPOOLED="..." DATABASE_URL="..." npx prisma migrate deploy
```

Expected: `All migrations have been successfully applied.`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add assigneeType to Task schema"
```

---

## Task 2: Types, constants, validation

**Files:**

- Modify: `app/workspace/[workspaceUrl]/types.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `lib/validation/schemas.ts`

- [ ] **Step 1: Add `assigneeType` to `ApiTask`**

In `types.ts`, update `ApiTask`:

```typescript
export interface ApiTask {
  id: string
  title: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  parentTaskId: string | null
  assigneeId: string | null
  assigneeType: string | null // ← add
  reviewerId: string | null
  repositoryId: string | null
  updatedAt: string
  viewOrder: number | null
  number: number
  teamIdentifier: string
  /** Populated when task is loaded via /api/tasks/me */
  project?: { id: string; name: string }
}
```

- [ ] **Step 2: Update `TaskDetail` — add `assigneeType`, `sandboxId`, `clarifies`**

```typescript
export interface AgentClarifyPending {
  id: string
  question: string
  context: string | null
}

export interface TaskDetail {
  id: string
  title: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  project: {
    id: string
    name: string
    defaultReviewerId?: string | null
    githubRepo?: string | null
    repositories?: ApiRepository[]
  }
  parentTaskId: string | null
  assigneeId: string | null
  assigneeType: string | null // ← add
  reviewerId: string | null
  repositoryId: string | null
  assignee: { id: string; clerkId: string } | null
  description: string | null
  updatedAt: string
  number: number
  teamIdentifier: string
  children?: { id: string; title: string; number: number }[]
  pullRequests?: ApiPullRequest[]
  branches?: ApiTaskBranch[]
  agentStatus?: string | null
  agentError?: string | null // ← add
  sandboxId?: string | null // ← add
  spec?: string | null
  clarifies?: AgentClarifyPending[] // ← add (pending only)
}
```

- [ ] **Step 3: Add agent API constants**

In `constants.ts`, add after the `slack` block:

```typescript
  agent: {
    execute: '/api/agent/execute',
    cancel: '/api/agent/cancel',
    retry: '/api/agent/retry',
    resume: '/api/agent/resume',
  },
```

- [ ] **Step 4: Add `assigneeType` to `updateTaskSchema`**

In `lib/validation/schemas.ts`, update `updateTaskSchema`:

```typescript
export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(10000).nullable().optional(),
  spec: z.string().max(20000).nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeId: z.string().nullable().optional(),
  assigneeType: z.enum(['human', 'agent']).nullable().optional(), // ← add
  reviewerId: z.string().nullable().optional(),
  projectId: z.string().optional(),
  parentTaskId: z.string().nullable().optional(),
  repositoryId: z.string().nullable().optional(),
  order: z.number().optional(),
})
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v validator.ts
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/types.ts app/workspace/\[workspaceUrl\]/constants.ts lib/validation/schemas.ts
git commit -m "feat: add assigneeType to types, constants, and validation"
```

---

## Task 3: API — GET task includes clarifies + exposes sandboxId

**Files:**

- Modify: `app/api/tasks/[id]/route.ts` (GET handler, lines 41–100)

- [ ] **Step 1: Add `clarifies` + `sandboxId` to the Prisma include**

In the GET handler's `prisma.task.findUnique`, add after the `branches` include:

```typescript
    clarifies: {
      where: { reply: null },
      select: { id: true, question: true, context: true },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
    },
```

Also add `sandboxId: true` to the scalar fields being selected. The current query uses `include` (not `select`) so all scalars are returned automatically — no extra change needed for `sandboxId`.

The `clarifies` block goes inside the `include` object:

```typescript
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        project: { select: { ... } },
        team: { select: { identifier: true } },
        assignee: { select: { id: true, clerkId: true } },
        pullRequests: { select: { ... }, orderBy: { createdAt: 'desc' } },
        branches: { select: { ... }, orderBy: { createdAt: 'desc' as const } },
        clarifies: {                                    // ← add
          where: { reply: null },
          select: { id: true, question: true, context: true },
          orderBy: { createdAt: 'desc' as const },
          take: 1,
        },
      },
    })
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v validator.ts
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "app/api/tasks/[id]/route.ts"
git commit -m "feat: include clarifies and sandboxId in GET /api/tasks/[id]"
```

---

## Task 4: API — PATCH task handles `assigneeType`

**Files:**

- Modify: `app/api/tasks/[id]/route.ts` (PATCH handler)

- [ ] **Step 1: Extract `assigneeType` from validated body and apply it**

In the PATCH handler, after the existing `const { title, description, ... } = parsed.data` destructuring, add `assigneeType`. Then include it in the Prisma `data` object.

Find the `prisma.task.update` call in the PATCH handler and add `assigneeType` to the data:

```typescript
const updatedTask = await prisma.task.update({
  where: { id },
  data: {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(spec !== undefined && { spec }),
    ...(status !== undefined && { status }),
    ...(priority !== undefined && { priority }),
    ...(assigneeId !== undefined && { assigneeId }),
    ...(assigneeType !== undefined && { assigneeType }), // ← add
    ...(reviewerId !== undefined && { reviewerId }),
    ...(projectId !== undefined && { projectId }),
    ...(parentTaskId !== undefined && { parentTaskId }),
    ...(repositoryId !== undefined && { repositoryId }),
    ...(order !== undefined && { order }),
  },
  // ... existing include
})
```

The `assigneeType` variable comes from `parsed.data`:

```typescript
const {
  title,
  description,
  spec,
  status,
  priority,
  assigneeId,
  assigneeType, // ← add
  reviewerId,
  projectId,
  parentTaskId,
  repositoryId,
  order,
} = parsed.data
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v validator.ts
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "app/api/tasks/[id]/route.ts"
git commit -m "feat: PATCH /api/tasks/[id] supports assigneeType"
```

---

## Task 5: AssigneeSelect — add Agent option

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx` (2 call sites)
- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` (1 call site)

- [ ] **Step 1: Add `Bot` to imports in TaskFieldSelects.tsx**

Change:

```typescript
import { UserCircle2, Eye, ... } from 'lucide-react'
```

To:

```typescript
import { UserCircle2, Bot, Eye, ... } from 'lucide-react'
```

- [ ] **Step 2: Update `AssigneeSelect` props and render**

Replace the existing `AssigneeSelect` function with:

```typescript
export function AssigneeSelect({
  value,
  onChange,
  members,
  triggerClassName,
  isAgentSelected,
  onAgentSelect,
}: {
  value: string | null
  onChange: (v: string | null) => void
  members: WorkspaceMemberInfo[]
  triggerClassName?: string
  isAgentSelected?: boolean
  onAgentSelect?: () => void
}) {
  const assignee = members.find(m => m.id === value)

  function handleChange(v: string) {
    if (v === '__agent__') {
      onAgentSelect?.()
    } else if (v === '__unassigned__') {
      onChange(null)
    } else {
      onChange(v)
    }
  }

  const selectValue = isAgentSelected
    ? '__agent__'
    : (value ?? '__unassigned__')

  return (
    <Select value={selectValue} onValueChange={handleChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            {isAgentSelected ? (
              <div className='flex items-center gap-1.5 text-violet-600 dark:text-violet-400'>
                <Bot size={14} className='shrink-0' />
                <span>Agent</span>
              </div>
            ) : assignee ? (
              <div className='flex items-center gap-1.5'>
                <MemberAvatar member={assignee} size='xs' />
                <span>{assignee.name}</span>
              </div>
            ) : (
              <div className='flex items-center gap-1.5 text-zinc-400'>
                <UserCircle2 size={16} />
                <span>No assignee</span>
              </div>
            )}
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Assignee</TooltipContent>
      </Tooltip>
      <SelectContent>
        <SelectItem value='__unassigned__'>
          <div className='flex items-center gap-2'>
            <UserCircle2 size={16} className='text-zinc-400 shrink-0' />
            <span className='text-zinc-400'>No assignee</span>
          </div>
        </SelectItem>
        <SelectItem value='__agent__'>
          <div className='flex items-center gap-2'>
            <Bot size={14} className='text-violet-600 dark:text-violet-400 shrink-0' />
            <span className='text-violet-600 dark:text-violet-400'>Agent</span>
          </div>
        </SelectItem>
        {members.map(m => (
          <SelectItem key={m.id} value={m.id}>
            <div className='flex items-center gap-2'>
              <MemberAvatar member={m} size='xs' />
              {m.name}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 3: Update AssigneeSelect usage in TaskDetailPanel.tsx**

Find the `AssigneeSelect` usage (~line 576) and replace:

```typescript
          <AssigneeSelect
            value={task.assigneeId ?? null}
            onChange={v => handlePatch({ assigneeId: v })}
            members={members}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
```

With:

```typescript
          <AssigneeSelect
            value={task.assigneeId ?? null}
            isAgentSelected={task.assigneeType === 'agent'}
            onChange={v => handlePatch({ assigneeId: v, assigneeType: v ? 'human' : null })}
            onAgentSelect={() => handlePatch({ assigneeId: null, assigneeType: 'agent' })}
            members={members}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
```

- [ ] **Step 4: Update AssigneeSelect usage in TaskDetailPage.tsx**

Find the `AssigneeSelect` usage (~line 1472) and replace:

```typescript
                      <AssigneeSelect
                        value={task.assigneeId ?? null}
                        onChange={v => handlePatch({ assigneeId: v })}
                        members={members}
                        triggerClassName={FIELD_TRIGGER_CLS}
                      />
```

With:

```typescript
                      <AssigneeSelect
                        value={task.assigneeId ?? null}
                        isAgentSelected={task.assigneeType === 'agent'}
                        onChange={v => handlePatch({ assigneeId: v, assigneeType: v ? 'human' : null })}
                        onAgentSelect={() => handlePatch({ assigneeId: null, assigneeType: 'agent' })}
                        members={members}
                        triggerClassName={FIELD_TRIGGER_CLS}
                      />
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v validator.ts
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx" \
        "app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx" \
        "app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx"
git commit -m "feat: add Agent option to AssigneeSelect"
```

---

## Task 6: Build `CodingAgentPanel` component

**Files:**

- Create: `components/task/CodingAgentPanel.tsx`

- [ ] **Step 1: Create the file**

```typescript
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Pusher from 'pusher-js'
import {
  Bot,
  Play,
  RotateCcw,
  X,
  Loader2,
  GitBranch,
  GitPullRequest,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AgentEvent } from '@/lib/pusher/server'
import type { ApiPullRequest, ApiTaskBranch } from '@/app/workspace/[workspaceUrl]/types'

export interface AgentClarifyPending {
  id: string
  question: string
  context: string | null
}

export interface CodingAgentTask {
  id: string
  assigneeType?: string | null
  agentStatus?: string | null
  agentError?: string | null
  sandboxId?: string | null
  branches?: ApiTaskBranch[]
  pullRequests?: ApiPullRequest[]
  clarifies?: AgentClarifyPending[]
}

interface AgentLog {
  id: string
  type: AgentEvent['type']
  message: string
}

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent:started': return 'Agent started'
    case 'agent:thinking': return event.message
    case 'agent:tool': {
      const labels: Record<string, string> = { Read: 'Reading', Write: 'Writing', Edit: 'Editing', Bash: 'Running' }
      return `${labels[event.tool] ?? event.tool}${event.input ? `: ${event.input}` : ''}`
    }
    case 'agent:progress': return event.message
    case 'agent:clarify': return `Needs clarification: ${event.question}`
    case 'agent:spec_draft': return 'Spec draft ready for review'
    case 'agent:done': return 'Done — PR created'
    case 'agent:failed': return `Failed: ${event.error}`
  }
}

// ── AgentStatusBadge ──────────────────────────────────────────────────────────

function AgentStatusBadge({ status, error }: { status: string; error?: string | null }) {
  const configs: Record<string, { label: string; dot: string; text: string }> = {
    idle:        { label: 'Idle',        dot: 'bg-zinc-400',   text: 'text-zinc-500' },
    running:     { label: 'Running',     dot: 'bg-blue-500 animate-pulse', text: 'text-blue-600 dark:text-blue-400' },
    paused:      { label: 'Waiting',     dot: 'bg-amber-500',  text: 'text-amber-600 dark:text-amber-400' },
    spec_review: { label: 'Spec review', dot: 'bg-amber-500',  text: 'text-amber-600 dark:text-amber-400' },
    done:        { label: 'Done',        dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
    failed:      { label: error ?? 'Failed', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
    cancelled:   { label: 'Cancelled',   dot: 'bg-zinc-400',   text: 'text-zinc-500' },
  }
  const cfg = configs[status] ?? configs.idle
  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}>
      <span className={`inline-block size-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </div>
  )
}

// ── ClarifyPanel ─────────────────────────────────────────────────────────────

function ClarifyPanel({
  clarify,
  taskId,
  sandboxId,
  onReplied,
}: {
  clarify: AgentClarifyPending
  taskId: string
  sandboxId: string | null
  onReplied: () => void
}) {
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!reply.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/agent/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, sandboxId, reply: reply.trim() }),
      })
      onReplied()
    } finally {
      setSubmitting(false)
    }
  }, [taskId, sandboxId, reply, onReplied])

  return (
    <div className='rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2'>
      <div className='flex items-start gap-2'>
        <HelpCircle size={13} className='text-amber-500 mt-0.5 shrink-0' />
        <p className='text-xs text-amber-800 dark:text-amber-200 font-medium leading-snug'>
          {clarify.question}
        </p>
      </div>
      {clarify.context && (
        <p className='text-xs text-amber-700 dark:text-amber-300 pl-5'>{clarify.context}</p>
      )}
      <Textarea
        value={reply}
        onChange={e => setReply(e.target.value)}
        placeholder='Type your answer...'
        className='min-h-[60px] text-xs resize-none'
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
        }}
      />
      <Button
        size='sm'
        className='w-full h-7 text-xs'
        disabled={!reply.trim() || submitting}
        onClick={handleSubmit}
      >
        {submitting ? <Loader2 size={12} className='animate-spin mr-1' /> : null}
        Send reply
      </Button>
    </div>
  )
}

// ── CodingAgentPanel ──────────────────────────────────────────────────────────

export function CodingAgentPanel({
  task,
  onTaskUpdate,
}: {
  task: CodingAgentTask
  onTaskUpdate?: (updates: Partial<CodingAgentTask>) => void
}) {
  if (task.assigneeType !== 'agent') return null

  const [status, setStatus] = useState(task.agentStatus ?? 'idle')
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [clarify, setClarify] = useState<AgentClarifyPending | null>(
    task.clarifies?.[0] ?? null
  )
  const [cancelling, setCancelling] = useState(false)
  const [running, setRunning] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const isFirstRun = !task.branches?.length
  const isRunning = status === 'running'
  const isPaused = status === 'paused'
  const activePr = task.pullRequests?.find(pr => pr.state === 'open')
  const activeBranch = task.branches?.[task.branches.length - 1]

  useEffect(() => {
    setStatus(task.agentStatus ?? 'idle')
  }, [task.agentStatus])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Pusher subscription
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    if (!key || !cluster) return

    const pusher = new Pusher(key, { cluster })
    const channel = pusher.subscribe(`task-${task.id}`)

    channel.bind('agent-update', (event: AgentEvent) => {
      setLogs(prev => [...prev, {
        id: crypto.randomUUID(),
        type: event.type,
        message: formatEvent(event),
      }])

      if (event.type === 'agent:started') {
        setStatus('running')
        onTaskUpdate?.({ agentStatus: 'running' })
      }
      if (event.type === 'agent:clarify') {
        setStatus('paused')
        setClarify({ id: crypto.randomUUID(), question: event.question, context: event.context ?? null })
        onTaskUpdate?.({ agentStatus: 'paused' })
      }
      if (event.type === 'agent:done') {
        setStatus('done')
        onTaskUpdate?.({ agentStatus: 'done' })
      }
      if (event.type === 'agent:failed') {
        const isCancelled = event.error === 'Cancelled by user'
        const next = isCancelled ? 'cancelled' : 'failed'
        setStatus(next)
        onTaskUpdate?.({ agentStatus: next })
      }
    })

    return () => {
      channel.unbind_all()
      pusher.unsubscribe(`task-${task.id}`)
    }
  }, [task.id])

  const handleRun = useCallback(async () => {
    setRunning(true)
    setLogs([])
    try {
      await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
      setStatus('running')
      onTaskUpdate?.({ agentStatus: 'running' })
    } finally {
      setRunning(false)
    }
  }, [task.id])

  const handleCancel = useCallback(async () => {
    setCancelling(true)
    try {
      await fetch('/api/agent/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
    } finally {
      setCancelling(false)
    }
  }, [task.id])

  const handleClarifyReplied = useCallback(() => {
    setClarify(null)
    setStatus('running')
    setLogs([])
    onTaskUpdate?.({ agentStatus: 'running' })
  }, [])

  return (
    <div className='space-y-2'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400'>
          <Bot size={13} />
          Coding Agent
        </div>
        {status !== 'idle' && <AgentStatusBadge status={status} error={task.agentError} />}
      </div>

      {/* Run / Re-run button */}
      {!isRunning && !isPaused && (
        <Button
          size='sm'
          variant={isFirstRun ? 'default' : 'outline'}
          className='w-full h-7 text-xs gap-1.5'
          disabled={running}
          onClick={handleRun}
        >
          {running ? (
            <Loader2 size={12} className='animate-spin' />
          ) : isFirstRun ? (
            <Play size={12} />
          ) : (
            <RotateCcw size={12} />
          )}
          {running ? 'Starting…' : isFirstRun ? 'Run Agent' : 'Re-run Agent'}
        </Button>
      )}

      {/* Cancel button when running */}
      {isRunning && (
        <Button
          size='sm'
          variant='ghost'
          className='w-full h-7 text-xs gap-1.5 text-zinc-400 hover:text-red-500'
          disabled={cancelling}
          onClick={handleCancel}
        >
          {cancelling ? <Loader2 size={12} className='animate-spin' /> : <X size={12} />}
          Cancel
        </Button>
      )}

      {/* Live logs */}
      {isRunning && logs.length > 0 && (
        <div className='rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 max-h-40 overflow-y-auto p-2 space-y-1'>
          {logs.map(log => (
            <div key={log.id} className='text-[11px] text-zinc-500 dark:text-zinc-400 font-mono leading-tight'>
              {log.message}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Clarify */}
      {isPaused && clarify && (
        <ClarifyPanel
          clarify={clarify}
          taskId={task.id}
          sandboxId={task.sandboxId ?? null}
          onReplied={handleClarifyReplied}
        />
      )}

      {/* Active branch */}
      {activeBranch && (
        <div className='space-y-1'>
          <p className='text-[10px] font-semibold uppercase tracking-wider text-zinc-400'>Branch</p>
          <div className='flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300'>
            <GitBranch size={12} className='shrink-0 text-zinc-400' />
            <span className='font-mono truncate'>{activeBranch.branchName}</span>
          </div>
        </div>
      )}

      {/* Active PR */}
      {activePr && (
        <div className='space-y-1'>
          <p className='text-[10px] font-semibold uppercase tracking-wider text-zinc-400'>Pull Request</p>
          <a
            href={activePr.url}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline'
          >
            <GitPullRequest size={12} className='shrink-0' />
            <span className='truncate'>#{activePr.number} {activePr.title}</span>
            <ExternalLink size={10} className='shrink-0 opacity-60' />
          </a>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v validator.ts
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/task/CodingAgentPanel.tsx
git commit -m "feat: add CodingAgentPanel component"
```

---

## Task 7: Wire CodingAgentPanel into TaskDetailPage + TaskDetailPanel

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

- [ ] **Step 1: Add import to TaskDetailPage.tsx**

Add near the other task-component imports:

```typescript
import { CodingAgentPanel } from '@/components/task/CodingAgentPanel'
```

- [ ] **Step 2: Remove old AgentStatus from left column in TaskDetailPage.tsx**

Find and remove this block (around line 779):

```typescript
{task.agentStatus && task.agentStatus !== 'idle' && (
  <div className='mt-6'>
    <AgentStatus
      taskId={task.id}
      ...
    />
  </div>
)}
```

Also remove the `AgentStatus` import line if it's no longer used elsewhere in the file.

- [ ] **Step 3: Add CodingAgentPanel to the right column in TaskDetailPage.tsx**

In the right column properties section (after the existing properties rows but before or after the existing PR/Branch section), add:

```typescript
                  {task.assigneeType === 'agent' && (
                    <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
                      <CodingAgentPanel
                        task={task}
                        onTaskUpdate={updates =>
                          setTask(prev => ({ ...prev, ...updates }))
                        }
                      />
                    </div>
                  )}
```

- [ ] **Step 4: Add import to TaskDetailPanel.tsx**

```typescript
import { CodingAgentPanel } from '@/components/task/CodingAgentPanel'
```

- [ ] **Step 5: Add CodingAgentPanel to right properties section in TaskDetailPanel.tsx**

In the right properties column, after the PR/Branch section, add:

```typescript
              {task.assigneeType === 'agent' && (
                <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
                  <CodingAgentPanel
                    task={task}
                    onTaskUpdate={updates =>
                      setTask(prev => ({ ...prev, ...updates }))
                    }
                  />
                </div>
              )}
```

- [ ] **Step 6: Ensure `task.assigneeType` and `task.clarifies` are populated in both page queries**

In the server page at `app/workspace/[workspaceUrl]/project/[slug]/tasks/[identifier]/page.tsx`, the Prisma query already returns all Task scalar fields (including the newly added `assigneeType`). Confirm `clarifies` is included in the `include` block (added in Task 3).

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v validator.ts
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx" \
        "app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx"
git commit -m "feat: wire CodingAgentPanel into task detail views"
```

---

## Task 8: @agent mention trigger

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/MentionList.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/mention-suggestion.ts`
- Modify: `app/api/tasks/[id]/comments/route.ts`

- [ ] **Step 1: Add `agent` type to `MentionItem` in MentionList.tsx**

Update the `MentionItem` union type:

```typescript
export type MentionItem =
  | { type: 'user'; id: string; label: string; imageUrl: string | null }
  | { type: 'task'; id: string; label: string; title: string; status: string }
  | { type: 'agent'; id: '__agent__'; label: 'agent' }
```

- [ ] **Step 2: Handle agent type in `selectItem` in MentionList.tsx**

Update the `selectItem` function:

```typescript
const selectItem = (index: number) => {
  const item = items[index]
  if (!item) return
  if (item.type === 'task') {
    command({
      id: item.id,
      label: item.label,
      mentionType: 'task',
      mentionTitle: item.title,
      mentionStatus: item.status,
    })
  } else if (item.type === 'agent') {
    command({ id: '__agent__', label: 'agent', mentionType: 'agent' })
  } else {
    command({ id: item.id, label: item.label, mentionType: 'user' })
  }
}
```

- [ ] **Step 3: Add agent render case in MentionList.tsx**

In `renderItem`, add before the final `return` for task items:

```typescript
      if (item.type === 'agent') {
        return (
          <button
            key='agent'
            type='button'
            onPointerDown={e => { e.preventDefault(); selectItem(flatIndex) }}
            onMouseEnter={() => setSelectedIndex(flatIndex)}
            className={rowCls}
          >
            <Bot size={14} className='text-violet-600 dark:text-violet-400 shrink-0' />
            <span className='text-violet-600 dark:text-violet-400'>Lumo Agent</span>
          </button>
        )
      }
```

Add `Bot` to imports: `import { Bot } from 'lucide-react'`

Also update the grouping logic — agent items need their own group. Update the return JSX in MentionList:

```typescript
    const agents = items.filter(i => i.type === 'agent')
    const users = items.filter(i => i.type === 'user')
    const tasks = items.filter(i => i.type === 'task')
    const agentOffset = 0
    const userOffset = agents.length
    const taskOffset = agents.length + users.length

    return (
      <div className='py-1'>
        {agents.length > 0 && (
          <>
            <div className='px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400'>Agent</div>
            {agents.map((item, i) => renderItem(item, agentOffset + i))}
          </>
        )}
        {users.length > 0 && (
          <>
            <div className={cn('px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400', agents.length > 0 && 'mt-1 border-t border-zinc-100 dark:border-zinc-800 pt-2')}>Users</div>
            {users.map((item, i) => renderItem(item, userOffset + i))}
          </>
        )}
        {tasks.length > 0 && (
          <>
            <div className={cn('px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400', (agents.length > 0 || users.length > 0) && 'mt-1 border-t border-zinc-100 dark:border-zinc-800 pt-2')}>Tasks</div>
            {tasks.map((item, i) => renderItem(item, taskOffset + i))}
          </>
        )}
      </div>
    )
```

- [ ] **Step 4: Add agent to suggestions in mention-suggestion.ts**

Update `buildMentionSuggestion` items function:

```typescript
    items: ({ query }): MentionItem[] => {
      const q = query.toLowerCase()

      const agentItems: MentionItem[] = 'agent'.includes(q)
        ? [{ type: 'agent', id: '__agent__', label: 'agent' }]
        : []

      const userItems: MentionItem[] = members
        .filter(m => m.name.toLowerCase().includes(q))
        .slice(0, 5)
        .map(m => ({ type: 'user', id: m.clerkId, label: m.name, imageUrl: m.imageUrl }))

      const taskItems: MentionItem[] = tasks
        .filter(t => t.title.toLowerCase().includes(q) || `${t.teamIdentifier}-${t.number}`.toLowerCase().includes(q))
        .slice(0, 5)
        .map(t => ({ type: 'task', id: t.id, label: `${t.teamIdentifier}-${t.number}`, title: t.title, status: t.status }))

      return [...agentItems, ...userItems, ...taskItems]
    },
```

- [ ] **Step 5: Handle `__agent__` in the comments POST route**

In `app/api/tasks/[id]/comments/route.ts`, after the comment is created and before the existing mention notification block, add:

```typescript
// Handle @agent mention — assign task to agent and trigger execution
if (commentBody.includes('data-id="__agent__"')) {
  waitUntil(
    (async () => {
      await prisma.task.update({
        where: { id },
        data: { assigneeType: 'agent', assigneeId: null },
      })
      const { executeAgent } = await import('@/lib/agent/execute')
      await executeAgent({ taskId: id, actorClerkId: userId }).catch(err =>
        console.error('[comment/@agent] executeAgent failed:', err)
      )
    })()
  )
}
```

This block goes right after:

```typescript
return NextResponse.json({ comment }, { status: 201 })
```

…actually it must go **before** the return. Place it after `const comment = await prisma.comment.create(...)` and before `return NextResponse.json`.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v validator.ts
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/MentionList.tsx" \
        "app/workspace/[workspaceUrl]/components/mention-suggestion.ts" \
        "app/api/tasks/[id]/comments/route.ts"
git commit -m "feat: @agent mention assigns task and triggers agent execution"
```

---

## Task 9: Task card — bot avatar for agent tasks

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/board/SortableTaskCard.tsx`

- [ ] **Step 1: Add `Bot` import**

Add `Bot` to the lucide-react import in `SortableTaskCard.tsx`.

- [ ] **Step 2: Pass `assigneeType` prop and render bot icon**

The card already does:

```typescript
const assignee = members?.find(m => m.id === task.assigneeId) ?? null
```

Update the assignee display section (around line 93) to handle agent:

```typescript
        {task.assigneeType === 'agent' ? (
          <div
            className='flex items-center justify-center size-5 rounded-full bg-violet-100 dark:bg-violet-900/40 shrink-0'
            title='Lumo Agent'
          >
            <Bot size={11} className='text-violet-600 dark:text-violet-400' />
          </div>
        ) : assignee ? (
          // existing human assignee display ...
        ) : null}
```

Note: `task` here is `ApiTask` which now has `assigneeType` from Task 2.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v validator.ts
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/board/SortableTaskCard.tsx"
git commit -m "feat: show bot avatar on task cards when assigneeType is agent"
```

---

## Self-Review

**Spec coverage check:**

1. ✅ DB migration — Task 1 adds `assigneeType` schema + migration
2. ✅ Assignee dropdown selects Agent → sets `assigneeType = 'agent'` — Task 5
3. ✅ Card bot avatar — Task 9
4. ✅ CodingAgentPanel + Run Agent button in right sidebar — Tasks 6 + 7
5. ✅ Run Agent returns 202 → `agentStatus = 'running'` → live logs — CodingAgentPanel Pusher subscription
6. ✅ `@agent` mention → `assigneeType = 'agent'` + execute — Task 8
7. ✅ `@agent` mention → system comment — note: the current plan triggers the agent but does NOT create a "system comment". This is intentional; the Pusher event `agent:started` appears in the live logs. If a system comment is needed, add `prisma.comment.create({ data: { taskId: id, authorId: userId, body: '<p>Lumo Agent has been assigned.</p>' } })` inside the `@agent` handler in the comments route.

**Placeholder scan:** No TBDs or "implement later" left.

**Type consistency check:**

- `CodingAgentTask` (Task 6) uses `ApiPullRequest` and `ApiTaskBranch` from types.ts — consistent.
- `AgentClarifyPending` defined in both `types.ts` (Task 2) and `CodingAgentPanel.tsx` — consolidate: import from types.ts in CodingAgentPanel.tsx instead of re-declaring.

  **Fix:** In `CodingAgentPanel.tsx`, remove the local `AgentClarifyPending` interface and instead:

  ```typescript
  import type {
    ApiPullRequest,
    ApiTaskBranch,
    AgentClarifyPending,
  } from '@/app/workspace/[workspaceUrl]/types'
  ```
