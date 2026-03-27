# Create Branch from Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to create a GitHub branch directly from a task detail page, with the branch name auto-generated from the task identifier + title, the selected repo saved per-project for future use.

**Architecture:** `Project` gains a `githubRepo` field (nullable) storing the last-used repo for that project. A new `POST /api/tasks/:id/branch` endpoint looks up the workspace's GitHub integration, fetches the `main` SHA via GitHub API, creates the branch, and saves the repo back to the project. A `CreateBranchDialog` client component handles the UX (editable branch name, repo selector, success state with copy + link). The existing PR section in `TaskDetailPage` and `TaskDetailPanel` is widened to always show with a "Branch" button in the header.

**Tech Stack:** Next.js 14 App Router, Prisma, GitHub REST API (no extra packages), `lib/crypto.ts` for token decryption, `sonner` for toasts, `lucide-react` (`GitBranch` icon).

---

## File Map

**New files:**

- `app/api/tasks/[id]/branch/route.ts` — `POST /api/tasks/:id/branch`
- `app/workspace/[workspaceUrl]/components/CreateBranchDialog.tsx` — dialog component

**Modified files:**

- `prisma/schema.prisma` — add `githubRepo String?` to `Project`
- `lib/validation/schemas.ts` — add `githubRepo` to `updateProjectSchema`
- `lib/github/branch.ts` — add `generateBranchName(identifier, title)`
- `tests/lib/github/branch.test.ts` — add tests for `generateBranchName`
- `app/api/projects/[id]/route.ts` — PATCH: handle `githubRepo` field
- `app/api/tasks/[id]/route.ts` — GET: include `githubRepo` in project select
- `app/workspace/[workspaceUrl]/types.ts` — add `githubRepo` to `ApiProject` and `TaskDetail.project`
- `app/workspace/[workspaceUrl]/constants.ts` — add `tasks.branch(id)` API route
- `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` — update PR section + wire dialog
- `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx` — same

---

## Task 1: Schema + Validation + Types

**Files:**

- Modify: `prisma/schema.prisma`
- Modify: `lib/validation/schemas.ts`
- Modify: `app/workspace/[workspaceUrl]/types.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `app/api/projects/[id]/route.ts`
- Modify: `app/api/tasks/[id]/route.ts`

- [ ] **Step 1: Add `githubRepo` to Project schema**

In `prisma/schema.prisma`, find the `Project` model and add after `isIdea Boolean @default(false)`:

```diff
  isIdea            Boolean  @default(false)
+ githubRepo        String?  // "owner/repo" of the connected GitHub repo for this project
```

- [ ] **Step 2: Run migration**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
npx prisma migrate dev --name add_project_github_repo
```

Expected: migration created and applied, Prisma client regenerated.

- [ ] **Step 3: Add `githubRepo` to `updateProjectSchema` in `lib/validation/schemas.ts`**

Find `updateProjectSchema` and add:

```diff
  defaultReviewerId: z.string().nullable().optional(),
+ githubRepo: z.string().max(200).nullable().optional(),
```

- [ ] **Step 4: Support `githubRepo` in PATCH `/api/projects/[id]`**

In `app/api/projects/[id]/route.ts`, in the PATCH handler where the `data` object is built (around line 85), add:

```typescript
if (parsed.data.githubRepo !== undefined)
  data.githubRepo = parsed.data.githubRepo
```

- [ ] **Step 5: Include `githubRepo` in GET `/api/tasks/:id` project select**

In `app/api/tasks/[id]/route.ts`, find the GET handler's `prisma.task.findUnique` call. Update the project select to include `githubRepo`:

```typescript
project: {
  select: {
    id: true,
    name: true,
    workspaceId: true,
    defaultReviewerId: true,
    githubRepo: true,
  },
},
```

- [ ] **Step 6: Update frontend types**

In `app/workspace/[workspaceUrl]/types.ts`:

Add `githubRepo?: string | null` to `ApiProject`:

```diff
  kanbanViewId?: string
+ githubRepo?: string | null
}
```

Add `githubRepo?: string | null` to `TaskDetail.project`:

```diff
project: { id: string; name: string; defaultReviewerId?: string | null }
```

→

```typescript
project: {
  id: string
  name: string
  defaultReviewerId?: string | null
  githubRepo?: string | null
}
```

