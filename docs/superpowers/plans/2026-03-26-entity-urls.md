# Entity URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shareable deep links for projects (`/workspace/[slug]/projects/[id]`), tasks (existing route), and comments (`#comment-[id]` anchors), with copy-to-clipboard buttons on every entity.

**Architecture:** A new project detail route mirrors the existing task detail route pattern (server component → client component with AppSidebar). A shared `copyLink` utility handles clipboard + toast. Comment anchor scrolling reuses the existing `scrollToComment` + `highlightedCommentId` mechanism already present in `TaskDetailPage`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma, Tailwind CSS, Lucide React, Sonner (toasts)

---

## File Structure

| File                                                                            | Action | Responsibility                                                                                      |
| ------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/utils/copyLink.ts`                                | Create | Clipboard utility with toast feedback                                                               |
| `app/workspace/[workspaceUrl]/projects/[projectId]/page.tsx`                    | Create | Auth + workspace guard + Prisma fetch → passes to client component                                  |
| `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx` | Create | Client component: AppSidebar, dark mode, data fetch, ProjectDetailPage wiring, project copy link    |
| `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`                        | Modify | Add task copy link button to header                                                                 |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`              | Modify | Add task copy link button to breadcrumb; add comment copy link buttons; add anchor scroll useEffect |
| `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`                   | Modify | Add `useParams` for `workspaceUrl`; add comment copy link buttons (top-level + replies)             |
| `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx`                | Modify | Add `useParams` for `workspaceUrl`; add copy link button on project table rows                      |

---

## Task 1: Create copyLink utility

**Files:**

- Create: `app/workspace/[workspaceUrl]/utils/copyLink.ts`

- [ ] **Step 1: Create the file**

```ts
// app/workspace/[workspaceUrl]/utils/copyLink.ts
import { toast } from 'sonner'

export async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Link copied')
  } catch {
    toast.error('Failed to copy link')
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/utils/copyLink.ts
git commit -m "feat: add copyLink utility for clipboard + toast feedback"
```

---

## Task 2: Create project detail server component

**Files:**

- Create: `app/workspace/[workspaceUrl]/projects/[projectId]/page.tsx`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p "app/workspace/[workspaceUrl]/projects/[projectId]"
```

Create `app/workspace/[workspaceUrl]/projects/[projectId]/page.tsx`:

```tsx
import { redirect, notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { ProjectDetailStandalonePage } from '../../components/pages/ProjectDetailStandalonePage'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; projectId: string }>
}) {
  const { workspaceUrl, projectId } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Verify workspace membership
  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
  })
  if (!workspace) redirect('/onboarding')

  // Fetch project — workspaceId is the security boundary
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: workspace.id },
  })
  if (!project) notFound()

  // Serialize Dates — Next.js cannot pass Date objects from server to client
  const serialized = {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }

  return (
    <ProjectDetailStandalonePage
      initialProject={serialized}
      workspaceUrl={workspaceUrl}
    />
  )
}
```

- [ ] **Step 2: Check TypeScript compiles (will fail until Step 3 creates the client component — that's expected)**

```bash
npx tsc --noEmit 2>&1 | grep "ProjectDetailStandalonePage"
```

Expected: error about missing module (correct — client component not created yet)

- [ ] **Step 3: Commit**

```bash
git add "app/workspace/[workspaceUrl]/projects/[projectId]/page.tsx"
git commit -m "feat: add project detail server component at /projects/[projectId]"
```

---

## Task 3: Create ProjectDetailStandalonePage client component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx`

This is the largest task. It follows the exact same pattern as `TaskDetailPage.tsx` for sidebar + dark mode.

