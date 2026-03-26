# Task Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the TaskDrawer expand button with a `SquareArrowOutUpRight` icon that navigates to a new full-page task detail view at `/workspace/[slug]/tasks/[identifier]`.

**Architecture:** Five targeted changes — two type-only edits, one drawer refactor, one WorkspaceApp prop addition, and two new files (server page + client page). The client page duplicates the properties + comments UI from `TaskDetailPanel` into a two-column layout alongside its own sidebar instance.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma, Tailwind CSS, shadcn/ui, Lucide icons, Clerk auth, Vaul drawer

**Spec:** `docs/superpowers/specs/2026-03-26-task-detail-page-design.md`

---

## File Map

| File                                                               | Change                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/types.ts`                            | Add `'task-detail'` to `Page` union; add `children?` to `TaskDetail`                               |
| `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`           | Replace expand toggle with open-page button; add `source` prop; fix `onUpdate` type                |
| `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`                    | Derive and pass `source` prop to `TaskDrawer`                                                      |
| `app/workspace/[workspaceUrl]/tasks/[identifier]/page.tsx`         | **Create** — server component: auth + workspace check + task fetch + date serialization            |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` | **Create** — client component: sidebar + breadcrumb + two-column layout with properties + comments |

---

## Task 1: Extend Types

**Files:**

- Modify: `app/workspace/[workspaceUrl]/types.ts`

- [ ] **Step 1: Add `'task-detail'` to the `Page` union**

  In `types.ts` find:

  ```ts
  export type Page = 'my-tasks' | 'projects' | 'project-detail' | 'inbox'
  ```

  Replace with:

  ```ts
  export type Page =
    | 'my-tasks'
    | 'projects'
    | 'project-detail'
    | 'inbox'
    | 'task-detail'
  ```

- [ ] **Step 2: Add optional `children` to `TaskDetail`**

  In `types.ts`, the `TaskDetail` interface currently ends at `teamIdentifier: string`. Add the `children` field inside the interface before the closing `}`:

  ```ts
  children?: { id: string; title: string; number: number }[]
  ```