- [ ] **Step 7: Add `tasks.branch` to API constants**

In `app/workspace/[workspaceUrl]/constants.ts`, add to the `tasks` object:

```diff
  tasks: {
    me: '/api/tasks/me',
    byId: (id: string) => `/api/tasks/${id}`,
+   branch: (id: string) => `/api/tasks/${id}/branch`,
    comments: (taskId: string) => `/api/tasks/${taskId}/comments`,
```

- [ ] **Step 8: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add prisma/ lib/validation/schemas.ts app/api/projects/[id]/route.ts \
        app/api/tasks/[id]/route.ts \
        "app/workspace/[workspaceUrl]/types.ts" \
        "app/workspace/[workspaceUrl]/constants.ts"
git commit -m "feat: add githubRepo field to Project for per-project branch creation"
```

---

## Task 2: `generateBranchName` Utility + Tests

**Files:**

- Modify: `lib/github/branch.ts`
- Modify: `tests/lib/github/branch.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/github/branch.test.ts` (after the existing `splitIdentifier` describe block):

```typescript
describe('generateBranchName', () => {
  it('generates lumo/IDENTIFIER-slug from identifier and title', () => {
    expect(generateBranchName('ENG-123', 'Fix the bug')).toBe(
      'lumo/ENG-123-fix-the-bug'
    )
  })
  it('removes special characters', () => {
    expect(generateBranchName('ENG-123', 'Fix!!! @#$%')).toBe(
      'lumo/ENG-123-fix'
    )
  })
  it('handles empty title', () => {
    expect(generateBranchName('ENG-123', '')).toBe('lumo/ENG-123')
  })
  it('handles whitespace-only title', () => {
    expect(generateBranchName('ENG-123', '   ')).toBe('lumo/ENG-123')
  })
  it('collapses multiple spaces and hyphens', () => {
    expect(generateBranchName('ENG-123', 'hello   world')).toBe(
      'lumo/ENG-123-hello-world'
    )
  })
  it('truncates long titles to keep branch name reasonable', () => {
    const longTitle = 'a'.repeat(100)
    const result = generateBranchName('ENG-123', longTitle)
    expect(result.length).toBeLessThanOrEqual(60)
    expect(result.startsWith('lumo/ENG-123-')).toBe(true)
  })
})
```

Also update the import line at the top of the test file to include `generateBranchName`:

```typescript
import {
  parseBranchIdentifier,
  splitIdentifier,
  generateBranchName,
} from '@/lib/github/branch'
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx jest tests/lib/github/branch.test.ts --no-coverage
```

Expected: FAIL — "generateBranchName is not a function"

- [ ] **Step 3: Add `generateBranchName` to `lib/github/branch.ts`**

Append to the end of the file:

```typescript
/**
 * Generates a Lumo-convention branch name from a task identifier and title.
 *
 * Format: `lumo/ENG-123-fix-the-bug`
 *
 * - Title is lowercased, special chars removed, spaces → hyphens
 * - Title slug capped at 40 chars to keep branch names reasonable
 * - If title is empty or produces no slug, branch is just `lumo/IDENTIFIER`
 */
export function generateBranchName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '')
  return slug ? `lumo/${identifier}-${slug}` : `lumo/${identifier}`
}
```

- [ ] **Step 4: Run to confirm it passes**

```bash
npx jest tests/lib/github/branch.test.ts --no-coverage
```

Expected: PASS, 16 tests (10 existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add lib/github/branch.ts tests/lib/github/branch.test.ts
git commit -m "feat: add generateBranchName utility with tests"
```

---

## Task 3: `POST /api/tasks/:id/branch` Endpoint

**Files:**

