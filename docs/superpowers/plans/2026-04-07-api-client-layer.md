# API Client Layer — Frontend Fetch Decoupling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a typed API client layer (`lib/api-client/`) that replaces 81 direct `fetch()` calls across 31 frontend files with domain-specific client methods.

**Architecture:** Thin `apiFetch` base function handles JSON serialization, error checking, and typed responses. Per-domain client objects provide typed methods matching the existing `API` constant structure. Hooks and components import from clients instead of calling `fetch()` directly.

**Tech Stack:** TypeScript, Next.js (client-side)

---

## File Structure

### New files to create:

- `lib/api-client/base.ts` — `apiFetch<T>()` function + `ApiClientError` class
- `lib/api-client/tasks.ts` — Task + Comment client methods
- `lib/api-client/projects.ts` — Project client methods
- `lib/api-client/documents.ts` — Document client methods
- `lib/api-client/workspaces.ts` — Workspace + Member client methods
- `lib/api-client/notifications.ts` — Notification client methods
- `lib/api-client/index.ts` — Barrel exports
- `__tests__/lib/api-client/base.test.ts`

### Files to modify (hooks — primary fetch callers):

- `app/workspace/[workspaceUrl]/hooks/useMyTasks.ts`
- `app/workspace/[workspaceUrl]/hooks/useProjectTasks.ts`
- `app/workspace/[workspaceUrl]/hooks/useProjects.ts`
- `app/workspace/[workspaceUrl]/hooks/useDocuments.ts`
- `app/workspace/[workspaceUrl]/hooks/useDocumentTree.ts`
- `app/workspace/[workspaceUrl]/hooks/useMembers.ts`
- `app/workspace/[workspaceUrl]/hooks/useNotifications.ts`
- `app/workspace/[workspaceUrl]/hooks/useInvites.ts`
- `app/workspace/[workspaceUrl]/hooks/useGitHubIntegration.ts`
- `app/workspace/[workspaceUrl]/hooks/useSlackIntegration.ts`
- `app/workspace/[workspaceUrl]/hooks/usePrioritySuggestion.ts`
- `app/workspace/[workspaceUrl]/hooks/useSummary.ts`
- `app/workspace/[workspaceUrl]/hooks/useQuickDispatch.ts`
- `app/workspace/[workspaceUrl]/hooks/usePreferences.ts`
- `app/workspace/[workspaceUrl]/hooks/useDrafts.ts`
- `app/workspace/[workspaceUrl]/hooks/useApiKeys.ts`
- `app/workspace/[workspaceUrl]/hooks/useBoardDrag.ts`

### Files to modify (components with direct fetch calls):

- `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`
- `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`
- `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`
- `app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx`
- `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx`
- `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`
- `app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage.tsx`
- `app/workspace/[workspaceUrl]/components/pages/MembersPage.tsx`
- `app/workspace/[workspaceUrl]/components/pages/ProfilePage.tsx`
- `app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx`
- `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx`
- `app/workspace/[workspaceUrl]/components/document/ShareDialog.tsx`
- `app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx`
- `app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx`
- `app/workspace/[workspaceUrl]/components/CreateBranchDialog.tsx`
- `app/workspace/[workspaceUrl]/components/ProjectSlackDialog.tsx`
- `app/workspace/[workspaceUrl]/components/SubtasksSection.tsx`
- `app/workspace/[workspaceUrl]/components/AiDescriptionPrompt.tsx`
- `app/workspace/[workspaceUrl]/components/Sidebar.tsx`
- `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`

### Files to clean up:

- `app/workspace/[workspaceUrl]/utils.ts` — Remove `apiFetch()` function
- `utils/api.ts` — Delete (unused ApiClient class)

---

### Task 1: Create API Client Base + Tests

**Files:**

- Create: `lib/api-client/base.ts`
- Create: `__tests__/lib/api-client/base.test.ts`

The base module provides two things:

1. `ApiClientError` — error class with `status` and `code` fields, thrown on non-ok responses
2. `apiFetch<T>()` — generic fetch wrapper that handles JSON headers, body serialization, response parsing, and error throwing