- [ ] **Step 3: Verify types compile**

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: no errors (or same pre-existing errors as before — confirm the count doesn't increase).

- [ ] **Step 4: Commit**

  ```bash
  git add app/workspace/\[workspaceUrl\]/types.ts
  git commit -m "feat: extend Page union with task-detail; add children to TaskDetail"
  ```

---

## Task 2: Refactor TaskDrawer

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`

The goal: remove the expand toggle (state + button + style), add `source` prop, add `reviewerId` to `onUpdate`, add open-page button using `SquareArrowOutUpRight`.

- [ ] **Step 1: Update imports**

  Replace the import line:

  ```ts
  import { X, ArrowLeftToLine, ArrowRightToLine } from 'lucide-react'
  ```

  With:

  ```ts
  import { X, SquareArrowOutUpRight } from 'lucide-react'
  import { useRouter, useParams } from 'next/navigation'
  ```

- [ ] **Step 2: Update `TaskDrawerProps` interface**

  Replace the entire `interface TaskDrawerProps { ... }` block with:

  ```ts
  interface TaskDrawerProps {
    initialTask: ApiTask | MyTask
    liveTask?: ApiTask
    cachedDescription?: string | null | undefined
    onClose: () => void
    members: WorkspaceMemberInfo[]
    projects: ApiProject[]
    tasks?: ApiTask[]
    source: 'my-tasks' | `project-${string}`
    onUpdate: (
      taskId: string,
      data: Partial<{
        title: string
        status: ApiStatus
        assigneeId: string | null
        reviewerId: string | null
        description: string | null
        projectId: string
        priority: ApiPriority
      }>
    ) => Promise<void>
    onDescriptionLoaded?: (taskId: string, description: string | null) => void
  }
  ```

- [ ] **Step 3: Update destructured params and remove `expanded` state**

  Replace the function signature and opening:

  ```ts
  export function TaskDrawer({
    initialTask,
    liveTask,
    cachedDescription,
    onClose,
    members,
    projects,
    tasks,
    onUpdate,
    onDescriptionLoaded,
  }: TaskDrawerProps) {
    const [expanded, setExpanded] = useState(false)
  ```

  With:

  ```ts
  export function TaskDrawer({
    initialTask,
    liveTask,
    cachedDescription,
    onClose,
    members,
    projects,
    tasks,
    source,
    onUpdate,
    onDescriptionLoaded,
  }: TaskDrawerProps) {
    const router = useRouter()
    const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  ```

- [ ] **Step 4: Replace `DrawerPrimitive.Content` style and the header button**

  The current `DrawerPrimitive.Content` has an `style` prop with the expanded animation. Remove that entirely:

  Replace:

  ```ts
          className='fixed right-0 top-0 bottom-0 z-50 bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col shadow-2xl outline-none w-full md:w-[380px]'
          style={
            expanded
              ? {
                  width: '100vw',
                  transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
                }
              : { transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)' }
          }
  ```

  With:

  ```ts
  className =
    'fixed right-0 top-0 bottom-0 z-50 bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col shadow-2xl outline-none w-full md:w-[380px]'
  ```

- [ ] **Step 5: Replace the expand button with the open-page button**

  Replace the entire expand `<Button>` block:

  ```tsx
  <Button
    variant='ghost'
    size='icon'
    onClick={() => setExpanded(e => !e)}
    className='hidden md:flex h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
    title={expanded ? 'Collapse' : 'Expand'}
  >
    {expanded ? <ArrowRightToLine size={14} /> : <ArrowLeftToLine size={14} />}
  </Button>
  ```

  With:

  ```tsx
  <Button
    variant='ghost'
    size='icon'
    onClick={() => {
      onClose()
      router.push(
        `/workspace/${workspaceUrl}/tasks/${initialTask.teamIdentifier}-${initialTask.number}?from=${source}`
      )
    }}
    className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
    title='Open full page'
  >
    <SquareArrowOutUpRight size={14} />
  </Button>
  ```

- [ ] **Step 6: Remove unused `useState` import**

  The `expanded` state is gone and `useState` is no longer used in `TaskDrawer`. Delete this line:

  ```ts
  import { useState } from 'react'
  ```

- [ ] **Step 7: Verify types compile**

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: TypeScript will now complain that `source` is required but not passed from `WorkspaceApp.tsx`. That's expected — we fix it in Task 3.

- [ ] **Step 8: Commit**

  ```bash
  git add app/workspace/\[workspaceUrl\]/components/TaskDrawer.tsx
  git commit -m "feat: replace expand toggle with open-page button in TaskDrawer"
  ```

---

## Task 3: Pass `source` from WorkspaceApp

**Files:**

- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`

- [ ] **Step 1: Derive `drawerSource` just before the `<TaskDrawer>` JSX**

  In `WorkspaceApp.tsx`, locate the `{selectedTask && (` block (around line 676). Just before the `<TaskDrawer` opening tag, add:

  ```ts
  const drawerSource: 'my-tasks' | `project-${string}` =
    currentPage === 'my-tasks'
      ? 'my-tasks'
      : selectedProject
        ? `project-${selectedProject.id}`
        : 'my-tasks'
  ```

- [ ] **Step 2: Pass `source` prop to `<TaskDrawer>`**

  In the `<TaskDrawer ... />` JSX, add `source={drawerSource}` after `onClose={handleCloseTask}`:

  ```tsx
  onClose = { handleCloseTask }
  source = { drawerSource }
  ```

- [ ] **Step 3: Verify types compile cleanly**

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: no new errors.

- [ ] **Step 4: Smoke-test in browser**

  Run `npm run dev`, open a workspace, open any task in the drawer. Verify:
  - The expand/collapse button is gone
  - A small `SquareArrowOutUpRight` icon button appears on the left of the drawer header
  - Clicking it closes the drawer and navigates to `/workspace/[slug]/tasks/[identifier]?from=...`
  - The URL is correct (currently shows Next.js 404 — page doesn't exist yet)

- [ ] **Step 5: Commit**

  ```bash
  git add app/workspace/\[workspaceUrl\]/WorkspaceApp.tsx
  git commit -m "feat: derive and pass source prop to TaskDrawer"
  ```

---

## Task 4: Create the Server Page

**Files:**

- Create: `app/workspace/[workspaceUrl]/tasks/[identifier]/page.tsx`

- [ ] **Step 1: Create the directory**

  ```bash
  mkdir -p /Users/chaoli/Desktop/lumo/lumo/app/workspace/\[workspaceUrl\]/tasks/\[identifier\]
  ```

- [ ] **Step 2: Write `page.tsx`**

  Create `app/workspace/[workspaceUrl]/tasks/[identifier]/page.tsx` with:

  ```tsx
  import { redirect, notFound } from 'next/navigation'
  import { auth } from '@clerk/nextjs/server'
  import { prisma } from '@/lib/db/prisma'
  import { TaskDetailPage } from '../../components/pages/TaskDetailPage'

  export default async function TaskIdentifierPage({
    params,
  }: {
    params: Promise<{ workspaceUrl: string; identifier: string }>
  }) {
    const { workspaceUrl, identifier } = await params
    const { userId } = await auth()
    if (!userId) redirect('/sign-in')

    // Verify workspace membership
    const workspace = await prisma.workspace.findFirst({
      where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
    })
    if (!workspace) redirect('/onboarding')

    // Parse and validate identifier (e.g. "ENG-42")
    const match = identifier.match(/^([A-Z]+)-(\d+)$/)
    if (!match) notFound()
    const [, teamIdentifier, numStr] = match
    const number = parseInt(numStr, 10)

    // Fetch task — workspaceId is the security boundary
    const rawTask = await prisma.task.findFirst({
      where: {
        number,
        team: { identifier: teamIdentifier, workspaceId: workspace.id },
      },
      include: {
        project: { select: { id: true, name: true, defaultReviewerId: true } },
        assignee: { select: { id: true, clerkId: true } },
        children: { select: { id: true, title: true, number: true } },
      },
    })
    if (!rawTask) notFound()

    // Serialize Dates — Next.js cannot pass Date objects from server to client components
    const task = {
      ...rawTask,
      updatedAt: rawTask.updatedAt.toISOString(),
    }

    return <TaskDetailPage initialTask={task} workspaceUrl={workspaceUrl} />
  }
  ```

- [ ] **Step 3: Verify types compile**

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: error about `TaskDetailPage` not existing yet — that's fine, it confirms the import path and prop types are being checked.

- [ ] **Step 4: Commit**

  ```bash
  git add "app/workspace/[workspaceUrl]/tasks/[identifier]/page.tsx"
  git commit -m "feat: add task detail server page with auth + task fetch"
  ```

---

## Task 5: Create the Client Page Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`

This is the largest task. It builds the two-column layout, manages sidebar state, and duplicates the properties + comments UI from `TaskDetailPanel`.

- [ ] **Step 1: Write the skeleton with sidebar + breadcrumb**

  Create `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`:

  ```tsx
  'use client'

  import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
  import { useRouter } from 'next/navigation'
  import { ChevronLeft, Send, Pencil, Trash2, Reply } from 'lucide-react'
  import { useUser } from '@clerk/nextjs'
  import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
  import { AppSidebar } from '../Sidebar'
  import { Button } from '@/components/ui/button'
  import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from '@/components/ui/alert-dialog'
  import { Spinner } from '@/components/ui/spinner'
  import {
    TaskDetail,
    ApiComment,
    ApiStatus,
    ApiPriority,
    WorkspaceMemberInfo,
    ApiProject,
    Page,
  } from '../../types'
  import { API, CACHE_KEY } from '../../constants'
  import { readCache, writeCache } from '../../cache'
  import { formatTimestamp } from '../../utils'
  import { DescriptionEditor } from '../DescriptionEditor'
  import {
    StatusSelect,
    AssigneeSelect,
    ReviewerSelect,
    ProjectSelect,
    PrioritySelect,
    FIELD_TRIGGER_CLS,
  } from '../TaskFieldSelects'

  interface TaskDetailPageProps {
    initialTask: TaskDetail & {
      children?: { id: string; title: string; number: number }[]
    }
    workspaceUrl: string
  }

  export function TaskDetailPage({
    initialTask,
    workspaceUrl,
  }: TaskDetailPageProps) {
    const router = useRouter()
    const { user } = useUser()

    // ── Sidebar state ──────────────────────────────────────────────────────────
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

    // ── Breadcrumb ─────────────────────────────────────────────────────────────
    const searchParams =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : null
    const from = searchParams?.get('from') ?? null
    const sourceLabel =
      from === 'my-tasks'
        ? 'My Tasks'
        : (initialTask.project?.name ?? 'Project')

    // ── Task state ─────────────────────────────────────────────────────────────
    const [task, setTask] = useState<TaskDetail>(initialTask)
    const [descriptionValue, setDescriptionValue] = useState<string | null>(
      initialTask.description ?? null
    )
    const [descriptionLoading, setDescriptionLoading] = useState(true)

    // ── Members + Projects ─────────────────────────────────────────────────────
    const [members, setMembers] = useState<WorkspaceMemberInfo[]>(
      () => readCache<WorkspaceMemberInfo[]>(CACHE_KEY.members) ?? []
    )
    const [projects, setProjects] = useState<ApiProject[]>(
      () => readCache<ApiProject[]>(CACHE_KEY.projects) ?? []
    )

    // ── Comments ───────────────────────────────────────────────────────────────
    const cachedComments = useMemo(
      () => readCache<ApiComment[]>(CACHE_KEY.comments(initialTask.id)) ?? null,
      [initialTask.id]
    )
    const [comments, setComments] = useState<ApiComment[]>(cachedComments ?? [])
    const [commentsLoading, setCommentsLoading] = useState(
      cachedComments === null
    )
    const [commentBody, setCommentBody] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const clearCommentRef = useRef<(() => void) | null>(null)
    const [editingCommentId, setEditingCommentId] = useState<string | null>(
      null
    )
    const [editCommentBody, setEditCommentBody] = useState<string | null>(null)
    const [savingComment, setSavingComment] = useState(false)
    const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
      null
    )
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
    const [highlightedCommentId, setHighlightedCommentId] = useState<
      string | null
    >(null)
    const [replyingToId, setReplyingToId] = useState<string | null>(null)
    const [replyingToComment, setReplyingToComment] = useState<{
      id: string
      authorName: string
      body: string
    } | null>(null)
    const [replyBody, setReplyBody] = useState<string | null>(null)
    const [submittingReply, setSubmittingReply] = useState(false)
    const clearReplyRef = useRef<(() => void) | null>(null)

    // ── Fetch live task + members + projects on mount ──────────────────────────
    useEffect(() => {
      Promise.all([
        fetch(API.tasks.byId(initialTask.id)).then(r => r.json()),
        fetch(API.workspaces.members).then(r =>
          r.ok ? r.json() : { members: [] }
        ),
        fetch(API.projects.list).then(r =>
          r.ok ? r.json() : { projects: [] }
        ),
        fetch(API.tasks.comments(initialTask.id)).then(r =>
          r.ok ? r.json() : { comments: [] }
        ),
      ])
        .then(([taskData, membersData, projectsData, commentsData]) => {
          if (taskData.task) {
            const t = taskData.task as TaskDetail
            setTask(prev => ({ ...prev, ...t }))
            setDescriptionValue(t.description ?? null)
          }
          const freshMembers =
            (membersData as { members: WorkspaceMemberInfo[] }).members ?? []
          setMembers(freshMembers)
          writeCache(CACHE_KEY.members, freshMembers)

          const freshProjects =
            (projectsData as { projects: ApiProject[] }).projects ?? []
          setProjects(freshProjects)
          writeCache(CACHE_KEY.projects, freshProjects)

          const freshComments =
            (commentsData as { comments: ApiComment[] }).comments ?? []
          setComments(freshComments)
          writeCache(CACHE_KEY.comments(initialTask.id), freshComments)
        })
        .catch(console.error)
        .finally(() => {
          setDescriptionLoading(false)
          setCommentsLoading(false)
        })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialTask.id])

    // ── Field mutations ────────────────────────────────────────────────────────
    const onUpdate = useCallback(
      async (
        taskId: string,
        data: Partial<{
          title: string
          status: ApiStatus
          assigneeId: string | null
          reviewerId: string | null
          description: string | null
          projectId: string
          priority: ApiPriority
        }>
      ) => {
        const snapshot = task
        // Optimistic update
        const localUpdate = { ...task, ...data }
        if (data.projectId) {
          const newProject = projects.find(p => p.id === data.projectId)
          if (newProject)
            localUpdate.project = { id: newProject.id, name: newProject.name }
        }
        setTask(localUpdate)
        try {
          await fetch(API.tasks.byId(taskId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          })
        } catch {
          setTask(snapshot)
        }
      },
      [task, projects]
    )

    const handlePatch = useCallback(
      (data: Parameters<typeof onUpdate>[1]) => onUpdate(task.id, data),
      [task.id, onUpdate]
    )

    const commitDescription = useCallback(
      (html: string | null) => {
        const next = html?.trim() || null
        if (next === (task.description ?? null)) return
        handlePatch({ description: next })
      },
      [task.description, handlePatch]
    )

    // ── Comment helpers (same logic as TaskDetailPanel) ────────────────────────
    const mapCommentTree = useCallback(
      (
        prev: ApiComment[],
        id: string,
        transform: (c: ApiComment) => ApiComment | null
      ): ApiComment[] =>
        prev.flatMap(c => {
          if (c.id === id) {
            const updated = transform(c)
            return updated ? [updated] : []
          }
          if (c.replies?.length) {
            const newReplies = c.replies.flatMap(r => {
              if (r.id === id) {
                const updated = transform(r)
                return updated ? [updated] : []
              }
              return [r]
            })
            return [{ ...c, replies: newReplies }]
          }
          return [c]
        }),
      []
    )

    const scrollToComment = useCallback((commentId: string) => {
      const el = document.getElementById(`comment-${commentId}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedCommentId(commentId)
      setTimeout(() => setHighlightedCommentId(null), 1500)
    }, [])

    const submitComment = useCallback(async () => {
      const body = commentBody?.trim()
      if (!body || submitting) return
      setSubmitting(true)
      const tempId = `optimistic-${Date.now()}`
      const optimistic: ApiComment = {
        id: tempId,
        taskId: task.id,
        authorId: user?.id ?? '',
        body,
        parentId: null,
        quotedCommentId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setComments(prev => [...prev, optimistic])
      setCommentBody(null)
      clearCommentRef.current?.()
      try {
        const res = await fetch(API.tasks.comments(task.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        })
        if (!res.ok) throw new Error()
        const { comment } = (await res.json()) as { comment: ApiComment }
        setComments(prev => {
          const next = prev.map(c => (c.id === tempId ? comment : c))
          writeCache(CACHE_KEY.comments(task.id), next)
          return next
        })
      } catch {
        setComments(prev => prev.filter(c => c.id !== tempId))
      } finally {
        setSubmitting(false)
      }
    }, [commentBody, submitting, task.id, user?.id])

    const submitReply = useCallback(
      async (parentId: string) => {
        const body = replyBody?.trim()
        if (!body || submittingReply) return
        setSubmittingReply(true)
        const quotedCommentId = replyingToComment?.id ?? null
        const tempId = `optimistic-reply-${Date.now()}`
        const optimistic: ApiComment = {
          id: tempId,
          taskId: task.id,
          authorId: user?.id ?? '',
          body,
          parentId,
          quotedCommentId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        setComments(prev => {
          const next = prev.map(c =>
            c.id === parentId
              ? { ...c, replies: [...(c.replies ?? []), optimistic] }
              : c
          )
          writeCache(CACHE_KEY.comments(task.id), next)
          return next
        })
        setReplyBody(null)
        clearReplyRef.current?.()
        setReplyingToId(null)
        setReplyingToComment(null)
        try {
          const res = await fetch(API.tasks.comments(task.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body, parentId, quotedCommentId }),
          })
          if (!res.ok) throw new Error()
          const { comment } = (await res.json()) as { comment: ApiComment }
          setComments(prev => {
            const next = mapCommentTree(prev, tempId, () => comment)
            writeCache(CACHE_KEY.comments(task.id), next)
            return next
          })
        } catch {
          setComments(prev => {
            const next = mapCommentTree(prev, tempId, () => null)
            writeCache(CACHE_KEY.comments(task.id), next)
            return next
          })
        } finally {
          setSubmittingReply(false)
        }
      },
      [
        replyBody,
        submittingReply,
        task.id,
        user?.id,
        mapCommentTree,
        replyingToComment?.id,
      ]
    )

    const saveEditComment = useCallback(
      async (commentId: string) => {
        const body = editCommentBody?.trim()
        if (!body || savingComment) return
        setSavingComment(true)
        try {
          const res = await fetch(API.tasks.comment(task.id, commentId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
          })
          if (!res.ok) throw new Error()
          const { comment } = (await res.json()) as { comment: ApiComment }
          setComments(prev => {
            const next = mapCommentTree(prev, commentId, () => comment)
            writeCache(CACHE_KEY.comments(task.id), next)
            return next
          })
          setEditingCommentId(null)
          setEditCommentBody(null)
        } catch {
          // keep editing state
        } finally {
          setSavingComment(false)
        }
      },
      [editCommentBody, savingComment, task.id, mapCommentTree]
    )

    const deleteComment = useCallback(
      async (commentId: string) => {
        setDeletingCommentId(commentId)
        try {
          const res = await fetch(API.tasks.comment(task.id, commentId), {
            method: 'DELETE',
          })
          if (!res.ok) throw new Error()
          setComments(prev => {
            const next = mapCommentTree(prev, commentId, () => null)
            writeCache(CACHE_KEY.comments(task.id), next)
            return next
          })
        } catch {
          // silently keep
        } finally {
          setDeletingCommentId(null)
          setConfirmDeleteId(null)
        }
      },
      [task.id, mapCommentTree]
    )

    const mentionableMembers = members.filter(m => m.clerkId !== user?.id)

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
      <SidebarProvider className='h-screen font-sans'>
        <AppSidebar
          currentPage={'task-detail' as Page}
          onNavigate={() => router.push(`/workspace/${workspaceUrl}`)}
          isDarkMode={isDarkMode}
          onToggleDarkMode={handleToggleDarkMode}
          unreadCount={0}
        />
        <SidebarInset className='overflow-hidden flex flex-col'>
          {/* Breadcrumb */}
          <div className='flex items-center gap-1.5 px-5 h-10 border-b border-zinc-100 dark:border-zinc-800 shrink-0 text-sm'>
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

          {/* Two-column body */}
          <div className='flex flex-1 overflow-hidden'>
            {/* Left column */}
            <div className='flex-1 overflow-y-auto px-8 py-6'>
              {/* Title */}
              <h1
                contentEditable
                suppressContentEditableWarning
                onBlur={e => {
                  const trimmed = e.currentTarget.textContent?.trim() ?? ''
                  if (!trimmed || trimmed === task.title) {
                    e.currentTarget.textContent = task.title
                    return
                  }
                  handlePatch({ title: trimmed })
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                  if (e.key === 'Escape') {
                    e.currentTarget.textContent = task.title
                    e.currentTarget.blur()
                  }
                }}
                className='text-2xl font-bold text-zinc-900 dark:text-zinc-100 outline-none cursor-text mb-6 leading-tight'
              >
                {task.title}
              </h1>

              {/* Description */}
              {descriptionLoading ? (
                <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
              ) : (
                <DescriptionEditor
                  value={descriptionValue}
                  onCommit={commitDescription}
                  members={mentionableMembers}
                />
              )}

              {/* Sub-tasks placeholder */}
              {(initialTask.children?.length ?? 0) > 0 && (
                <div className='mt-8'>
                  <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3'>
                    Sub-tasks
                  </p>
                  <div className='space-y-1'>
                    {initialTask.children!.map(child => (
                      <div
                        key={child.id}
                        className='text-sm text-zinc-600 dark:text-zinc-400 py-1.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      >
                        {child.teamIdentifier ?? task.teamIdentifier}-
                        {child.number} · {child.title}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right column */}
            <div className='w-72 shrink-0 border-l border-zinc-100 dark:border-zinc-800 overflow-y-auto px-5 py-6 bg-zinc-50/50 dark:bg-zinc-900/30'>
              {/* Properties */}
              <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3'>
                Properties
              </p>
              <div className='flex flex-col gap-1.5 mb-8 -ml-2'>
                <StatusSelect
                  value={task.status}
                  onChange={v => handlePatch({ status: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
                <AssigneeSelect
                  value={task.assigneeId ?? null}
                  onChange={v => handlePatch({ assigneeId: v })}
                  members={members}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
                <ReviewerSelect
                  value={task.reviewerId ?? null}
                  onChange={v => handlePatch({ reviewerId: v })}
                  members={members}
                  inheritedId={task.project?.defaultReviewerId ?? null}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
                <ProjectSelect
                  value={task.projectId}
                  onChange={v => handlePatch({ projectId: v })}
                  projects={projects}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
                <PrioritySelect
                  value={task.priority}
                  onChange={v => handlePatch({ priority: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              </div>

              {/* Comments */}
              <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-4'>
                Comments
              </p>

              {commentsLoading && comments.length === 0 ? (
                <div className='space-y-3'>
                  {[1, 2].map(i => (
                    <div key={i} className='flex gap-2.5'>
                      <div className='size-7 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse shrink-0' />
                      <div className='flex-1 space-y-1.5 pt-0.5'>
                        <div className='h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-1/3' />
                        <div className='h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-2/3' />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <CommentList
                  comments={comments}
                  members={members}
                  currentUserId={user?.id ?? ''}
                  taskId={task.id}
                  highlightedCommentId={highlightedCommentId}
                  editingCommentId={editingCommentId}
                  editCommentBody={editCommentBody}
                  savingComment={savingComment}
                  deletingCommentId={deletingCommentId}
                  confirmDeleteId={confirmDeleteId}
                  replyingToId={replyingToId}
                  replyingToComment={replyingToComment}
                  replyBody={replyBody}
                  submittingReply={submittingReply}
                  clearReplyRef={clearReplyRef}
                  onSetEditingCommentId={setEditingCommentId}
                  onSetEditCommentBody={setEditCommentBody}
                  onSaveEditComment={saveEditComment}
                  onSetConfirmDeleteId={setConfirmDeleteId}
                  onDeleteComment={deleteComment}
                  onSetReplyingToId={setReplyingToId}
                  onSetReplyingToComment={setReplyingToComment}
                  onSetReplyBody={setReplyBody}
                  onSubmitReply={submitReply}
                  onScrollToComment={scrollToComment}
                  mentionableMembers={mentionableMembers}
                  allTasks={[]}
                />
              )}

              {/* New comment input */}
              <div className='mt-4 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400 transition-all'>
                <div
                  className='px-3 pt-2 pb-1 text-sm'
                  onKeyDown={e => {
                    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform)
                    if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      submitComment()
                    }
                  }}
                >
                  <DescriptionEditor
                    key={0}
                    value={null}
                    onCommit={setCommentBody}
                    onChange={setCommentBody}
                    placeholder='Add a comment…'
                    members={mentionableMembers}
                  />
                </div>
                <div className='flex justify-end px-2 pb-2'>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-7 gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                    onClick={submitComment}
                    disabled={submitting}
                  >
                    <Send size={12} />
                    {submitting ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              </div>

              {/* Delete confirmation dialog */}
              <AlertDialog
                open={!!confirmDeleteId}
                onOpenChange={open => {
                  if (!open) setConfirmDeleteId(null)
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete comment?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      onClick={() =>
                        confirmDeleteId && deleteComment(confirmDeleteId)
                      }
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }
  ```

  > **Note on `CommentList`:** The comment rendering tree in `TaskDetailPanel` is very long (200+ lines of JSX). Rather than inlining it all above, extract it as a co-located helper component `CommentList` in the same file. See Step 2.

- [ ] **Step 2: Add `CommentList` helper component to the same file**

  Append this component definition **below** `TaskDetailPage` in the same file. It handles rendering the threaded comment list, matching the JSX pattern from `TaskDetailPanel` (lines 586–808). Key props mirror the state variables already defined in `TaskDetailPage`:

  ```tsx
  // ── CommentList ───────────────────────────────────────────────────────────────
  // Extracted to keep TaskDetailPage readable. Props mirror TaskDetailPanel's comment state.

  function CommentList({
    comments,
    members,
    currentUserId,
    taskId,
    highlightedCommentId,
    editingCommentId,
    editCommentBody,
    savingComment,
    deletingCommentId,
    confirmDeleteId,
    replyingToId,
    replyingToComment,
    replyBody,
    submittingReply,
    clearReplyRef,
    onSetEditingCommentId,
    onSetEditCommentBody,
    onSaveEditComment,
    onSetConfirmDeleteId,
    onDeleteComment,
    onSetReplyingToId,
    onSetReplyingToComment,
    onSetReplyBody,
    onSubmitReply,
    onScrollToComment,
    mentionableMembers,
    allTasks,
  }: {
    comments: ApiComment[]
    members: WorkspaceMemberInfo[]
    currentUserId: string
    taskId: string
    highlightedCommentId: string | null
    editingCommentId: string | null
    editCommentBody: string | null
    savingComment: boolean
    deletingCommentId: string | null
    confirmDeleteId: string | null
    replyingToId: string | null
    replyingToComment: { id: string; authorName: string; body: string } | null
    replyBody: string | null
    submittingReply: boolean
    clearReplyRef: React.MutableRefObject<(() => void) | null>
    onSetEditingCommentId: (id: string | null) => void
    onSetEditCommentBody: (body: string | null) => void
    onSaveEditComment: (id: string) => void
    onSetConfirmDeleteId: (id: string | null) => void
    onDeleteComment: (id: string) => void
    onSetReplyingToId: (id: string | null) => void
    onSetReplyingToComment: (
      c: { id: string; authorName: string; body: string } | null
    ) => void
    onSetReplyBody: (body: string | null) => void
    onSubmitReply: (parentId: string) => void
    onScrollToComment: (id: string) => void
    mentionableMembers: WorkspaceMemberInfo[]
    allTasks: import('../../types').ApiTask[]
  }) {
    // Copy the comments.map(...) JSX block from TaskDetailPanel lines 589–808 verbatim.
    // Replace all internal state references:
    //   members           → members (same name, passed as prop)
    //   user?.id          → currentUserId
    //   editingCommentId  → editingCommentId
    //   editCommentBody   → editCommentBody
    //   savingComment     → savingComment
    //   deletingCommentId → deletingCommentId
    //   confirmDeleteId   → confirmDeleteId
    //   replyingToId      → replyingToId
    //   replyingToComment → replyingToComment
    //   replyBody         → replyBody
    //   submittingReply   → submittingReply
    //   clearReplyRef     → clearReplyRef
    //   setEditingCommentId    → onSetEditingCommentId
    //   setEditCommentBody     → onSetEditCommentBody
    //   saveEditComment        → onSaveEditComment
    //   setConfirmDeleteId     → onSetConfirmDeleteId
    //   scrollToComment        → onScrollToComment
    //   setReplyingToId        → onSetReplyingToId
    //   setReplyingToComment   → onSetReplyingToComment
    //   setReplyBody           → onSetReplyBody
    //   submitReply            → onSubmitReply
    //   mentionableMembers     → mentionableMembers
    //   tasks (DescriptionEditor prop value) → allTasks
    //     i.e. write:  tasks={allTasks}   (prop NAME stays "tasks", VALUE comes from allTasks prop)
    return (
      <div className='space-y-5'>
        {/* ... paste the TaskDetailPanel comment JSX here ... */}
      </div>
    )
  }
  ```

  **Implementation note for the agent:** Open `TaskDetailPanel.tsx` and copy the JSX from the `{comments.map(comment => {` block (around line 589) through the closing `</div>` of the comments section (around line 808). Paste it into the `CommentList` function body and apply the variable renaming table above. The HTML structure and className strings remain unchanged.

- [ ] **Step 3: Fix the sub-task `teamIdentifier` reference**

  The children fetched from Prisma are `{ id, title, number }` — they don't have `teamIdentifier`. Update the sub-tasks render block in the left column:

  ```tsx
  {child.teamIdentifier ?? task.teamIdentifier}-{child.number} · {child.title}
  ```

  Should be:

  ```tsx
  {task.teamIdentifier}-{child.number} · {child.title}
  ```

- [ ] **Step 4: Fix the `DescriptionEditor` key for the comment input**

  The comment input `DescriptionEditor` uses a static `key={0}`. This should use a counter state so it can be cleared on submit. Add a `commentKey` state:

  ```ts
  const [commentKey, setCommentKey] = useState(0)
  ```

  Update `submitComment` to increment it after clearing:

  ```ts
  clearCommentRef.current?.()
  setCommentKey(k => k + 1)
  ```

  Update the JSX:

  ```tsx
  <DescriptionEditor key={commentKey} ... />
  ```

- [ ] **Step 5: Verify types compile**

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: no new errors. Fix any that appear — common issues: missing props on `ReviewerSelect` (needs `inheritedId`), wrong import paths.

- [ ] **Step 6: Smoke-test the full flow**
  1. Run `npm run dev`
  2. Open a workspace, find a task in the drawer
  3. Click the `SquareArrowOutUpRight` button — drawer closes, browser navigates to `/workspace/[slug]/tasks/[identifier]?from=...`
  4. Verify:
     - Sidebar renders (workspace name + nav items visible)
     - Breadcrumb shows correct source label ("My Tasks" or project name) with a back chevron
     - Left column shows task title (editable on click), description editor
     - Right column shows all 5 property fields with correct current values
     - Right column shows comments
  5. Edit the title — blur — verify network PATCH fires and title updates in place
  6. Change status — verify network PATCH fires and status updates
  7. Click back chevron — verify `router.back()` returns to the previous page
  8. Navigate directly to `/workspace/[slug]/tasks/INVALID` — verify Next.js 404 page
  9. Navigate directly to `/workspace/[slug]/tasks/ENG-99999` (valid format, non-existent task) — verify 404

- [ ] **Step 7: Commit**

  ```bash
  git add "app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx"
  git commit -m "feat: add TaskDetailPage client component with two-column layout"
  ```

---

## Task 6: Final Verification

- [ ] **Step 1: Full TypeScript check**

  ```bash
  cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit
  ```

  Expected: clean (or same pre-existing baseline as before this feature).

- [ ] **Step 2: Check no stray `expanded` references remain in TaskDrawer**

  ```bash
  grep -n "expanded\|ArrowLeftToLine\|ArrowRightToLine" app/workspace/\[workspaceUrl\]/components/TaskDrawer.tsx
  ```

  Expected: no output.

- [ ] **Step 3: Verify the `source` prop flows correctly**

  Open the drawer from My Tasks → click open-page → URL contains `?from=my-tasks`.
  Open the drawer from a project → click open-page → URL contains `?from=project-[id]`.

- [ ] **Step 4: Dark mode consistency**

  Enable dark mode in the main workspace → click open-page → task detail page should open in dark mode (reads from localStorage on mount).

- [ ] **Step 5: Commit final state**

  ```bash
  git add -A
  git commit -m "feat: task detail page complete — breadcrumb, two-column layout, sidebar"
  ```
