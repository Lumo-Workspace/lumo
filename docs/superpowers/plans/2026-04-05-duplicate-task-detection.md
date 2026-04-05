# Duplicate Task Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect similar/duplicate tasks when creating a new task, using client-side bigram matching during typing and AI semantic matching on submit.

**Architecture:** Two-phase detection — Phase 1 uses a pure-function bigram+containment algorithm client-side with debounce for instant feedback, Phase 2 calls a server API that uses Claude Sonnet for semantic matching on submit. Results are merged and deduplicated. The modal uses a state machine (editing→checking→confirming→creating) to manage the flow.

**Tech Stack:** TypeScript, React hooks, Vercel AI SDK (`generateObject` via `@ai-sdk/gateway`), Zod schemas, Tailwind CSS

---

### Task 1: Similarity Algorithm (`lib/similarity.ts`)

**Files:**

- Create: `lib/similarity.ts`
- Test: `__tests__/similarity.test.ts`

- [ ] **Step 1: Write failing tests for bigram similarity**

Create `__tests__/similarity.test.ts`:

```typescript
import { bigramSimilarity, findSimilarTasks } from '@/lib/similarity'

describe('bigramSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(bigramSimilarity('hello world', 'hello world')).toBe(1)
  })

  it('returns 1.0 when one string contains the other', () => {
    expect(bigramSimilarity('GitHub登录', 'GitHub登录功能')).toBe(1)
    expect(bigramSimilarity('implement login', 'login')).toBe(1)
  })

  it('is case-insensitive', () => {
    expect(bigramSimilarity('GitHub Login', 'github login')).toBe(1)
  })

  it('returns 0 for completely different strings', () => {
    expect(bigramSimilarity('abc', 'xyz')).toBe(0)
  })

  it('returns a score between 0 and 1 for partially similar strings', () => {
    const score = bigramSimilarity('GitHub OAuth', 'GitHub Login')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('returns 0 for empty strings', () => {
    expect(bigramSimilarity('', 'hello')).toBe(0)
    expect(bigramSimilarity('hello', '')).toBe(0)
    expect(bigramSimilarity('', '')).toBe(0)
  })

  it('returns 0 for single-character strings (no bigrams)', () => {
    expect(bigramSimilarity('a', 'a')).toBe(0)
  })

  it('handles Chinese characters', () => {
    const score = bigramSimilarity('用户认证系统', '用户登录系统')
    expect(score).toBeGreaterThan(0.3)
  })
})

describe('findSimilarTasks', () => {
  const tasks = [
    { id: '1', title: 'Implement GitHub OAuth', projectId: 'p1' },
    { id: '2', title: 'Design login page', projectId: 'p1' },
    { id: '3', title: 'Fix navbar bug', projectId: 'p1' },
    { id: '4', title: 'GitHub integration', projectId: 'p2' },
  ] as Array<{ id: string; title: string; projectId: string }>

  it('returns matches above threshold sorted by score descending', () => {
    const matches = findSimilarTasks('GitHub Login', tasks, 'p1', {
      threshold: 0.3,
      maxResults: 3,
    })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].score).toBeGreaterThanOrEqual(
      matches[matches.length - 1].score
    )
  })

  it('filters to specified projectId', () => {
    const matches = findSimilarTasks('GitHub', tasks, 'p1', {
      threshold: 0.1,
      maxResults: 10,
    })
    expect(matches.every(m => m.task.projectId === 'p1')).toBe(true)
  })

  it('respects maxResults', () => {
    const matches = findSimilarTasks('GitHub', tasks, 'p1', {
      threshold: 0.1,
      maxResults: 1,
    })
    expect(matches.length).toBeLessThanOrEqual(1)
  })

  it('returns empty array for short titles', () => {
    const matches = findSimilarTasks('ab', tasks, 'p1', {
      threshold: 0.3,
      maxResults: 3,
    })
    expect(matches).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/similarity.test.ts --no-cache`
Expected: FAIL — module not found

- [ ] **Step 3: Implement similarity functions**

Create `lib/similarity.ts`:

```typescript
/**
 * Compute bigram-based similarity between two strings.
 * Uses containment check first (score = 1.0 if one contains the other),
 * then falls back to Dice coefficient over character bigrams.
 */
export function bigramSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim()
  const nb = b.toLowerCase().trim()

  if (!na || !nb) return 0

  // Containment check
  if (na.includes(nb) || nb.includes(na)) return 1

  const bigramsA = toBigrams(na)
  const bigramsB = toBigrams(nb)

  if (bigramsA.size === 0 || bigramsB.size === 0) return 0

  let shared = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) shared++
  }

  return (2 * shared) / (bigramsA.size + bigramsB.size)
}

function toBigrams(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2))
  }
  return set
}

export interface SimilarTaskMatch<T> {
  task: T
  score: number
}

/**
 * Find tasks similar to the given title within a specific project.
 * Returns matches sorted by score descending.
 */
export function findSimilarTasks<
  T extends { id: string; title: string; projectId: string },
>(
  title: string,
  tasks: T[],
  projectId: string,
  options: { threshold: number; maxResults: number }
): SimilarTaskMatch<T>[] {
  const trimmed = title.trim()
  if (trimmed.length < 3) return []

  const { threshold, maxResults } = options

  const matches: SimilarTaskMatch<T>[] = []

  for (const task of tasks) {
    if (task.projectId !== projectId) continue
    const score = bigramSimilarity(trimmed, task.title)
    if (score >= threshold) {
      matches.push({ task, score })
    }
  }

  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, maxResults)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/similarity.test.ts --no-cache`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/similarity.ts __tests__/similarity.test.ts
git commit -m "feat: add bigram similarity algorithm for duplicate detection"
```

---

### Task 2: Client-Side Duplicate Check Hook (`useDuplicateCheck.ts`)

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useDuplicateCheck.ts`

- [ ] **Step 1: Create the hook**

Create `app/workspace/[workspaceUrl]/hooks/useDuplicateCheck.ts`:

```typescript
'use client'

import { useState, useEffect, useRef } from 'react'
import { findSimilarTasks, SimilarTaskMatch } from '@/lib/similarity'
import { ApiTask } from '../types'

const DEBOUNCE_MS = 500
const THRESHOLD = 0.5
const MAX_RESULTS = 3

export function useDuplicateCheck(
  title: string,
  tasks: ApiTask[],
  projectId: string
) {
  const [clientMatches, setClientMatches] = useState<
    SimilarTaskMatch<ApiTask>[]
  >([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    const trimmed = title.trim()
    if (trimmed.length < 3 || !projectId) {
      setClientMatches([])
      return
    }

    timerRef.current = setTimeout(() => {
      const matches = findSimilarTasks(trimmed, tasks, projectId, {
        threshold: THRESHOLD,
        maxResults: MAX_RESULTS,
      })
      setClientMatches(matches)
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [title, tasks, projectId])

  return { clientMatches }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useDuplicateCheck.ts
git commit -m "feat: add useDuplicateCheck hook for client-side matching"
```

---

### Task 3: Phase 1 UI — Inline Warning (`DuplicateWarning.tsx`)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/DuplicateWarning.tsx`

- [ ] **Step 1: Create the DuplicateWarning component**

