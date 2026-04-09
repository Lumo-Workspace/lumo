# Unlink / Delete Branch from Task — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to unlink a branch from a task (remove DB record only) or additionally delete the remote GitHub branch.

**Architecture:** Add a DELETE endpoint at `/api/tasks/[id]/branch/[branchId]` with an optional `deleteRemote=true` query param. When `deleteRemote` is set, the route fetches the GitHub integration token and calls the GitHub refs API to delete the remote branch before removing the DB record. The UI adds an X button per branch row that opens a confirmation dialog with a checkbox for remote deletion.

**Tech Stack:** Next.js API Routes, Prisma, GitHub REST API, React, shadcn/ui Dialog, react-intl

---

## File Map

| File                                                               | Action | Responsibility                                               |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------ |
| `lib/repositories/github.repository.ts`                            | Modify | Add `findTaskBranch`, `deleteTaskBranch`                     |
| `app/api/tasks/[id]/branch/[branchId]/route.ts`                    | Create | DELETE handler — auth, optional GitHub deletion, DB deletion |
| `app/workspace/[workspaceUrl]/constants.ts`                        | Modify | Add `branchDelete` URL helper                                |
| `lib/api-client/tasks.ts`                                          | Modify | Add `unlinkBranch` method                                    |
| `app/workspace/[workspaceUrl]/components/UnlinkBranchDialog.tsx`   | Create | Confirmation dialog with "delete remote" checkbox            |
| `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`    | Modify | Add X button, wire dialog                                    |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` | Modify | Pass `onUnlinkBranch` to sidebar                             |
| `lib/i18n/en.json`                                                 | Modify | Add i18n keys                                                |
| `lib/i18n/zh.json`                                                 | Modify | Add i18n keys                                                |

---

### Task 1: Repository — add `findTaskBranch` and `deleteTaskBranch`

**Files:**

- Modify: `lib/repositories/github.repository.ts:206-223` (Task Branches section)

- [ ] **Step 1: Add `findTaskBranch` method**

In `lib/repositories/github.repository.ts`, after the `createTaskBranch` method (line 223), add:

```typescript
  /** Find a task branch by ID. */
  async findTaskBranch(branchId: string) {
    return prisma.taskBranch.findUnique({
      where: { id: branchId },
    })
  },