- [ ] **Step 1: Create the file**

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Link as LinkIcon, Check } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { AnimatePresence } from 'motion/react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '../Sidebar'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ApiProject,
  ApiTask,
  ApiStatus,
  WorkspaceMemberInfo,
  Page,
} from '../../types'
import { API, CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
import { ProjectDetailPage } from './ProjectDetailPage'
import { NewTaskModal, NewTaskFormData } from '../modals/NewTaskModal'
import { copyLink } from '../../utils/copyLink'
import { toast } from 'sonner'

interface Props {
  initialProject: ApiProject
  workspaceUrl: string
}

export function ProjectDetailStandalonePage({
  initialProject,
  workspaceUrl,
}: Props) {
  const router = useRouter()
  const { user } = useUser()

  // ── Dark mode (same pattern as TaskDetailPage) ────────────────────────────
  const [isDarkMode, setIsDarkMode] = useState(false)
  useEffect(() => {
    setIsDarkMode(localStorage.getItem(CACHE_KEY.darkMode) === 'true')
  }, [])
  const handleToggleDarkMode = useCallback(() => {
    setIsDarkMode(prev => {
      const next = !prev
      localStorage.setItem(CACHE_KEY.darkMode, String(next))
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }, [])

  // ── Copy link ─────────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false)
  const handleCopyLink = useCallback(async () => {
    await copyLink(
      `${window.location.origin}/workspace/${workspaceUrl}/projects/${initialProject.id}`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [workspaceUrl, initialProject.id])

  // ── Data state ────────────────────────────────────────────────────────────
  const [project, setProject] = useState<ApiProject>(initialProject)
  const [tasks, setTasks] = useState<ApiTask[]>([])
  const [kanbanViewId, setKanbanViewId] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── New task modal ────────────────────────────────────────────────────────
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false)
  const [newTaskDefaultStatus, setNewTaskDefaultStatus] = useState<
    ApiStatus | undefined
  >()

  // ── Fetch tasks ───────────────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(API.projects.tasks(project.id))
      if (!res.ok) throw new Error()
      const data = (await res.json()) as {
        tasks: ApiTask[]
        kanbanViewId: string | null
      }
      setTasks(data.tasks)
      setKanbanViewId(data.kanbanViewId)
      writeCache(CACHE_KEY.projectTasks(project.id), {
        taskIds: data.tasks.map(t => t.id),
        kanbanViewId: data.kanbanViewId,
      })
    } catch {
      setError('Could not load tasks.')
    } finally {
      setLoading(false)
    }
  }, [project.id])

  // ── Mount: hydrate from cache + parallel fetch ────────────────────────────
  useEffect(() => {
    // Hydrate from cache immediately
    const cachedMembers = readCache<WorkspaceMemberInfo[]>(CACHE_KEY.members)
    if (cachedMembers) setMembers(cachedMembers)

    const cachedTasks = readCache<{
      taskIds?: string[]
      tasks?: ApiTask[]
      kanbanViewId?: string | null
    }>(CACHE_KEY.projectTasks(project.id))
    if (cachedTasks?.tasks) {
      setTasks(cachedTasks.tasks)
      setKanbanViewId(cachedTasks.kanbanViewId ?? null)
    }

    // Hydrate projects cache (for write-back consistency with WorkspaceApp)
    const cachedProjects = readCache<ApiProject[]>(CACHE_KEY.projects)
    // (no setProjects state needed — ProjectDetailPage doesn't consume a projects list)

    // Parallel fetch: members + project tasks + projects list (cache refresh only)
    Promise.all([
      fetch(API.workspaces.members).then(r => (r.ok ? r.json() : null)),
      fetch(API.projects.tasks(project.id)).then(r => (r.ok ? r.json() : null)),
      fetch(API.projects.list).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([membersData, tasksData, projectsData]) => {
        if (membersData?.members) {
          setMembers(membersData.members)
          writeCache(CACHE_KEY.members, membersData.members)
        }
        if (tasksData?.tasks) {
          setTasks(tasksData.tasks)
          setKanbanViewId(tasksData.kanbanViewId ?? null)
          writeCache(CACHE_KEY.projectTasks(project.id), {
            taskIds: tasksData.tasks.map((t: ApiTask) => t.id),
            kanbanViewId: tasksData.kanbanViewId,
          })
        }
        if (projectsData?.projects) {
          writeCache(CACHE_KEY.projects, projectsData.projects)
        }
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [project.id])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCreateTask = useCallback(
    async ({
      title,
      description,
      status,
      priority,
      assigneeId,
    }: NewTaskFormData) => {
      const res = await fetch(API.projects.tasks(project.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description?.trim() || undefined,
          status,
          priority,
          assigneeId: assigneeId || undefined,
        }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        toast.error(err.error ?? 'Failed to create task')
        return
      }
      const { task } = (await res.json()) as { task: ApiTask }
      setTasks(prev => [...prev, task])
      toast.success('Task created')
    },
    [project.id]
  )

  const handleDeleteTask = useCallback(async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await fetch(API.tasks.byId(taskId), { method: 'DELETE' })
  }, [])

  const handleTaskStatusChanged = useCallback(
    (_taskId: string, _old: string, _new: string) => {
      // ProjectDetailPage handles optimistic DnD update internally via setTasks
    },
    []
  )

  const handleUpdateProject = useCallback(
    async (
      id: string,
      data: {
        name?: string
        description?: string
        defaultReviewerId?: string | null
      }
    ) => {
      const res = await fetch(API.projects.byId(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update project')
      const { project: updated } = await res.json()
      setProject(prev => ({ ...prev, ...updated }))
    },
    []
  )

  const handleDeleteProject = useCallback(
    async (id: string) => {
      await fetch(API.projects.byId(id), { method: 'DELETE' })
      router.push(`/workspace/${workspaceUrl}`)
    },
    [router, workspaceUrl]
  )

  return (
    <SidebarProvider className='h-screen font-sans'>
      <AppSidebar
        currentPage={'projects' as Page}
        onNavigate={() => router.push(`/workspace/${workspaceUrl}`)}
        isDarkMode={isDarkMode}
        onToggleDarkMode={handleToggleDarkMode}
        unreadCount={0}
      />

      <SidebarInset className='overflow-hidden flex flex-col'>
        {/* Breadcrumb */}
        <div className='flex items-center justify-between px-5 h-10 border-b border-zinc-100 dark:border-zinc-800 shrink-0 text-sm'>
          <div className='flex items-center gap-1.5'>
            <button
              onClick={() => router.push(`/workspace/${workspaceUrl}`)}
              className='flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
            >
              <ChevronLeft size={14} />
              <span>Projects</span>
            </button>
            <span className='text-zinc-300 dark:text-zinc-600'>›</span>
            <span className='text-zinc-700 dark:text-zinc-300 truncate max-w-xs'>
              {project.name}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                onClick={handleCopyLink}
                className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              >
                {copied ? <Check size={14} /> : <LinkIcon size={14} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy link</TooltipContent>
          </Tooltip>
        </div>

        {/* Main content */}
        <div className='flex-1 overflow-hidden'>
          <ProjectDetailPage
            project={project}
            tasks={tasks}
            setTasks={setTasks}
            viewId={kanbanViewId}
            loading={loading}
            error={error}
            onRetry={fetchTasks}
            onBack={() => router.push(`/workspace/${workspaceUrl}`)}
            onNewTask={status => {
              setNewTaskDefaultStatus(status)
              setIsNewTaskModalOpen(true)
            }}
            onTaskClick={task =>
              router.push(
                `/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}`
              )
            }
            onDeleteTask={handleDeleteTask}
            onTaskStatusChanged={handleTaskStatusChanged}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            members={members}
          />
        </div>
      </SidebarInset>

      <AnimatePresence>
        {isNewTaskModalOpen && (
          <NewTaskModal
            isOpen={isNewTaskModalOpen}
            onClose={() => {
              setIsNewTaskModalOpen(false)
              setNewTaskDefaultStatus(undefined)
            }}
            projects={[project]}
            members={members}
            defaultProjectId={project.id}
            defaultStatus={newTaskDefaultStatus}
            onSubmit={handleCreateTask}
          />
        )}
      </AnimatePresence>
    </SidebarProvider>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Manual test**

Navigate to `http://localhost:3000/workspace/[your-slug]/projects/[any-project-id]`.
Expected:

- Page loads with sidebar and project detail (kanban/list tabs)
- "Projects" breadcrumb navigates back to workspace root
- Copy link button copies the URL to clipboard with "Link copied" toast

- [ ] **Step 4: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx"
git commit -m "feat: add ProjectDetailStandalonePage standalone route with sidebar and copy link"
```

---

## Task 4: Add task copy link to TaskDrawer

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`

The drawer header currently has two buttons: `SquareArrowOutUpRight` (open full page) and `X` (close). Add a `Link` copy button between them.

- [ ] **Step 1: Add imports and state**

In `TaskDrawer.tsx`, add to the existing import line for lucide-react:

```tsx
// Before (line 4):
import { X, SquareArrowOutUpRight } from 'lucide-react'

// After:
import { X, SquareArrowOutUpRight, Link as LinkIcon, Check } from 'lucide-react'
```

Add `useState` to the React import (currently the file has no React imports — add at top):

```tsx
import { useState, useCallback } from 'react'
```

Add import for copyLink utility:

```tsx
import { copyLink } from '../utils/copyLink'
```

- [ ] **Step 2: Add copied state inside the component body**

Inside `TaskDrawer` function, after the existing `const router` and `const { workspaceUrl }` lines, add:

```tsx
const [copied, setCopied] = useState(false)
const handleCopyLink = useCallback(async () => {
  await copyLink(
    `${window.location.origin}/workspace/${workspaceUrl}/tasks/${initialTask.teamIdentifier}-${initialTask.number}`
  )
  setCopied(true)
  setTimeout(() => setCopied(false), 1500)
}, [workspaceUrl, initialTask.teamIdentifier, initialTask.number])
```

- [ ] **Step 3: Add the button to the header**

In the header `<div className='flex items-center justify-between px-5 pt-4 shrink-0'>`, the current structure is `[SquareArrowOutUpRight button] [X button]`. Add the link button between them:

```tsx
{
  /* Replace the header content with: */
}
;<div className='flex items-center justify-between px-5 pt-4 shrink-0'>
  <Button
    variant='ghost'
    size='icon'
    onClick={() => {
      sessionStorage.setItem('lumo:taskSource', source)
      onClose()
      router.push(
        `/workspace/${workspaceUrl}/tasks/${initialTask.teamIdentifier}-${initialTask.number}`
      )
    }}
    className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
    title='Open full page'
  >
    <SquareArrowOutUpRight size={14} />
  </Button>
  <div className='flex items-center gap-1'>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          onClick={handleCopyLink}
          className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
        >
          {copied ? <Check size={14} /> : <LinkIcon size={14} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy link</TooltipContent>
    </Tooltip>
    <Button
      variant='ghost'
      size='icon'
      onClick={onClose}
      className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
    >
      <X size={14} />
    </Button>
  </div>
</div>
```

Add the Tooltip import if not present:

```tsx
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
```

- [ ] **Step 4: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Manual test**

Open a task drawer. Expected:

- Three buttons in header: `SquareArrowOutUpRight` | `Link` | `X`
- Clicking `Link` shows "Link copied" toast and swaps to `Check` icon briefly
- URL in clipboard: `/workspace/[slug]/tasks/LUM-12` (or equivalent)

- [ ] **Step 6: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/TaskDrawer.tsx"
git commit -m "feat: add copy link button to TaskDrawer header"
```

---

## Task 5: Add task copy link and comment anchor scroll to TaskDetailPage

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`

Two changes: (A) copy link button next to breadcrumb, (B) comment anchor scroll `useEffect`.

- [ ] **Step 1: Add imports**

Add to the lucide-react import line:

```tsx
// Before (line 5):
import { ChevronLeft, Send, Pencil, Trash2, Reply } from 'lucide-react'

// After:
import {
  ChevronLeft,
  Send,
  Pencil,
  Trash2,
  Reply,
  Link as LinkIcon,
  Check,
} from 'lucide-react'
```

Add `copyLink` import:

```tsx
import { copyLink } from '../../utils/copyLink'
```

- [ ] **Step 2: Add `copied` state for task copy link (near existing state declarations ~line 65)**

After the `isDarkMode` state block (~line 76), add:

```tsx
const [taskLinkCopied, setTaskLinkCopied] = useState(false)
const handleCopyTaskLink = useCallback(async () => {
  await copyLink(
    `${window.location.origin}/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}`
  )
  setTaskLinkCopied(true)
  setTimeout(() => setTaskLinkCopied(false), 1500)
}, [workspaceUrl, task.teamIdentifier, task.number])
```

- [ ] **Step 3: Add comment anchor scroll useEffect**

After the existing `hasScrolled` ref (add it) and after the `scrollToComment` definition (~line 272), add:

```tsx
// Anchor scroll: fire once when comments first load
const hasScrolled = useRef(false)
useEffect(() => {
  if (hasScrolled.current) return
  if (!comments.length) return
  const hash = window.location.hash // e.g. "#comment-cm4abc123"
  if (!hash.startsWith('#comment-')) return
  const commentId = hash.slice('#comment-'.length)
  hasScrolled.current = true
  scrollToComment(commentId) // reuses existing helper + highlightedCommentId
}, [comments, scrollToComment])
// scrollToComment is stable (useCallback []) — safe in dep array
```

- [ ] **Step 4: Add the copy link button to the breadcrumb bar**

The breadcrumb bar is at ~lines 450-467:

```tsx
{
  /* Breadcrumb */
}
;<div className='flex items-center justify-between px-5 h-10 border-b border-zinc-100 dark:border-zinc-800 shrink-0 text-sm'>
  <div className='flex items-center gap-1.5'>
    <button
      onClick={() => router.back()}
      className='flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
    >
      <ChevronLeft size={14} />
      <span>{sourceLabel}</span>
    </button>
    <span className='text-zinc-300 dark:text-zinc-600'>›</span>
    <span className='text-zinc-500 font-medium'>
      {task.teamIdentifier}-{task.number}
    </span>
    <span className='text-zinc-300 dark:text-zinc-600'>·</span>
    <span className='text-zinc-700 dark:text-zinc-300 truncate max-w-xs'>
      {task.title}
    </span>
  </div>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant='ghost'
        size='icon'
        onClick={handleCopyTaskLink}
        className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
      >
        {taskLinkCopied ? <Check size={14} /> : <LinkIcon size={14} />}
      </Button>
    </TooltipTrigger>
    <TooltipContent>Copy link</TooltipContent>
  </Tooltip>
</div>
```

Replace the existing breadcrumb `<div>` (currently `<div className='flex items-center gap-1.5 ...'>`) with the `justify-between` version above.

- [ ] **Step 5: Add per-comment copy link buttons**

For **top-level comments** (inside the `comments.map(...)` loop, in the action buttons div ~line 694):

The action buttons div is: `<div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5'>`. Add a copy link button **before** the Reply button:

```tsx
{
  /* Copy link button — before Reply */
}
;<Tooltip>
  <TooltipTrigger asChild>
    <button
      className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
      onClick={() =>
        copyLink(
          `${window.location.origin}/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}#comment-${comment.id}`
        )
      }
    >
      <LinkIcon size={12} />
    </button>
  </TooltipTrigger>
  <TooltipContent>Copy link</TooltipContent>
</Tooltip>
```

For **replies** (inside the `comment.replies!.map(reply => ...)` loop), add the same button in the reply action buttons area (look for the reply's action buttons div, same `opacity-0 group-hover:opacity-100` pattern):

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <button
      className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
      onClick={() =>
        copyLink(
          `${window.location.origin}/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}#comment-${reply.id}`
        )
      }
    >
      <LinkIcon size={12} />
    </button>
  </TooltipTrigger>
  <TooltipContent>Copy link</TooltipContent>
</Tooltip>
```

Note: `window.location.origin` is used instead of constructing the host manually — it works correctly in both dev and prod.

- [ ] **Step 6: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Manual test**

1. Open a task detail page (e.g. `http://localhost:3000/workspace/lumo/tasks/LUM-12`)
2. Copy link button in breadcrumb → toast "Link copied" → URL in clipboard matches page URL
3. Hover a comment → copy link icon appears → click → clipboard contains `#comment-[id]`
4. Open URL with `#comment-[id]` → page loads → scrolls to and highlights that comment

- [ ] **Step 8: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx"
git commit -m "feat: add task copy link, comment copy links, and anchor scroll to TaskDetailPage"
```

---

## Task 6: Add comment copy link to TaskDetailPanel

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

Note: `TaskDetailPanel` already has `id={`comment-${comment.id}`}` on both top-level (line 611) and reply (line 784) comment divs — no changes needed there.

- [ ] **Step 1: Add imports**

Add to the lucide-react import line (line 4):

```tsx
// Before:
import { Send, Pencil, Trash2, Reply } from 'lucide-react'

// After:
import { Send, Pencil, Trash2, Reply, Link as LinkIcon } from 'lucide-react'
```

Add `useParams` import at the top:

```tsx
import { useParams } from 'next/navigation'
```

Add `copyLink` import:

```tsx
import { copyLink } from '../utils/copyLink'
```

- [ ] **Step 2: Add `useParams` call inside the `TaskDetailPanel` component**

After the existing `const { user } = useUser()` call (around line 125 in the component body, after the props destructuring), add:

```tsx
const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
```

- [ ] **Step 3: Add copy link button to top-level comment action buttons**

Find the action buttons div for top-level comments (~line 694, inside `{!isEditing && (`):

```tsx
<div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5'>
  {/* ADD before the Reply button: */}
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
        onClick={() => copyLink(
          `${window.location.origin}/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}#comment-${comment.id}`
        )}
      >
        <LinkIcon size={12} />
      </button>
    </TooltipTrigger>
    <TooltipContent>Copy link</TooltipContent>
  </Tooltip>
  {/* existing Reply button follows */}
```

- [ ] **Step 4: Add copy link button to reply action buttons**

Find the reply action buttons div (similar `opacity-0 group-hover:opacity-100` div inside `comment.replies!.map(reply => ...)`). Add the same button before any existing reply action buttons:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <button
      className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
      onClick={() =>
        copyLink(
          `${window.location.origin}/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}#comment-${reply.id}`
        )
      }
    >
      <LinkIcon size={12} />
    </button>
  </TooltipTrigger>
  <TooltipContent>Copy link</TooltipContent>
</Tooltip>
```

- [ ] **Step 5: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Manual test**

1. Open a task drawer
2. Hover a comment → copy link icon appears in action buttons
3. Click → toast "Link copied" → clipboard contains full task URL with `#comment-[id]`
4. Open that URL in browser → goes to task detail page → scrolls to and highlights the comment

- [ ] **Step 7: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx"
git commit -m "feat: add comment copy link buttons to TaskDetailPanel drawer"
```

---

## Task 7: Add project copy link to ProjectsPage

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx`

> **Note on location:** The spec references `WorkspaceApp.tsx` for project copy links. However, `AppSidebar` contains only a single "Projects" nav button — there are no per-project sidebar items. The actual project list lives in `ProjectsPage.tsx` (a `<table>`). This plan correctly targets `ProjectsPage.tsx`. The spec's reference to `WorkspaceApp.tsx` was based on an assumed sidebar project list that does not exist in the current codebase.

The projects list is a `<table>` with `<tr>` rows (~line 228). Each row needs a hover copy link button.

- [ ] **Step 1: Add imports**

Add to lucide-react imports:

```tsx
import { Link as LinkIcon } from 'lucide-react'
```

Add `useParams` import:

```tsx
import { useParams } from 'next/navigation'
```

Add `copyLink` import:

```tsx
import { copyLink } from '../../utils/copyLink'
```

Add Tooltip imports (check if already present — if not):

```tsx
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
```

- [ ] **Step 2: Add `useParams` call inside the component**

Inside the `ProjectsPage` component function body, add:

```tsx
const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
```

- [ ] **Step 3: Add copy link button to each project table row**

The project rows are in a `<tbody>` with `<tr>` elements (~line 228). Each `<tr>` has 4 `<td>` cells. The last `<td>` currently shows the `updatedAt` date. Add a 5th `<td>` for the copy link button (or append it inside the last `<td>`).

The cleanest approach: add the copy link button inside the last `<td>` as a flex row with the date on the left and icon on the right. Replace the last `<td>` of each row:

```tsx
<td className='py-4 px-6 text-right text-zinc-500 dark:text-zinc-400 text-xs border-b border-zinc-200 dark:border-zinc-800'>
  <div className='flex items-center justify-end gap-2'>
    <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100'
          onClick={e => {
            e.stopPropagation() // prevent row click (which opens project)
            copyLink(
              `${window.location.origin}/workspace/${workspaceUrl}/projects/${project.id}`
            )
          }}
        >
          <LinkIcon size={12} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Copy link</TooltipContent>
    </Tooltip>
  </div>
</td>
```

Note: `e.stopPropagation()` is critical — the `<tr>` has an `onClick={() => onSelectProject(project)}` that would fire without it.

- [ ] **Step 4: Check TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Manual test**

1. Navigate to `http://localhost:3000/workspace/[slug]` → Projects page
2. Hover a project row → copy link icon appears on the right
3. Click icon → "Link copied" toast → clipboard contains `/workspace/[slug]/projects/[id]`
4. Open the copied URL → loads the standalone `ProjectDetailStandalonePage`

- [ ] **Step 6: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx"
git commit -m "feat: add copy link button to project rows in ProjectsPage"
```

---

## Final verification

- [ ] **TypeScript clean build**

```bash
npx tsc --noEmit
```

Expected: zero errors

- [ ] **Full flow test**

1. **Project URL**: Copy link from Projects page → open in new tab → loads project detail page with sidebar ✓
2. **Task URL (drawer)**: Open task drawer → click Link button → clipboard has task URL ✓
3. **Task URL (page)**: Open task detail page → click Link button in breadcrumb → clipboard ✓
4. **Comment URL (drawer)**: Hover comment → click Link → clipboard has `#comment-[id]` anchor ✓
5. **Comment URL (page)**: Hover comment → click Link → clipboard ✓
6. **Comment anchor**: Paste a `#comment-[id]` URL into address bar → page loads → scrolls to and highlights that comment ✓
7. **Dark mode**: Toggle dark mode on project detail page → persists on reload ✓
