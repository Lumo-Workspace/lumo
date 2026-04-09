# Phase B: God Component Split

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split 4 components (>700 lines) to <500 lines each by extracting hooks and sub-components.

**Architecture:** Extract state management into custom hooks and render sections into sub-components. Parent becomes thin orchestrator. No new functionality — pure SRP refactoring.

**Tech Stack:** React, TypeScript

---

### Task 1: Split TaskDetailPage.tsx (1,409 → ~450 lines)

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useTaskDetailState.ts`
- Create: `app/workspace/[workspaceUrl]/hooks/useTaskDetailActions.ts`
- Create: `app/workspace/[workspaceUrl]/components/TaskDetailHeader.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`

- [ ] **Step 1: Read TaskDetailPage.tsx fully**

Understand all 9 useState, 4 useCallback, 6 useEffect, and their dependencies.

- [ ] **Step 2: Create useTaskDetailState hook**

Extract these useState declarations and their initialization logic:

```typescript
// hooks/useTaskDetailState.ts
'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import type { TaskDetail, WorkspaceMemberInfo, ApiProject } from '../types'
// ... read exact types from the file

interface UseTaskDetailStateOptions {
  initialTask: TaskDetail
  sourceProp?: string
}

export function useTaskDetailState({
  initialTask,
  sourceProp,
}: UseTaskDetailStateOptions) {
  // Breadcrumb source (from sessionStorage)
  const [from, setFrom] = useState<string | null>(null)

  // Main task state
  const [task, setTask] = useState<TaskDetail>(/* ... init from cache ... */)

  // Branch copy feedback
  const [copiedBranchId, setCopiedBranchId] = useState<string | null>(null)

  // Window origin for URL construction
  const [origin, setOrigin] = useState('')

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Branch creation dialog
  const [createBranchOpen, setCreateBranchOpen] = useState(false)

  // Cached data
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([])
  const [agentActors, setAgentActors] = useState</* type from file */ []>([])
  const [projects, setProjects] = useState<ApiProject[]>([])

  // useEffect: breadcrumb source recovery from sessionStorage
  useEffect(() => {
    /* ... copy from lines ~112 ... */
  }, [sourceProp])

  // useEffect: window origin detection
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  // useEffect: cache hydration (members, agents, projects)
  useEffect(() => {
    /* ... copy from lines ~165 ... */
  }, [])

  return {
    from,
    setFrom,
    task,
    setTask,
    copiedBranchId,
    setCopiedBranchId,
    origin,
    deleteOpen,
    setDeleteOpen,
    createBranchOpen,
    setCreateBranchOpen,
    members,
    setMembers,
    agentActors,
    setAgentActors,
    projects,
    setProjects,
  }
}
```

Read the actual file to get exact initialization logic, cache keys, and types.

- [ ] **Step 3: Create useTaskDetailActions hook**

Extract the 4 useCallback functions:

```typescript
// hooks/useTaskDetailActions.ts
'use client'

import { useCallback } from 'react'
import type { TaskDetail } from '../types'

interface UseTaskDetailActionsOptions {
  task: TaskDetail
  setTask: React.Dispatch<React.SetStateAction<TaskDetail>>
  setCopiedBranchId: React.Dispatch<React.SetStateAction<string | null>>
  origin: string
  handlePatch: (data: Record<string, unknown>) => Promise<void>
}

export function useTaskDetailActions({
  task,
  setTask,
  setCopiedBranchId,
  origin,
  handlePatch,
}: UseTaskDetailActionsOptions) {
  const handleCopyBranch = useCallback(/* ... copy from file ... */)
  const handleCopyTaskLink = useCallback(/* ... copy from file ... */)
  const handleDeleteTask = useCallback(/* ... copy from file ... */)
  const commitDescription = useCallback(/* ... copy from file ... */)
  const commitSpec = useCallback(/* ... copy from file ... */)

  return {
    handleCopyBranch,
    handleCopyTaskLink,
    handleDeleteTask,
    commitDescription,
    commitSpec,
  }
}
```

- [ ] **Step 4: Create TaskDetailHeader sub-component**

Extract the breadcrumb + action toolbar (copy link, copy branch, delete button) from the JSX:

```typescript
// components/TaskDetailHeader.tsx
'use client'

interface TaskDetailHeaderProps {
  task: TaskDetail
  from: string | null
  origin: string
  copiedBranchId: string | null
  onCopyBranch: (id: string, name: string) => void
  onCopyTaskLink: () => void
  onDeleteOpen: () => void
  onBack: () => void
}

export function TaskDetailHeader({ ... }: TaskDetailHeaderProps) {
  // Render breadcrumb + action buttons
  // Copy exact JSX from TaskDetailPage lines ~310-420
}
```

- [ ] **Step 5: Refactor TaskDetailPage to use extracted hooks + component**

Replace inline state/callbacks/JSX with:

```typescript
const state = useTaskDetailState({ initialTask, sourceProp })
const actions = useTaskDetailActions({ task: state.task, ... })
// In JSX:
<TaskDetailHeader task={state.task} from={state.from} ... />
```

- [ ] **Step 6: Type check + tests**

Run: `npx tsc --noEmit && npm test`
Expected: zero errors, all tests pass

- [ ] **Step 7: Verify line count**

Run: `wc -l app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`
Expected: <500 lines

- [ ] **Step 8: Commit**

```bash
git commit -m "refactor: split TaskDetailPage into hooks + header component [LUM-0]"
```

---

### Task 2: Split TaskDetailPanel.tsx (1,312 → ~450 lines)

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useTaskSync.ts`
- Create: `app/workspace/[workspaceUrl]/components/CommentSection.tsx`
- Create: `app/workspace/[workspaceUrl]/components/TaskFieldsSection.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

- [ ] **Step 1: Read TaskDetailPanel.tsx fully**

Note: already uses useTaskComments, useTaskMutation, useTaskDescription hooks. Further extraction targets: liveTask sync logic, comment section JSX, field editing JSX.

- [ ] **Step 2: Create useTaskSync hook**

Extract the liveTask synchronization useEffect and Pusher event handler:

```typescript
// hooks/useTaskSync.ts
'use client'