- Create: `app/api/tasks/[id]/branch/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/tasks/[id]/branch/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'

type Params = { params: Promise<{ id: string }> }

const GH_API = 'https://api.github.com'
const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
})

/**
 * POST /api/tasks/:id/branch
 * Body: { repo: "owner/repo", branchName: "lumo/ENG-123-fix-bug" }
 *
 * Creates a GitHub branch from main, saves repo to project.githubRepo,
 * returns { branchName, url }.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id: taskId } = await params

    const body = await request.json()
    const repo: string = body.repo ?? ''
    const branchName: string = body.branchName ?? ''

    if (!repo || !branchName) {
      return NextResponse.json(
        { error: 'repo and branchName are required' },
        { status: 400 }
      )
    }

    // Load task + workspace membership check
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { select: { id: true, workspaceId: true } } },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    // Find a GitHub integration for this workspace that has the repo authorized
    const integration = await prisma.gitHubIntegration.findFirst({
      where: {
        workspaceId: task.project.workspaceId,
        repositories: { has: repo },
      },
    })
    if (!integration) {
      return NextResponse.json(
        { error: 'Repository not connected. Add it in Integrations settings.' },
        { status: 422 }
      )
    }

    const token = decrypt(integration.accessToken)
    const slash = repo.indexOf('/')
    const owner = repo.slice(0, slash)
    const repoName = repo.slice(slash + 1)
    const headers = GH_HEADERS(token)

    // Get SHA of main branch
    const refRes = await fetch(
      `${GH_API}/repos/${owner}/${repoName}/git/refs/heads/main`,
      { headers }
    )
    if (!refRes.ok) {
      const err = await refRes.json().catch(() => ({}))
      return NextResponse.json(
        {
          error:
            (err as { message?: string }).message ??
            'Could not find main branch on GitHub',
        },
        { status: 422 }
      )
    }
    const refData = await refRes.json()
    const sha: string = refData.object.sha

    // Create the branch
    const createRes = await fetch(
      `${GH_API}/repos/${owner}/${repoName}/git/refs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
      }
    )
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}))
      return NextResponse.json(
        {
          error:
            (err as { message?: string }).message ?? 'Failed to create branch',
        },
        { status: 422 }
      )
    }

    // Save repo to project for next time (fire-and-forget)
    prisma.project
      .update({
        where: { id: task.project.id },
        data: { githubRepo: repo },
      })
      .catch(err =>
        console.error('[branch] failed to save project.githubRepo:', err)
      )

    const url = `https://github.com/${repo}/tree/${branchName}`
    return NextResponse.json({ branchName, url })
  } catch (error) {
    console.error('POST /api/tasks/[id]/branch error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/tasks/[id]/branch/"
git commit -m "feat: add POST /api/tasks/:id/branch endpoint"
```

---

## Task 4: `CreateBranchDialog` Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/CreateBranchDialog.tsx`

- [ ] **Step 1: Create the component**

```typescript
// app/workspace/[workspaceUrl]/components/CreateBranchDialog.tsx
'use client'

import { useState, useEffect } from 'react'
import { GitBranch, Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { generateBranchName } from '@/lib/github/branch'
import { API } from '../constants'

interface CreateBranchDialogProps {
  isOpen: boolean
  onClose: () => void
  taskId: string
  identifier: string   // e.g. "ENG-123"
  title: string
  projectId: string
  defaultRepo: string | null | undefined  // project.githubRepo
  workspaceUrl: string
}

interface GhRepo {
  fullName: string
  name: string
  private: boolean
}

type DialogState =
  | { phase: 'idle' }
  | { phase: 'loading_repos' }
  | { phase: 'no_repos' }
  | { phase: 'ready'; repos: GhRepo[] }
  | { phase: 'creating' }
  | { phase: 'success'; branchName: string; url: string }
  | { phase: 'error'; message: string }

export function CreateBranchDialog({
  isOpen,
  onClose,
  taskId,
  identifier,
  title,
  defaultRepo,
  workspaceUrl,
}: CreateBranchDialogProps) {
  const [state, setState] = useState<DialogState>({ phase: 'idle' })
  const [branchName, setBranchName] = useState('')
  const [selectedRepo, setSelectedRepo] = useState('')
  const [copied, setCopied] = useState(false)

  // Load repos and initialise form when dialog opens
  useEffect(() => {
    if (!isOpen) {
      setState({ phase: 'idle' })
      setCopied(false)
      return
    }

    setBranchName(generateBranchName(identifier, title))
    setState({ phase: 'loading_repos' })

    fetch(`${API.github.repos}?workspaceUrl=${workspaceUrl}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { repos: GhRepo[] }) => {
        const repos = data.repos ?? []
        if (repos.length === 0) {
          setState({ phase: 'no_repos' })
          return
        }
        // Pre-select: project's saved repo first, else first in list
        const preselect =
          repos.find(r => r.fullName === defaultRepo)?.fullName ??
          repos[0]!.fullName
        setSelectedRepo(preselect)
        setState({ phase: 'ready', repos })
      })
      .catch(() => setState({ phase: 'no_repos' }))
  }, [isOpen, identifier, title, defaultRepo, workspaceUrl])

  const handleCreate = async () => {
    if (state.phase !== 'ready') return
    setState({ phase: 'creating' })

    try {
      const res = await fetch(API.tasks.branch(taskId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: selectedRepo, branchName }),
      })
      const data = await res.json()
      if (!res.ok) {
        setState({ phase: 'error', message: data.error ?? 'Failed to create branch' })
        return
      }
      setState({ phase: 'success', branchName: data.branchName, url: data.url })
    } catch {
      setState({ phase: 'error', message: 'Network error. Please try again.' })
    }
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Branch name copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <GitBranch size={16} />
            Create Branch
          </DialogTitle>
          <DialogDescription>
            Create a GitHub branch linked to this task.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          {/* Loading repos */}
          {state.phase === 'loading_repos' && (
            <div className='flex items-center justify-center py-6'>
              <Loader2 size={20} className='animate-spin text-zinc-400' />
            </div>
          )}

          {/* No repos connected */}
          {state.phase === 'no_repos' && (
            <div className='text-center py-4 space-y-2'>
              <p className='text-sm text-zinc-500 dark:text-zinc-400'>
                No GitHub repositories connected.
              </p>
              <a
                href={`/workspace/${workspaceUrl}/settings/integrations`}
                className='text-sm text-blue-600 dark:text-blue-400 hover:underline'
              >
                Connect a repository →
              </a>
            </div>
          )}

          {/* Ready / Creating */}
          {(state.phase === 'ready' || state.phase === 'creating') && (
            <>
              {/* Repo selector */}
              <div className='space-y-1.5'>
                <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  Repository
                </label>
                <select
                  value={selectedRepo}
                  onChange={e => setSelectedRepo(e.target.value)}
                  disabled={state.phase === 'creating'}
                  className='w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50 font-mono'
                >
                  {state.phase === 'ready' &&
                    state.repos.map(r => (
                      <option key={r.fullName} value={r.fullName}>
                        {r.fullName}
                        {r.private ? ' (private)' : ''}
                      </option>
                    ))}
                </select>
              </div>

              {/* Branch name */}
              <div className='space-y-1.5'>
                <label className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                  Branch name
                </label>
                <input
                  type='text'
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  disabled={state.phase === 'creating'}
                  className='w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50'
                  spellCheck={false}
                />
              </div>

              <Button
                className='w-full'
                onClick={handleCreate}
                disabled={
                  state.phase === 'creating' || !branchName.trim() || !selectedRepo
                }
              >
                {state.phase === 'creating' ? (
                  <Loader2 size={14} className='animate-spin mr-2' />
                ) : null}
                {state.phase === 'creating' ? 'Creating…' : 'Create branch'}
              </Button>
            </>
          )}

          {/* Error */}
          {state.phase === 'error' && (
            <div className='space-y-3'>
              <p className='text-sm text-red-600 dark:text-red-400'>
                {state.message}
              </p>
              <Button
                variant='outline'
                className='w-full'
                onClick={() => setState({ phase: 'idle' })}
              >
                Try again
              </Button>
            </div>
          )}

          {/* Success */}
          {state.phase === 'success' && (
            <div className='space-y-3'>
              <div className='flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2'>
                <Check size={14} className='text-emerald-600 dark:text-emerald-400 shrink-0' />
                <span className='text-xs text-emerald-700 dark:text-emerald-300 font-medium'>
                  Branch created
                </span>
              </div>

              <div className='flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2'>
                <GitBranch size={13} className='text-zinc-400 shrink-0' />
                <span className='flex-1 text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate'>
                  {state.branchName}
                </span>
                <button
                  onClick={() => handleCopy(state.branchName)}
                  className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors shrink-0'
                  title='Copy branch name'
                >
                  {copied ? (
                    <Check size={13} className='text-emerald-500' />
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>

              <a
                href={state.url}
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center justify-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
              >
                <ExternalLink size={12} />
                View on GitHub
              </a>

              <Button
                variant='outline'
                className='w-full'
                onClick={onClose}
              >
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/CreateBranchDialog.tsx"
git commit -m "feat: add CreateBranchDialog component"
```

---

## Task 5: Update PR Section in TaskDetailPage + TaskDetailPanel

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

Both files already have `PrStateBadge`, `CiIcon`, `GitPullRequest` from the previous PR feature. We're widening the PR section to always show, and adding a "Branch" button that opens the dialog.

**Changes for both files are identical in logic; apply to each separately.**

- [ ] **Step 1: Update `TaskDetailPage.tsx`**

Read the file first.

**1a. Add imports:**

Add `GitBranch` to the lucide-react import (alongside existing `GitPullRequest`).

Add `CreateBranchDialog` import after the lucide imports:

```typescript
import { CreateBranchDialog } from '../CreateBranchDialog'
```

**1b. Add `createBranchOpen` state:**

In the component body, near the top where other `useState` calls are, add:

```typescript
const [createBranchOpen, setCreateBranchOpen] = useState(false)
```

**1c. Replace the PR section in the JSX:**

Find the current block:

```tsx
{task.pullRequests && task.pullRequests.length > 0 && (
  <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
    <p className='text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
      <GitPullRequest size={12} />
      Pull Requests
    </p>
    <ul className='space-y-2'>
      {task.pullRequests.map(pr => (
        ...
      ))}
    </ul>
  </div>
)}
```

Replace with (keeping the PR list inside, but always showing the section and adding the Branch button):

```tsx
<div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
  <div className='flex items-center justify-between mb-2'>
    <p className='text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5'>
      <GitPullRequest size={12} />
      Pull Requests
    </p>
    <button
      onClick={() => setCreateBranchOpen(true)}
      className='flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors'
    >
      <GitBranch size={11} />
      Branch
    </button>
  </div>
  {task.pullRequests && task.pullRequests.length > 0 && (
    <ul className='space-y-2'>
      {task.pullRequests.map(pr => (
        <li key={pr.id} className='flex items-start gap-2'>
          <CiIcon status={pr.ciStatus} />
          <div className='min-w-0 flex-1'>
            <a
              href={pr.url}
              target='_blank'
              rel='noopener noreferrer'
              className='text-xs text-zinc-700 dark:text-zinc-300 hover:underline font-medium truncate block'
            >
              #{pr.number} {pr.title}
            </a>
            <div className='flex items-center gap-1.5 mt-0.5'>
              <PrStateBadge state={pr.state} />
              <span className='text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate'>
                {pr.headBranch}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )}
</div>

<CreateBranchDialog
  isOpen={createBranchOpen}
  onClose={() => setCreateBranchOpen(false)}
  taskId={task.id}
  identifier={`${task.teamIdentifier}-${task.number}`}
  title={task.title}
  projectId={task.projectId}
  defaultRepo={task.project.githubRepo}
  workspaceUrl={workspaceUrl}
/>
```

Note: The PR list items (the inner `<li>` content) should be exactly what was there before — copy it from the existing code. Do NOT invent new markup for the list items; keep them identical to avoid regressions.

- [ ] **Step 2: Apply same changes to `TaskDetailPanel.tsx`**

Read the file. Apply the same pattern:

- Add `GitBranch` to lucide imports
- Add `CreateBranchDialog` import
- Add `createBranchOpen` state
- Replace the PR section with the always-visible version + Branch button
- Mount `CreateBranchDialog` at the end of the section

For `TaskDetailPanel`, the `identifier` prop construction is:

```tsx
identifier={`${task.teamIdentifier}-${task.number}`}
```

`TaskDetailPanel` receives `task` as a prop (already a `TaskDetail`) and `workspaceUrl` via `useParams`. Check what props are available — if `workspaceUrl` is from `useParams`, use that.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx" \
        "app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx"
git commit -m "feat: add Create Branch button to task detail PR section"
```

---

## Done

After all 5 tasks, the full flow works:

1. User opens a task detail page → sees the "Pull Requests" section always (even when no PRs)
2. Clicks "Branch" → `CreateBranchDialog` opens
3. Branch name pre-filled as `lumo/ENG-123-task-title`, repo pre-selected (project's saved repo or first available)
4. User edits if needed → clicks "Create branch"
5. `POST /api/tasks/:id/branch` fetches `main` SHA, creates the branch on GitHub, saves repo to `project.githubRepo`
6. Dialog shows success: branch name + copy button + "View on GitHub" link