Create `app/workspace/[workspaceUrl]/components/DuplicateWarning.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { SimilarTaskMatch } from '@/lib/similarity'
import { ApiTask } from '../types'
import { slugifyProjectName } from '../utils'

interface DuplicateWarningProps {
  matches: SimilarTaskMatch<ApiTask>[]
  workspaceUrl: string
  projects: { id: string; name: string }[]
}

export function DuplicateWarning({
  matches,
  workspaceUrl,
  projects,
}: DuplicateWarningProps) {
  const [expanded, setExpanded] = useState(false)

  if (matches.length === 0) return null

  return (
    <div className='rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30'>
      <button
        type='button'
        onClick={() => setExpanded(v => !v)}
        className='w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-700 dark:text-amber-400'
      >
        <AlertTriangle className='size-4 shrink-0' />
        <span>
          发现 {matches.length} 个相似任务
        </span>
        {expanded ? (
          <ChevronUp className='size-4 ml-auto shrink-0' />
        ) : (
          <ChevronDown className='size-4 ml-auto shrink-0' />
        )}
      </button>
      {expanded && (
        <div className='px-3 pb-2 space-y-1'>
          {matches.map(({ task, score }) => {
            const projectName =
              task.project?.name ??
              projects.find(p => p.id === task.projectId)?.name ??
              ''
            const slug = slugifyProjectName(projectName)
            const identifier = `${task.teamIdentifier}-${task.number}`
            const url = `/workspace/${workspaceUrl}/project/${slug}/tasks/${identifier}`

            return (
              <button
                key={task.id}
                type='button'
                onClick={() => window.open(url, '_blank')}
                className='w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors'
              >
                <span className='text-amber-600 dark:text-amber-500 font-medium tabular-nums shrink-0'>
                  {Math.round(score * 100)}%
                </span>
                <span className='truncate text-zinc-700 dark:text-zinc-300'>
                  {task.title}
                </span>
                <span className='text-zinc-400 shrink-0'>
                  {identifier}
                </span>
                <ExternalLink className='size-3 text-zinc-400 shrink-0 ml-auto' />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/DuplicateWarning.tsx
git commit -m "feat: add DuplicateWarning inline hint component"
```

---

### Task 4: AI Semantic Match API (`/api/tasks/check-duplicates`)

**Files:**

- Create: `app/api/tasks/check-duplicates/route.ts`
- Modify: `lib/validation/schemas.ts`

- [ ] **Step 1: Add Zod schema for check-duplicates**

Add to the end of `lib/validation/schemas.ts` (before the closing content, after the invites section):

```typescript
// ─── Duplicate Detection ────────────────────────────────────────────────────

export const checkDuplicatesSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(500, 'Title must be at most 500 characters'),
  projectId: z.string().min(1, 'Project ID is required'),
})
```

- [ ] **Step 2: Create the API route**

Create `app/api/tasks/check-duplicates/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { checkDuplicatesSchema } from '@/lib/validation/schemas'

const matchSchema = z.object({
  matches: z.array(
    z.object({
      taskId: z.string(),
      score: z.number().min(0).max(1),
    })
  ),
})

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = checkDuplicatesSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const { title, projectId } = parsed.data

    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult

    // Fetch tasks for this project (limit to 200 most recent)
    // TODO: When projects exceed 200 tasks, consider pre-filtering
    //       with full-text search before sending to AI
    const tasks = await prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        number: true,
        status: true,
        priority: true,
        team: { select: { identifier: true } },
        assignee: {
          select: {
            type: true,
            member: { select: { clerkId: true } },
            agent: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })

    if (tasks.length === 0) {
      return NextResponse.json({ matches: [] })
    }

    // Build task list for AI prompt
    const taskList = tasks.map(t => `${t.id}: ${t.title}`).join('\n')

    const prompt = `You are a duplicate task detector for a project management system.
Given a new task title and a list of existing tasks, identify semantically similar or duplicate tasks.

New task title: <title>${title}</title>

Existing tasks:
<tasks>
${taskList}
</tasks>