```

- [ ] **Step 2: Add `deleteTaskBranch` method**

Immediately after `findTaskBranch`, add:

```typescript
  /** Delete a task branch record by ID. */
  async deleteTaskBranch(branchId: string) {
    return prisma.taskBranch.delete({
      where: { id: branchId },
    })
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/repositories/github.repository.ts
git commit -m "feat: add findTaskBranch and deleteTaskBranch to repository [LUM-0]"
```

---

### Task 2: API Route — DELETE `/api/tasks/[id]/branch/[branchId]`

**Files:**

- Create: `app/api/tasks/[id]/branch/[branchId]/route.ts`

- [ ] **Step 1: Create the route file**

Create `app/api/tasks/[id]/branch/[branchId]/route.ts` with the following content:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories/task.repository'
import { githubRepository } from '@/lib/repositories'
import { decrypt } from '@/lib/crypto'

type Params = { params: Promise<{ id: string; branchId: string }> }

const GH_API = 'https://api.github.com'
const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

/**
 * DELETE /api/tasks/[id]/branch/[branchId]
 * Query: ?deleteRemote=true  — also delete the branch on GitHub
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id: taskId, branchId } = await params

    // Verify task exists and user is workspace member
    const task = await taskRepository.findWithProjectWorkspaceId(taskId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    // Verify branch belongs to this task
    const branch = await githubRepository.findTaskBranch(branchId)
    if (!branch || branch.taskId !== taskId) {
      return NextResponse.json(
        { error: 'Branch not linked to this task' },
        { status: 404 }
      )
    }

    // Optionally delete remote branch on GitHub
    const deleteRemote =
      request.nextUrl.searchParams.get('deleteRemote') === 'true'

    if (deleteRemote) {
      const integration = await githubRepository.findIntegrationByRepo(
        task.project.workspaceId,
        branch.repo
      )
      if (integration) {
        const token = decrypt(integration.accessToken)
        const res = await fetch(
          `${GH_API}/repos/${branch.repo}/git/refs/heads/${branch.branchName}`,
          { method: 'DELETE', headers: GH_HEADERS(token) }
        )
        // 422 = branch already deleted or is default branch — not a fatal error
        if (!res.ok && res.status !== 422 && res.status !== 404) {
          const err = await res.json().catch(() => ({}))
          return NextResponse.json(
            {
              error:
                (err as { message?: string }).message ??
                'Failed to delete remote branch',
            },
            { status: 422 }
          )
        }
      }
    }

    // Delete DB record
    await githubRepository.deleteTaskBranch(branchId)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/tasks/\[id\]/branch/\[branchId\]/route.ts
git commit -m "feat: add DELETE /api/tasks/[id]/branch/[branchId] route [LUM-0]"
```

---

### Task 3: API Client — add constants and client method

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts:7` (after `branch` entry)
- Modify: `lib/api-client/tasks.ts:21-23` (after `createBranch`)

- [ ] **Step 1: Add URL constant**

In `app/workspace/[workspaceUrl]/constants.ts`, inside the `tasks` object, after the `branch` entry (line 7):

```typescript
    branchDelete: (id: string, branchId: string) =>
      `/api/tasks/${id}/branch/${branchId}`,
```

- [ ] **Step 2: Add client method**

In `lib/api-client/tasks.ts`, after the `createBranch` method (line 23), add:

```typescript
  unlinkBranch(taskId: string, branchId: string, deleteRemote = false) {
    const url = deleteRemote
      ? `${API.tasks.branchDelete(taskId, branchId)}?deleteRemote=true`
      : API.tasks.branchDelete(taskId, branchId)
    return apiFetch<void>(url, { method: 'DELETE' })
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/constants.ts lib/api-client/tasks.ts
git commit -m "feat: add unlinkBranch API client and URL constant [LUM-0]"
```

---

### Task 4: i18n — add messages

**Files:**

- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/zh.json`

- [ ] **Step 1: Add English messages**

In `lib/i18n/en.json`, near the existing `task.unlinkPr` key (around line 467), add:

```json
"task.unlinkBranch": "Unlink branch",
"task.unlinkBranchConfirm": "Are you sure you want to unlink this branch from the task?",
"task.deleteRemoteBranch": "Also delete the remote branch on GitHub",
"task.unlinking": "Unlinking…",
```

- [ ] **Step 2: Add Chinese messages**

In `lib/i18n/zh.json`, near the existing `task.unlinkPr` key, add:

```json
"task.unlinkBranch": "取消关联分支",
"task.unlinkBranchConfirm": "确定要取消关联此分支吗？",
"task.deleteRemoteBranch": "同时删除 GitHub 远程分支",
"task.unlinking": "取消关联中…",
```

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/en.json lib/i18n/zh.json
git commit -m "feat: add i18n messages for branch unlinking [LUM-0]"
```

---

### Task 5: UI — UnlinkBranchDialog component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/UnlinkBranchDialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `app/workspace/[workspaceUrl]/components/UnlinkBranchDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { tasksClient } from '@/lib/api-client'

interface UnlinkBranchDialogProps {
  isOpen: boolean
  onClose: () => void
  taskId: string
  branchId: string
  branchName: string
  onUnlinked: (branchId: string) => void
}

export function UnlinkBranchDialog({
  isOpen,
  onClose,
  taskId,
  branchId,
  branchName,
  onUnlinked,
}: UnlinkBranchDialogProps) {
  const intl = useIntl()
  const [deleteRemote, setDeleteRemote] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await tasksClient.unlinkBranch(taskId, branchId, deleteRemote)
      onUnlinked(branchId)
      onClose()
    } catch {
      toast.error('Failed to unlink branch')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !loading) {
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'task.unlinkBranch' })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: 'task.unlinkBranchConfirm' })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          <p className='text-xs font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-md px-3 py-2 truncate'>
            {branchName}
          </p>

          <label className='flex items-center gap-2 cursor-pointer'>
            <Checkbox
              checked={deleteRemote}
              onCheckedChange={v => setDeleteRemote(v === true)}
              disabled={loading}
            />
            <span className='text-xs text-zinc-600 dark:text-zinc-400'>
              {intl.formatMessage({ id: 'task.deleteRemoteBranch' })}
            </span>
          </label>

          <div className='flex gap-2'>
            <Button
              variant='outline'
              className='flex-1'
              onClick={onClose}
              disabled={loading}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button
              variant='destructive'
              className='flex-1'
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading && <Loader2 size={14} className='animate-spin mr-2' />}
              {loading
                ? intl.formatMessage({ id: 'task.unlinking' })
                : intl.formatMessage({ id: 'task.unlinkBranch' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/UnlinkBranchDialog.tsx
git commit -m "feat: add UnlinkBranchDialog component [LUM-0]"
```

---

### Task 6: Wire up — Sidebar X button, dialog state, callbacks

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`

- [ ] **Step 1: Add props and imports to TaskDetailSidebar**

In `TaskDetailSidebar.tsx`:

1. Add import for `UnlinkBranchDialog`:

```typescript
import { UnlinkBranchDialog } from './UnlinkBranchDialog'
```

2. Add to `TaskDetailSidebarProps` interface (after `onBranchCreated`):

```typescript
  /** Called when a branch is unlinked. */
  onUnlinkBranch?: (branchId: string) => void
```

3. Destructure `onUnlinkBranch` in the component function params.

- [ ] **Step 2: Add dialog state to TaskDetailSidebar**

Inside the `TaskDetailSidebar` function body, after `const intl = useIntl()`, add:

```typescript
const [unlinkBranch, setUnlinkBranch] = useState<{
  id: string
  name: string
} | null>(null)
```

Add `useState` to the React import at the top of the file.

- [ ] **Step 3: Add X button to each branch row**

In the branch list `<li>` (around line 231), after the `<a>` with `<ExternalLink>`, add:

```tsx
<button
  onClick={() =>
    setUnlinkBranch({
      id: branch.id,
      name: branch.branchName,
    })
  }
  className='shrink-0 opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-all'
  title={intl.formatMessage({ id: 'task.unlinkBranch' })}
>
  <X size={12} />
</button>
```

- [ ] **Step 4: Add UnlinkBranchDialog to render**

Before the closing `</div>` of the component (before `<CreateBranchDialog`), add:

```tsx
{
  unlinkBranch && (
    <UnlinkBranchDialog
      isOpen={!!unlinkBranch}
      onClose={() => setUnlinkBranch(null)}
      taskId={task.id}
      branchId={unlinkBranch.id}
      branchName={unlinkBranch.name}
      onUnlinked={branchId => {
        onUnlinkBranch?.(branchId)
        setUnlinkBranch(null)
      }}
    />
  )
}
```

- [ ] **Step 5: Wire `onUnlinkBranch` in TaskDetailPage**

In `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`, on the `<TaskDetailSidebar>` element, add the `onUnlinkBranch` prop after `onBranchCreated`:

```tsx
            onUnlinkBranch={branchId =>
              setTask(prev => ({
                ...prev,
                branches: (prev.branches ?? []).filter(b => b.id !== branchId),
              }))
            }
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailSidebar.tsx \
       app/workspace/\[workspaceUrl\]/components/pages/TaskDetailPage.tsx
git commit -m "feat: wire up unlink branch button and dialog in sidebar [LUM-0]"
```