import { useEffect } from 'react'
import { usePusherEvent } from './usePusher'
import type { TaskDetail } from '../types'

interface UseTaskSyncOptions {
  taskId: string
  liveTask?: Record<string, unknown>
  setTask: React.Dispatch<React.SetStateAction<TaskDetail>>
}

export function useTaskSync({ taskId, liveTask, setTask }: UseTaskSyncOptions) {
  // useEffect: sync liveTask external updates
  useEffect(() => {
    /* ... copy from lines ~247-272 ... */
  }, [liveTask])

  // Pusher real-time task updates
  usePusherEvent(/* ... copy from lines ~313-333 ... */)
}
```

- [ ] **Step 3: Create CommentSection sub-component**

Extract the CommentEditor (already exists as internal function) plus the comment list rendering from the JSX. This includes the comment form, reply handling, and the threaded comment tree display.

- [ ] **Step 4: Create TaskFieldsSection sub-component**

Extract the field selects area (status, priority, assignee, reviewer, project, due date) into a self-contained component that receives the task + handlePatch callback.

- [ ] **Step 5: Refactor TaskDetailPanel to use extracted pieces**

- [ ] **Step 6: Type check + tests + verify <500 lines**

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor: split TaskDetailPanel into sync hook + sections [LUM-0]"
```

---

### Task 3: Split InboxPage.tsx (847 → ~400 lines)

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useResizablePanel.ts`
- Create: `app/workspace/[workspaceUrl]/components/NotificationDetailPanel.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx`

- [ ] **Step 1: Read InboxPage.tsx fully**

Identify the resizable panel logic (lines ~503-545) and the right detail panel JSX.

- [ ] **Step 2: Create useResizablePanel hook**

Extract the divider drag logic:

```typescript
// hooks/useResizablePanel.ts
'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

interface UseResizablePanelOptions {
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
}

export function useResizablePanel({
  defaultWidth = 384,
  minWidth = 280,
  maxWidth = 600,
}: UseResizablePanelOptions = {}) {
  const [leftWidth, setLeftWidth] = useState(defaultWidth)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true
      dragStartX.current = e.clientX
      dragStartWidth.current = leftWidth
    },
    [leftWidth]
  )

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientX - dragStartX.current
      const newWidth = Math.max(
        minWidth,
        Math.min(maxWidth, dragStartWidth.current + delta)
      )
      setLeftWidth(newWidth)
    }
    const onMouseUp = () => {
      isDragging.current = false
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [minWidth, maxWidth])

  return { leftWidth, handleDividerMouseDown }
}
```

Read the actual file to get exact drag logic — the above is a template, match the real implementation.

- [ ] **Step 3: Create NotificationDetailPanel sub-component**

Extract the right-side detail panel that shows when a notification is selected. This includes the AgentClarifyWidget, AgentVerifyWidget, AgentAuthorizeWidget, and task detail display. These internal sub-components move with it.

- [ ] **Step 4: Refactor InboxPage to use extracted pieces**

- [ ] **Step 5: Type check + tests + verify <500 lines**

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: split InboxPage into resizable panel hook + detail panel [LUM-0]"
```

---

### Task 4: Split ProjectDetailPage.tsx (742 → ~400 lines)

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useProjectViewState.ts`
- Create: `app/workspace/[workspaceUrl]/components/ProjectHeader.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx`

- [ ] **Step 1: Read ProjectDetailPage.tsx fully**

Identify the 9 useState declarations and repo management callbacks.

- [ ] **Step 2: Create useProjectViewState hook**

Extract view state management:

```typescript
// hooks/useProjectViewState.ts
'use client'

import { useState, useCallback, useEffect } from 'react'

export function useProjectViewState(workspaceUrl: string) {
  const [tab, setTab] = useState<'overview' | 'tasks' | 'summary'>('tasks')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('board')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [repositories, setRepositories] = useState</* type */ []>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [availableRepos, setAvailableRepos] = useState</* type */ []>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)
  const [addingRepo, setAddingRepo] = useState<string | null>(null)

  // useEffect: fetch available GitHub repos when picker opens
  useEffect(() => {
    /* ... copy from lines ~202 ... */
  }, [pickerOpen, workspaceUrl])

  // Callbacks: handleAddRepo, handleSetDefault, handleRemoveRepo
  const handleAddRepo = useCallback(/* ... */)
  const handleSetDefault = useCallback(/* ... */)
  const handleRemoveRepo = useCallback(/* ... */)

  return {
    tab,
    setTab,
    viewMode,
    setViewMode,
    deleteOpen,
    setDeleteOpen,
    repositories,
    setRepositories,
    pickerOpen,
    setPickerOpen,
    availableRepos,
    reposLoading,
    githubConnected,
    addingRepo,
    handleAddRepo,
    handleSetDefault,
    handleRemoveRepo,
  }
}
```

- [ ] **Step 3: Create ProjectHeader sub-component**

Extract breadcrumb, project name, repo controls, settings button area.

- [ ] **Step 4: Refactor ProjectDetailPage to use extracted pieces**

- [ ] **Step 5: Type check + tests + verify <500 lines**

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: split ProjectDetailPage into view state hook + header [LUM-0]"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 2: Tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 3: Verify line counts**

```bash
wc -l app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx
wc -l app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx
wc -l app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx
wc -l app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx
```

Expected: all <500 lines