Return tasks that are semantically similar, with a similarity score between 0 and 1.
Only include tasks with score >= 0.4. Focus on semantic meaning, not just keyword overlap.
A score of 1.0 means exact duplicate, 0.8+ means very similar, 0.5-0.8 means related.`

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: matchSchema,
      prompt,
    })

    // Build task lookup map
    const taskMap = new Map(tasks.map(t => [t.id, t]))

    // Resolve assignee display name from Clerk
    const clerkIds = tasks
      .filter(t => t.assignee?.type === 'HUMAN' && t.assignee.member?.clerkId)
      .map(t => t.assignee!.member!.clerkId)
    const uniqueClerkIds = [...new Set(clerkIds)]

    let clerkNameMap = new Map<string, string>()
    if (uniqueClerkIds.length > 0) {
      try {
        // Dynamic import to avoid loading Clerk on every request
        const { clerkClient } = await import('@clerk/nextjs/server')
        const client = await clerkClient()
        const users = await client.users.getUserList({
          userId: uniqueClerkIds,
          limit: uniqueClerkIds.length,
        })
        clerkNameMap = new Map(
          users.data.map(u => [
            u.id,
            [u.firstName, u.lastName].filter(Boolean).join(' ') ||
              u.username ||
              'Unknown',
          ])
        )
      } catch {
        // Clerk lookup failed, assignee names will be null
      }
    }

    const matches = object.matches
      .filter(m => m.score >= 0.4 && taskMap.has(m.taskId))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(m => {
        const t = taskMap.get(m.taskId)!
        let assigneeName: string | null = null
        if (t.assignee?.type === 'AGENT' && t.assignee.agent) {
          assigneeName = t.assignee.agent.name
        } else if (t.assignee?.type === 'HUMAN' && t.assignee.member?.clerkId) {
          assigneeName = clerkNameMap.get(t.assignee.member.clerkId) ?? null
        }

        return {
          taskId: t.id,
          title: t.title,
          number: t.number,
          teamIdentifier: t.team.identifier,
          status: t.status,
          score: m.score,
          assigneeName,
          priority: t.priority,
        }
      })

    return NextResponse.json({ matches })
  } catch (error) {
    console.error('[check-duplicates] error:', error)
    return NextResponse.json({ matches: [] })
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add lib/validation/schemas.ts app/api/tasks/check-duplicates/route.ts
git commit -m "feat: add AI duplicate detection API endpoint"
```

---

### Task 5: Phase 2 UI — Confirmation View (`DuplicateConfirm.tsx`)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/DuplicateConfirm.tsx`

- [ ] **Step 1: Create the DuplicateConfirm component**

Create `app/workspace/[workspaceUrl]/components/DuplicateConfirm.tsx`:

```typescript
'use client'

import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { slugifyProjectName } from '../utils'

export interface DuplicateMatch {
  taskId: string
  title: string
  number: number
  teamIdentifier: string
  status: string
  score: number
  assigneeName: string | null
  priority: string
}

const STATUS_LABEL: Record<string, string> = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
}

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'P3',
  MEDIUM: 'P2',
  HIGH: 'P1',
  URGENT: 'P0',
}

function scoreBadgeClass(score: number): string {
  if (score >= 0.8) return 'text-red-600 dark:text-red-400'
  if (score >= 0.6) return 'text-amber-600 dark:text-amber-400'
  return 'text-zinc-500 dark:text-zinc-400'
}

interface DuplicateConfirmProps {
  matches: DuplicateMatch[]
  projectName: string
  workspaceUrl: string
  onConfirm: () => void
  onCancel: () => void
}

export function DuplicateConfirm({
  matches,
  projectName,
  workspaceUrl,
  onConfirm,
  onCancel,
}: DuplicateConfirmProps) {
  const projectSlug = slugifyProjectName(projectName)

  return (
    <div className='space-y-4'>
      {/* Warning banner */}
      <div className='flex items-center gap-2 px-4 py-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-700 dark:text-amber-400'>
        <AlertTriangle className='size-4 shrink-0' />
        <span>发现 {matches.length} 个相似任务，请确认是否重复创建</span>
      </div>

      {/* Match list */}
      <div className='space-y-2'>
        {matches.map(match => {
          const identifier = `${match.teamIdentifier}-${match.number}`
          const url = `/workspace/${workspaceUrl}/project/${projectSlug}/tasks/${identifier}`

          return (
            <div
              key={match.taskId}
              className='flex items-center gap-3 px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50'
            >
              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2 mb-1'>
                  <span
                    className={`text-xs font-semibold tabular-nums ${scoreBadgeClass(match.score)}`}
                  >
                    相似度 {Math.round(match.score * 100)}%
                  </span>
                  <span className='text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate'>
                    {match.title}
                  </span>
                </div>
                <div className='flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500'>
                  <span>{identifier}</span>
                  <span>·</span>
                  <span>{STATUS_LABEL[match.status] ?? match.status}</span>
                  {match.assigneeName && (
                    <>
                      <span>·</span>
                      <span>{match.assigneeName}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>{PRIORITY_LABEL[match.priority] ?? match.priority}</span>
                </div>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => window.open(url, '_blank')}
                className='shrink-0'
              >
                查看
                <ExternalLink className='size-3 ml-1' />
              </Button>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className='flex items-center gap-3 pt-2'>
        <Button onClick={onConfirm}>仍然创建</Button>
        <Button variant='ghost' onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/DuplicateConfirm.tsx
git commit -m "feat: add DuplicateConfirm confirmation view component"
```