```typescript
// lib/api-client/base.ts

/** Error thrown by API client on non-ok responses */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string = 'API_ERROR'
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface ApiFetchOptions {
  method?: HttpMethod
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

/**
 * Typed fetch wrapper for API calls.
 * - Auto-sets Content-Type: application/json when body is present
 * - Parses JSON response
 * - Throws ApiClientError on non-ok responses
 */
export async function apiFetch<T>(
  url: string,
  options?: ApiFetchOptions
): Promise<T> {
  const { method = 'GET', body, headers, signal } = options ?? {}

  const config: RequestInit = {
    method,
    signal,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }

  const res = await fetch(url, config)

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`
    let code = 'API_ERROR'
    try {
      const errorData = await res.json()
      if (errorData.error) message = errorData.error
      if (errorData.message) message = errorData.message
      if (errorData.code) code = errorData.code
    } catch {
      // Response body isn't JSON — use default message
    }
    throw new ApiClientError(message, res.status, code)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

/**
 * Fire-and-forget fetch — same as apiFetch but swallows errors silently.
 * Use for non-critical mutations where failure doesn't affect UI state.
 */
export async function apiFetchQuiet(
  url: string,
  options?: ApiFetchOptions
): Promise<void> {
  try {
    await apiFetch(url, options)
  } catch {
    // Silently ignore — caller handles rollback via other means
  }
}
```

Tests should cover:

- Successful GET returns parsed JSON
- Successful POST with body sets Content-Type and serializes
- Non-ok response throws ApiClientError with status and parsed error message
- Non-JSON error response throws ApiClientError with default message
- 204 response returns undefined
- Signal/abort is passed through
- apiFetchQuiet swallows errors

---

### Task 2: Create Per-Domain API Clients

**Files:**

- Create: `lib/api-client/tasks.ts`
- Create: `lib/api-client/projects.ts`
- Create: `lib/api-client/documents.ts`
- Create: `lib/api-client/workspaces.ts`
- Create: `lib/api-client/notifications.ts`
- Create: `lib/api-client/index.ts`

Each client imports `apiFetch` from `./base` and the `API` URL constants from `@/app/workspace/[workspaceUrl]/constants`. Methods map 1:1 to the API endpoints.

**tasks.ts:**

```typescript
import { apiFetch, apiFetchQuiet } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const tasksClient = {
  /** GET /api/tasks/me */
  listMine<T>() {
    return apiFetch<T>(API.tasks.me)
  },

  /** GET /api/tasks/:id */
  getById<T>(id: string) {
    return apiFetch<T>(API.tasks.byId(id))
  },

  /** PATCH /api/tasks/:id */
  update<T>(id: string, data: unknown) {
    return apiFetch<T>(API.tasks.byId(id), { method: 'PATCH', body: data })
  },

  /** DELETE /api/tasks/:id */
  delete(id: string) {
    return apiFetch<void>(API.tasks.byId(id), { method: 'DELETE' })
  },

  /** POST /api/tasks/:id/branch */
  createBranch<T>(id: string, data: unknown) {
    return apiFetch<T>(API.tasks.branch(id), { method: 'POST', body: data })
  },

  /** GET /api/tasks/:taskId/comments */
  listComments<T>(taskId: string) {
    return apiFetch<T>(API.tasks.comments(taskId))
  },

  /** POST /api/tasks/:taskId/comments */
  createComment<T>(taskId: string, data: unknown) {
    return apiFetch<T>(API.tasks.comments(taskId), {
      method: 'POST',
      body: data,
    })
  },

  /** PATCH /api/tasks/:taskId/comments/:commentId */
  updateComment<T>(taskId: string, commentId: string, data: unknown) {
    return apiFetch<T>(API.tasks.comment(taskId, commentId), {
      method: 'PATCH',
      body: data,
    })
  },

  /** DELETE /api/tasks/:taskId/comments/:commentId */
  deleteComment(taskId: string, commentId: string) {
    return apiFetch<void>(API.tasks.comment(taskId, commentId), {
      method: 'DELETE',
    })
  },

  /** POST /api/tasks/suggest-priority */
  suggestPriority<T>(data: unknown, signal?: AbortSignal) {
    return apiFetch<T>('/api/tasks/suggest-priority', {
      method: 'POST',
      body: data,
      signal,
    })
  },
}
```

**projects.ts:**

```typescript
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const projectsClient = {
  list<T>() {
    return apiFetch<T>(API.projects.list)
  },

  getById<T>(id: string) {
    return apiFetch<T>(API.projects.byId(id))
  },

  create<T>(data: unknown) {
    return apiFetch<T>(API.projects.list, { method: 'POST', body: data })
  },

  update<T>(id: string, data: unknown) {
    return apiFetch<T>(API.projects.byId(id), { method: 'PATCH', body: data })
  },

  delete(id: string) {
    return apiFetch<void>(API.projects.byId(id), { method: 'DELETE' })
  },

  listTasks<T>(projectId: string) {
    return apiFetch<T>(API.projects.tasks(projectId))
  },

  createTask<T>(projectId: string, data: unknown) {
    return apiFetch<T>(API.projects.tasks(projectId), {
      method: 'POST',
      body: data,
    })
  },
}
```

**documents.ts:**

```typescript
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const documentsClient = {
  list<T>(visibility?: string) {
    const url = visibility
      ? `${API.documents.list}?visibility=${visibility}`
      : API.documents.list
    return apiFetch<T>(url)
  },

  getById<T>(id: string) {
    return apiFetch<T>(API.documents.byId(id))
  },

  create<T>(data: unknown) {
    return apiFetch<T>(API.documents.list, { method: 'POST', body: data })
  },

  update<T>(id: string, data: unknown) {
    return apiFetch<T>(API.documents.byId(id), { method: 'PATCH', body: data })
  },

  delete(id: string) {
    return apiFetch<void>(API.documents.byId(id), { method: 'DELETE' })
  },

  move<T>(id: string, data: unknown) {
    return apiFetch<T>(API.documents.move(id), { method: 'PATCH', body: data })
  },

  getTree<T>() {
    return apiFetch<T>(API.documents.tree)
  },

  listShares<T>(id: string) {
    return apiFetch<T>(API.documents.shares(id))
  },

  createShare<T>(id: string, data: unknown) {
    return apiFetch<T>(API.documents.shares(id), { method: 'POST', body: data })
  },

  updateShare<T>(id: string, shareId: string, data: unknown) {
    return apiFetch<T>(API.documents.shareById(id, shareId), {
      method: 'PATCH',
      body: data,
    })
  },

  deleteShare(id: string, shareId: string) {
    return apiFetch<void>(API.documents.shareById(id, shareId), {
      method: 'DELETE',
    })
  },
}
```

**workspaces.ts:**

```typescript
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const workspacesClient = {
  create<T>(data: unknown) {
    return apiFetch<T>('/api/workspaces', { method: 'POST', body: data })
  },

  getMe<T>() {
    return apiFetch<T>(API.workspaces.me)
  },

  updateMe<T>(data: unknown) {
    return apiFetch<T>(API.workspaces.me, { method: 'PATCH', body: data })
  },

  uploadLogo<T>(formData: FormData) {
    return fetch(API.workspaces.logo, { method: 'POST', body: formData }).then(
      async res => {
        if (!res.ok) throw new Error('Upload failed')
        return res.json() as Promise<T>
      }
    )
  },

  listMembers<T>() {
    return apiFetch<T>(API.workspaces.members)
  },

  updateMember<T>(id: string, data: unknown) {
    return apiFetch<T>(API.workspaces.memberById(id), {
      method: 'PATCH',
      body: data,
    })
  },

  removeMember(id: string) {
    return apiFetch<void>(API.workspaces.memberById(id), { method: 'DELETE' })
  },

  leaveWorkspace() {
    return apiFetch<void>(API.workspaces.leaveWorkspace, { method: 'DELETE' })
  },
}
```

**notifications.ts:**

```typescript
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const notificationsClient = {
  list<T>() {
    return apiFetch<T>(API.notifications.list)
  },

  markAllRead() {
    return apiFetch<void>(API.notifications.markAllRead, { method: 'PATCH' })
  },

  markOne<T>(id: string, data?: unknown) {
    return apiFetch<T>(API.notifications.markOne(id), {
      method: 'PATCH',
      ...(data !== undefined && { body: data }),
    })
  },

  deleteOne(id: string) {
    return apiFetch<void>(API.notifications.markOne(id), { method: 'DELETE' })
  },

  respond<T>(id: string, data: unknown) {
    return apiFetch<T>(API.notifications.respond(id), {
      method: 'POST',
      body: data,
    })
  },
}
```

**index.ts:**

```typescript
export { apiFetch, apiFetchQuiet, ApiClientError } from './base'
export { tasksClient } from './tasks'
export { projectsClient } from './projects'
export { documentsClient } from './documents'
export { workspacesClient } from './workspaces'
export { notificationsClient } from './notifications'
```

---

### Task 3: Migrate Data-Fetching Hooks

**Files:**

- Modify: `app/workspace/[workspaceUrl]/hooks/useProjects.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useDocuments.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useMyTasks.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useProjectTasks.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useMembers.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useNotifications.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useDocumentTree.ts`

Replace direct `fetch(API.*)` calls with the corresponding client methods. The hooks keep their own state management, caching, and error handling — only the fetch call changes.

**Example migration (useProjects.ts):**

Before:

```typescript
import { API, CACHE_KEY } from '../constants'
// ...
const res = await fetch(API.projects.list)
if (!res.ok) throw new Error('Failed to load projects')
const data = (await res.json()) as { projects: ApiProject[] }
```

After:

```typescript
import { projectsClient } from '@/lib/api-client'
import { CACHE_KEY } from '../constants'
// ...
const data = await projectsClient.list<{ projects: ApiProject[] }>()
```

The `API` import can be removed from hooks that only used it for fetch calls. `CACHE_KEY` imports stay.

**For useNotifications.ts:** Also remove the `apiFetch` import from `../utils` since it's replaced by `notificationsClient`.

---

### Task 4: Migrate Integration Hooks

**Files:**

- Modify: `app/workspace/[workspaceUrl]/hooks/useInvites.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useGitHubIntegration.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useSlackIntegration.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/usePrioritySuggestion.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useSummary.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useQuickDispatch.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/usePreferences.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useDrafts.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useApiKeys.ts`
- Modify: `app/workspace/[workspaceUrl]/hooks/useBoardDrag.ts`

Same migration pattern as Task 3. For hooks that call endpoints not covered by per-domain clients (e.g., `/api/invites`, `/api/github`, `/api/slack`, `/api/drafts`, `/api/summaries`), use `apiFetch` directly from `@/lib/api-client` with the `API` URL constants. These domain clients can be added later when those domains get their own repository/service layers.

**Example (hook calling uncovered endpoint):**

Before:

```typescript
import { API } from '../constants'
const res = await fetch(API.invites.list)
if (!res.ok) throw new Error('Failed to load invites')
const data = (await res.json()) as { invites: Invite[] }
```

After:

```typescript
import { apiFetch } from '@/lib/api-client'
import { API } from '../constants'
const data = await apiFetch<{ invites: Invite[] }>(API.invites.list)
```

---

### Task 5: Migrate Component Fetch Calls

**Files:**

- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx` (7 fetch calls)
- Modify: `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` (8 fetch calls)
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx` (7 fetch calls)
- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx` (4 fetch calls)
- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx` (6 fetch calls)
- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` (3 fetch calls)
- Modify: `app/workspace/[workspaceUrl]/components/document/ShareDialog.tsx` (6 fetch calls)
- Modify: `app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage.tsx` (2 fetch calls)
- Modify: `app/workspace/[workspaceUrl]/components/pages/MembersPage.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/pages/ProfilePage.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/CreateBranchDialog.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/ProjectSlackDialog.tsx` (3 fetch calls)
- Modify: `app/workspace/[workspaceUrl]/components/SubtasksSection.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/AiDescriptionPrompt.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/Sidebar.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx` (1 fetch call)
- Modify: `app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx` (1 fetch call)

Same pattern: replace `fetch(API.x)` + manual `res.ok` check + `res.json()` with the appropriate client method or `apiFetch` for uncovered endpoints.

For fire-and-forget mutations (e.g., `fetch(API.documents.byId(id), { method: 'DELETE' })` with empty catch), use `apiFetchQuiet` or the client method with `.catch(() => {})`.

For components that check `res.ok` and use the response data inline, replace with try/catch around the client call.

---

### Task 6: Clean Up Legacy Utils

**Files:**

- Modify: `app/workspace/[workspaceUrl]/utils.ts` — Remove `apiFetch()` function
- Delete: `utils/api.ts` — Unused ApiClient class (never imported by any production code)

After Tasks 3-5, all `apiFetch` imports from `../utils` should be replaced. Verify no remaining imports before removing.

For `utils/api.ts`: verify it has zero imports across the codebase before deleting.

---

### Task 7: Full Verification

- Run `npm test` — all tests pass
- Run `npx tsc --noEmit` — no type errors
- Grep for remaining `fetch(API.` patterns — should be zero in frontend files
- Grep for `from '../utils'` importing `apiFetch` — should be zero
- Verify no `import` from `utils/api` — should be zero