---

### Task 6: Integrate into NewTaskModal

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx`
- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`

- [ ] **Step 1: Add `tasks` prop to NewTaskModal and pass from WorkspaceApp**

In `NewTaskModal.tsx`, update the interface and destructuring:

```typescript
// Add to imports at top:
import { ApiTask } from '../../types'
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck'
import { DuplicateWarning } from '../DuplicateWarning'
import { DuplicateConfirm, DuplicateMatch } from '../DuplicateConfirm'
import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { apiFetch } from '../../utils'

// Add to NewTaskModalProps interface:
interface NewTaskModalProps {
  isOpen: boolean
  onClose: () => void
  projects: ApiProject[]
  members: WorkspaceMemberInfo[]
  defaultProjectId?: string | undefined
  defaultAssigneeId?: string | undefined
  defaultStatus?: ApiStatus | undefined
  onSubmit: (data: NewTaskFormData) => Promise<void>
  tasks?: ApiTask[]  // ← NEW
}

// Add to function parameters:
export function NewTaskModal({
  // ... existing params ...
  tasks = [],  // ← NEW
}: NewTaskModalProps) {
```

In `WorkspaceApp.tsx`, pass `tasks` to `NewTaskModal` (around line 859):

```typescript
<NewTaskModal
  isOpen={isNewTaskModalOpen}
  onClose={() => {
    setIsNewTaskModalOpen(false)
    setNewTaskDefaultAssigneeId(undefined)
    setNewTaskDefaultStatus(undefined)
  }}
  projects={projects}
  members={members}
  defaultProjectId={selectedProject?.id}
  defaultAssigneeId={newTaskDefaultAssigneeId}
  defaultStatus={newTaskDefaultStatus}
  onSubmit={handleCreateTask}
  tasks={Object.values(taskMap)}  // ← NEW
/>
```

- [ ] **Step 2: Add state machine and duplicate check logic to NewTaskModal**

In `NewTaskModal.tsx`, add the state machine and modify the submit flow. Add these after existing state declarations:

```typescript
// ─── Duplicate detection ────────────────────────────────────────────────
type ModalPhase = 'editing' | 'checking' | 'confirming'
const [phase, setPhase] = useState<ModalPhase>('editing')
const [aiMatches, setAiMatches] = useState<DuplicateMatch[]>([])
const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

const effectiveProjectId = projectId || defaultProjectId || ''
const { clientMatches } = useDuplicateCheck(title, tasks, effectiveProjectId)

// Find project name for DuplicateConfirm
const projectName = projects.find(p => p.id === effectiveProjectId)?.name ?? ''
```

Update the `reset` function to also reset duplicate detection state:

```typescript
const reset = () => {
  setTitle('')
  descriptionRef.current = null
  setDescriptionValue(null)
  setStatus(defaultStatus ?? 'TODO')
  setPriority('MEDIUM')
  setProjectId(defaultProjectId ?? '')
  setAssigneeId(defaultAssigneeId ?? '')
  setRepositoryId(null)
  setProjectRepos([])
  setPhase('editing') // ← NEW
  setAiMatches([]) // ← NEW
}
```

Replace the existing `handleSubmit` function with:

```typescript
const handleSubmit = async () => {
  const trimmedTitle = title.trim()
  if (!trimmedTitle || !effectiveProjectId) return

  // If already confirmed (phase was confirming), skip detection
  if (phase === 'confirming') {
    doCreate()
    return
  }

  // Phase 2: AI semantic matching on submit
  setPhase('checking')
  try {
    const res = await apiFetch('/api/tasks/check-duplicates', {
      method: 'POST',
      body: { title: trimmedTitle, projectId: effectiveProjectId },
    })

    if (res.ok) {
      const data = await res.json()
      const matches: DuplicateMatch[] = data.matches ?? []

      if (matches.length > 0) {
        // Merge with client matches (dedup by taskId, AI score wins)
        const aiIds = new Set(matches.map(m => m.taskId))
        const clientOnly = clientMatches
          .filter(cm => !aiIds.has(cm.task.id))
          .map(cm => ({
            taskId: cm.task.id,
            title: cm.task.title,
            number: cm.task.number,
            teamIdentifier: cm.task.teamIdentifier,
            status: cm.task.status,
            score: cm.score,
            assigneeName: null,
            priority: cm.task.priority,
          }))

        const merged = [...matches, ...clientOnly]
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)

        setAiMatches(merged)
        setPhase('confirming')
        return
      }
    }
    // No matches or API error → proceed with creation
    doCreate()
  } catch {
    // API error → skip detection, proceed with creation
    doCreate()
  }
}

const doCreate = () => {
  const data = {
    title: title.trim(),
    description: descriptionRef.current ?? '',
    status,
    priority,
    projectId: effectiveProjectId,
    assigneeId,
    repositoryId,
  }
  reset()
  onClose()
  onSubmit(data).catch(console.error)
}
```

- [ ] **Step 3: Update the modal JSX to show duplicate UI**

Replace the modal's footer to handle different phases:

```typescript
        footer={
          phase === 'confirming' ? undefined : (
            <div className='flex items-center gap-3 ml-auto'>
              <Button variant='ghost' onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || phase === 'checking'}
              >
                {phase === 'checking' ? (
                  <>
                    <Loader2 className='size-4 animate-spin mr-1' />
                    检测中...
                  </>
                ) : (
                  <>Create task {submitModLabel}↵</>
                )}
              </Button>
            </div>
          )
        }
```

Update the modal body to show `DuplicateWarning` in editing phase and `DuplicateConfirm` in confirming phase:

```typescript
        {expanded => (
          phase === 'confirming' ? (
            <DuplicateConfirm
              matches={aiMatches}
              projectName={projectName}
              workspaceUrl={workspaceUrl}
              onConfirm={doCreate}
              onCancel={() => setPhase('editing')}
            />
          ) : (
            <div className='space-y-4 h-full flex flex-col'>
              <input
                autoFocus
                className='w-full bg-transparent border-none p-0 text-xl font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
                placeholder='Task title'
                type='text'
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => {
                  if (isSubmitShortcut(e)) handleSubmit()
                }}
              />
              <DuplicateWarning
                matches={clientMatches}
                workspaceUrl={workspaceUrl}
                projects={projects}
              />
              <AiDescriptionPrompt
                title={title}
                projectId={effectiveProjectId}
                existingDescription={descriptionValue}
                onAccept={html => {
                  descriptionRef.current = html
                  setDescriptionValue(html)
                }}
              />
              <div className={expanded ? 'flex-1 min-h-0 overflow-y-auto' : ''}>
                <DescriptionEditor
                  value={descriptionValue}
                  onCommit={html => {
                    descriptionRef.current = html
                  }}
                  onChange={html => {
                    descriptionRef.current = html
                    setDescriptionValue(html)
                  }}
                  placeholder='Add description…'
                />
              </div>
              <div className='flex flex-wrap items-center gap-2 pt-1'>
                {/* ... all existing field selects unchanged ... */}
              </div>
            </div>
          )
        )}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Manual test**

Start dev server, open Create Task modal:

1. Type a title similar to an existing task → yellow warning should appear below title
2. Click "Create task" → should show "检测中..." then either create or show confirmation
3. On confirmation → "仍然创建" creates the task, "取消" goes back to editing
4. "查看" button opens task detail in new tab

- [ ] **Step 6: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx app/workspace/[workspaceUrl]/WorkspaceApp.tsx
git commit -m "feat: integrate duplicate detection into NewTaskModal"
```
