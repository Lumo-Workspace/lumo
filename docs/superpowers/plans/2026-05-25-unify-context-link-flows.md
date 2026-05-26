# Unified Task Context Link Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the four task-context-link UIs (PR / Weblink / Slack / Doc). PR stays as the reference. Weblink and Slack switch from modal dialog to Radix Popover; Weblink drops the Note field. Doc gets a brand-new popover attach entry that reuses the existing `documentService.addExplicitMention` semantics.

**Architecture:** Frontend swaps two dialogs to popovers and adds a third; backend adds task-side adapter endpoints (`/api/tasks/[id]/documents[/[documentId]]`) that delegate into existing `documentService` mention helpers. `TaskWebLink.note` column is kept; no Prisma migration.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma + Neon, Radix Popover (via `@/components/ui/popover`), TanStack Query, Jest + Testing Library, react-intl.

**Spec:** `docs/superpowers/specs/2026-05-25-unify-context-link-flows-design.md`

**Branch:** `lumo/LUM-93-unify-context-link-flows`

---

## Pre-flight (read once at the start)

Files the implementer should skim before Task 1 to anchor patterns:

- `app/workspace/[workspaceUrl]/components/LinkPrPopover.tsx` — the popover pattern to mimic
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/PullRequestsSection.tsx` — how `addSlot` is wired
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkAddDialog.tsx` and `AddSlackContextDialog.tsx` — current dialogs (to be deleted in Task 8)
- `lib/services/document.service.ts:529–612` — `addExplicitMention` / `removeExplicitMention` signatures
- `app/api/documents/route.ts:11–22` — existing `search` query param

---

## Task 1: Drop `note` from weblink validation, service, and api-client

**Files:**

- Modify: `lib/validation/task-web-link.ts:3-17`
- Modify: `lib/services/task-web-link.service.ts:43-78`
- Modify: `lib/api-client/task-web-links.ts:9-16`
- Modify: `app/api/tasks/[id]/web-links/route.ts:46-87`
- Test: `__tests__/lib/services/task-web-link.service.test.ts` (existing — update assertions)
- Test: `__tests__/app/api/tasks/[id]/web-links/route.test.ts` (existing — update assertions)

- [ ] **Step 1.1: Read current code**

Run:

```bash
cat lib/validation/task-web-link.ts lib/services/task-web-link.service.ts lib/api-client/task-web-links.ts
```

Confirm `note: z.string().max(500).optional()` is the only field besides `url` and that the service currently writes `input.note ?? null`. If the shape differs, adjust the steps below to match.

- [ ] **Step 1.2: Write failing test for schema rejection of unknown field**

Edit `__tests__/lib/validation/task-web-link.test.ts` (create file if missing):

```ts
import { createWebLinkBodySchema } from '@/lib/validation/task-web-link'

describe('createWebLinkBodySchema', () => {
  it('accepts a bare url', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'https://example.com',
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown `note` field', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'https://example.com',
      note: 'should not be accepted',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-http/https urls', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'ftp://example.com',
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 1.3: Run test to verify failure**

Run: `npm test -- __tests__/lib/validation/task-web-link.test.ts`
Expected: the "rejects unknown `note` field" case FAILS (schema currently accepts `note`).

- [ ] **Step 1.4: Update schema to strip `note`**

Replace the schema body in `lib/validation/task-web-link.ts`:

```ts
import { z } from 'zod'

export const createWebLinkBodySchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .refine(u => {
        try {
          const p = new URL(u).protocol
          return p === 'http:' || p === 'https:'
        } catch {
          return false
        }
      }, 'Only http/https URLs are supported'),
  })
  .strict()

export type CreateWebLinkBody = z.infer<typeof createWebLinkBodySchema>
```

(`.strict()` makes the schema reject unknown keys — required for the test above.)

- [ ] **Step 1.5: Update service to no longer reference `input.note`**

In `lib/services/task-web-link.service.ts:43-78` change the `addWebLink` input type to `{ taskId: string; url: string; memberId: string; workspaceId: string }` (no `note`), and remove the `note: input.note ?? null` line from the repository payload — replace with `note: null`.

Concretely, find this block:

```ts
note: input.note ?? null,
```

and replace with:

```ts
note: null,
```

Also remove `note?: string` from the input interface at the top of the file.

- [ ] **Step 1.6: Update api-client**

Replace the `add` function body in `lib/api-client/task-web-links.ts:9-16`:

```ts
add(taskId: string, payload: { url: string }) {
  return apiFetch<{ webLink: TaskWebLinkResource }>(
    `/api/tasks/${taskId}/web-links`,
    { method: 'POST', body: JSON.stringify(payload) }
  )
},
```

- [ ] **Step 1.7: Update the route handler if it parses `note` explicitly**

If `app/api/tasks/[id]/web-links/route.ts` references `body.note`, drop those references. Many routes simply do `const body = createWebLinkBodySchema.parse(...)` and pass `body` through — those need no change.

- [ ] **Step 1.8: Update existing service / route tests**

In `__tests__/lib/services/task-web-link.service.test.ts` remove any test case that asserts `note` flows through. In `__tests__/app/api/tasks/[id]/web-links/route.test.ts` add a test that POST with `{ url, note }` returns 400 (because schema is now strict).

Example for the route test:

```ts
it('rejects unknown note field', async () => {
  const res = await POST(
    new Request('http://x/api/tasks/abc/web-links', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com', note: 'nope' }),
    }),
    { params: Promise.resolve({ id: 'abc' }) }
  )
  expect(res.status).toBe(400)
})
```

- [ ] **Step 1.9: Run all weblink tests**

Run:

```bash
npm test -- task-web-link
```

Expected: all green.

- [ ] **Step 1.10: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 1.11: Commit**

```bash
git add lib/validation/task-web-link.ts lib/services/task-web-link.service.ts lib/api-client/task-web-links.ts app/api/tasks/\[id\]/web-links/route.ts __tests__/lib/validation/task-web-link.test.ts __tests__/lib/services/task-web-link.service.test.ts __tests__/app/api/tasks/\[id\]/web-links/route.test.ts
git commit -m "refactor: drop note field from weblink attach payload [LUM-93]"
```

---

## Task 2: Confirm / wire `search` filter through documents repository

**Files:**

- Read: `app/api/documents/route.ts:11-22`
- Read: `lib/repositories/document.repository.ts` (`findByWorkspace` filter handling)
- Modify: `lib/repositories/document.repository.ts` (only if `search` doesn't already title-filter)
- Test: `__tests__/lib/repositories/document.repository.test.ts` (extend if modified)

- [ ] **Step 2.1: Check if `search` already filters by title**

Run:

```bash
grep -n "search" lib/repositories/document.repository.ts
```

If `search` is already passed into a `where: { title: { contains: search, mode: 'insensitive' } }` clause, **skip the rest of this task and commit nothing**. Note in the PR description that filter was already present.

- [ ] **Step 2.2: If not, write failing test**

In `__tests__/lib/repositories/document.repository.test.ts` add:

```ts
it('filters by title with `search` param (case-insensitive)', async () => {
  // seed: docs with titles "Roadmap Q3", "API design", "roadmap-overview"
  const result = await documentRepository.findByWorkspace(
    workspaceId,
    memberId,
    {
      search: 'roadmap',
    }
  )
  expect(result.map(d => d.title).sort()).toEqual([
    'Roadmap Q3',
    'roadmap-overview',
  ])
})
```

Run: `npm test -- document.repository`
Expected: FAIL (filter not wired).

- [ ] **Step 2.3: Wire the filter**

In `lib/repositories/document.repository.ts` `findByWorkspace`, locate the `where` clause and add:

```ts
...(filters?.search
  ? { title: { contains: filters.search, mode: 'insensitive' as const } }
  : {}),
```

- [ ] **Step 2.4: Run test**

Run: `npm test -- document.repository`
Expected: PASS.

- [ ] **Step 2.5: Commit (only if filter was added)**

```bash
git add lib/repositories/document.repository.ts __tests__/lib/repositories/document.repository.test.ts
git commit -m "feat: filter documents by title via search param [LUM-93]"
```

---

## Task 3: Add task-side doc attach endpoint

**Files:**

- Create: `app/api/tasks/[id]/documents/route.ts` (extend existing — currently GET-only)
- Create: `lib/validation/task-document.ts`
- Create: `__tests__/app/api/tasks/[id]/documents/route.test.ts`

- [ ] **Step 3.1: Read existing GET handler**

Read `app/api/tasks/[id]/documents/route.ts:22-59` to see how auth + member resolution is done. Reuse the same auth shape in the new POST.

- [ ] **Step 3.2: Create validation schema**

Create `lib/validation/task-document.ts`:

```ts
import { z } from 'zod'

export const attachTaskDocumentBodySchema = z
  .object({
    identifier: z.string().min(1).optional(),
    documentId: z.string().cuid().optional(),
  })
  .strict()
  .refine(v => Boolean(v.identifier) !== Boolean(v.documentId), {
    message: 'Provide exactly one of identifier or documentId',
  })

export type AttachTaskDocumentBody = z.infer<
  typeof attachTaskDocumentBodySchema
>
```

- [ ] **Step 3.3: Write failing route test**

Create `__tests__/app/api/tasks/[id]/documents/route.test.ts` (mirror the structure of an existing tasks route test — e.g. `__tests__/app/api/tasks/[id]/web-links/route.test.ts`):

```ts
import { POST } from '@/app/api/tasks/[id]/documents/route'

jest.mock('@/lib/auth/getMember', () => ({
  getMember: jest.fn().mockResolvedValue({
    id: 'mem_1',
    workspace: { id: 'ws_1' },
  }),
}))

const mockAddExplicit = jest.fn()
jest.mock('@/lib/services/document.service', () => ({
  documentService: {
    addExplicitMention: (...a: unknown[]) => mockAddExplicit(...a),
  },
}))

const mockResolveTask = jest.fn()
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: (...a: unknown[]) => mockResolveTask(...a) },
}))

describe('POST /api/tasks/[id]/documents', () => {
  beforeEach(() => {
    mockAddExplicit.mockReset()
    mockResolveTask.mockReset()
    mockResolveTask.mockResolvedValue({
      id: 'task_1',
      identifier: 'LUM-42',
      workspaceId: 'ws_1',
    })
  })

  it('attaches by documentId', async () => {
    mockAddExplicit.mockResolvedValue({
      taskId: 'task_1',
      taskIdentifier: 'LUM-42',
      source: 'EXPLICIT',
      alreadyBound: false,
      upgradedFromContent: false,
    })
    const res = await POST(
      new Request('http://x/api/tasks/task_1/documents', {
        method: 'POST',
        body: JSON.stringify({ documentId: 'cmd_abc' }),
      }),
      { params: Promise.resolve({ id: 'task_1' }) }
    )
    expect(res.status).toBe(200)
    expect(mockAddExplicit).toHaveBeenCalledWith(
      'cmd_abc',
      'LUM-42',
      'ws_1',
      'mem_1'
    )
  })

  it('rejects payload with both identifier and documentId', async () => {
    const res = await POST(
      new Request('http://x/api/tasks/task_1/documents', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'x', documentId: 'cmd_abc' }),
      }),
      { params: Promise.resolve({ id: 'task_1' }) }
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when task missing', async () => {
    mockResolveTask.mockResolvedValue(null)
    const res = await POST(
      new Request('http://x/api/tasks/missing/documents', {
        method: 'POST',
        body: JSON.stringify({ documentId: 'cmd_abc' }),
      }),
      { params: Promise.resolve({ id: 'missing' }) }
    )
    expect(res.status).toBe(404)
  })
})
```

Run: `npm test -- tasks/\\[id\\]/documents/route`
Expected: FAIL (POST handler not exported yet).

- [ ] **Step 3.4: Add POST handler to existing route file**

Append to `app/api/tasks/[id]/documents/route.ts` (do not touch the existing GET):

```ts
import { attachTaskDocumentBodySchema } from '@/lib/validation/task-document'
import { documentService } from '@/lib/services/document.service'
import { taskRepository } from '@/lib/repositories/task.repository'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getMember()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: taskId } = await params
  const task = await taskRepository.findById(taskId)
  if (!task || task.workspaceId !== member.workspace.id) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = attachTaskDocumentBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  let documentId: string
  if (parsed.data.documentId) {
    documentId = parsed.data.documentId
  } else {
    documentId = await resolveDocumentIdentifier(
      parsed.data.identifier!,
      member.workspace.id,
      member.id
    )
  }

  try {
    const result = await documentService.addExplicitMention(
      documentId,
      task.identifier,
      member.workspace.id,
      member.id
    )
    return NextResponse.json({
      documentId,
      alreadyBound: result.alreadyBound,
      upgradedFromContent: result.upgradedFromContent,
    })
  } catch (err) {
    const e = err as { status?: number; message?: string }
    return NextResponse.json(
      { error: e.message ?? 'Failed to attach' },
      { status: e.status ?? 500 }
    )
  }
}

async function resolveDocumentIdentifier(
  raw: string,
  workspaceId: string,
  memberId: string
): Promise<string> {
  const trimmed = raw.trim()

  // Rule 1: URL containing /documents/<slug-N>
  if (trimmed.includes('/documents/')) {
    const m = trimmed.match(/\/documents\/([a-z0-9-]+-\d+)/i)
    if (m) {
      return await resolveBySlug(m[1], workspaceId, memberId)
    }
  }

  // Rule 2: cuid (cmd_…)
  if (/^cmd_[a-z0-9]+$/i.test(trimmed)) {
    return trimmed
  }

  // Rule 3: workspace slug-N
  if (/^[a-z0-9-]+-\d+$/i.test(trimmed)) {
    return await resolveBySlug(trimmed, workspaceId, memberId)
  }

  throw Object.assign(new Error(`Cannot resolve document: ${raw}`), {
    status: 404,
  })
}

async function resolveBySlug(
  slug: string,
  workspaceId: string,
  memberId: string
): Promise<string> {
  // Use documentRepository.findBySlug(...) — confirm exact signature when implementing.
  // If it doesn't exist, add a method that queries by (workspaceId, slug).
  const doc = await documentRepository.findBySlug(workspaceId, slug, memberId)
  if (!doc) {
    throw Object.assign(new Error(`Document not found: ${slug}`), {
      status: 404,
    })
  }
  return doc.id
}
```

If `documentRepository.findBySlug` does not exist, add it as the first step of this task — it should mirror `findWithPermission` but key on `(workspaceId, slug)` and apply the same `memberId` visibility filter.

- [ ] **Step 3.5: Run test**

Run: `npm test -- tasks/\\[id\\]/documents/route`
Expected: PASS.

- [ ] **Step 3.6: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3.7: Commit**

```bash
git add app/api/tasks/\[id\]/documents/route.ts lib/validation/task-document.ts __tests__/app/api/tasks/\[id\]/documents/route.test.ts lib/repositories/document.repository.ts
git commit -m "feat: add task-side doc attach endpoint [LUM-93]"
```

---

## Task 4: Add task-side doc detach endpoint

**Files:**

- Create: `app/api/tasks/[id]/documents/[documentId]/route.ts`
- Create: `__tests__/app/api/tasks/[id]/documents/[documentId]/route.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `__tests__/app/api/tasks/[id]/documents/[documentId]/route.test.ts`:

```ts
import { DELETE } from '@/app/api/tasks/[id]/documents/[documentId]/route'

jest.mock('@/lib/auth/getMember', () => ({
  getMember: jest.fn().mockResolvedValue({
    id: 'mem_1',
    workspace: { id: 'ws_1' },
  }),
}))

const mockRemove = jest.fn()
jest.mock('@/lib/services/document.service', () => ({
  documentService: {
    removeExplicitMention: (...a: unknown[]) => mockRemove(...a),
  },
}))

const mockTask = jest.fn()
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: (...a: unknown[]) => mockTask(...a) },
}))

describe('DELETE /api/tasks/[id]/documents/[documentId]', () => {
  beforeEach(() => {
    mockRemove.mockReset()
    mockTask.mockReset()
    mockTask.mockResolvedValue({
      id: 'task_1',
      identifier: 'LUM-42',
      workspaceId: 'ws_1',
    })
  })

  it('removes explicit mention', async () => {
    mockRemove.mockResolvedValue({
      removed: 1,
      refused: false,
      taskIdentifier: 'LUM-42',
    })
    const res = await DELETE(new Request('http://x'), {
      params: Promise.resolve({ id: 'task_1', documentId: 'cmd_abc' }),
    })
    expect(res.status).toBe(200)
    expect(mockRemove).toHaveBeenCalledWith(
      'cmd_abc',
      'LUM-42',
      'ws_1',
      'mem_1'
    )
  })

  it('returns 409 when mention is CONTENT-only', async () => {
    mockRemove.mockResolvedValue({
      removed: 0,
      refused: true,
      reason: 'Cannot unbind a content-derived mention',
      taskIdentifier: 'LUM-42',
    })
    const res = await DELETE(new Request('http://x'), {
      params: Promise.resolve({ id: 'task_1', documentId: 'cmd_abc' }),
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('CONTENT_MENTION_ONLY')
  })
})
```

Run: `npm test -- documents/\\[documentId\\]/route`
Expected: FAIL (file doesn't exist).

- [ ] **Step 4.2: Implement handler**

Create `app/api/tasks/[id]/documents/[documentId]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getMember } from '@/lib/auth/getMember'
import { taskRepository } from '@/lib/repositories/task.repository'
import { documentService } from '@/lib/services/document.service'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const member = await getMember()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: taskId, documentId } = await params
  const task = await taskRepository.findById(taskId)
  if (!task || task.workspaceId !== member.workspace.id) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  try {
    const result = await documentService.removeExplicitMention(
      documentId,
      task.identifier,
      member.workspace.id,
      member.id
    )
    if (result.refused) {
      return NextResponse.json(
        { error: result.reason, code: 'CONTENT_MENTION_ONLY' },
        { status: 409 }
      )
    }
    return NextResponse.json({ removed: result.removed })
  } catch (err) {
    const e = err as { status?: number; message?: string }
    return NextResponse.json(
      { error: e.message ?? 'Failed to detach' },
      { status: e.status ?? 500 }
    )
  }
}
```

- [ ] **Step 4.3: Run test**

Run: `npm test -- documents/\\[documentId\\]/route`
Expected: PASS.

- [ ] **Step 4.4: Commit**

```bash
git add app/api/tasks/\[id\]/documents/\[documentId\]/route.ts __tests__/app/api/tasks/\[id\]/documents/\[documentId\]/route.test.ts
git commit -m "feat: add task-side doc detach endpoint [LUM-93]"
```

---

## Task 5: Extend api-client for task-documents

**Files:**

- Modify: `lib/api-client/task-documents.ts`
- Modify: `lib/api-client/documents.ts` (or wherever `list` lives — confirm path)
- Test: `__tests__/lib/api-client/task-documents.test.ts` (create if needed)

- [ ] **Step 5.1: Read current api-client**

Run: `cat lib/api-client/task-documents.ts`. Note the existing `list(taskId)` shape; add new functions next to it.

- [ ] **Step 5.2: Add `attach`, `detach`, `search`**

Add to `lib/api-client/task-documents.ts`:

```ts
export const taskDocumentsClient = {
  list(taskId: string) {
    /* …existing… */
  },

  attach(
    taskId: string,
    payload: { identifier: string } | { documentId: string }
  ) {
    return apiFetch<{
      documentId: string
      alreadyBound: boolean
      upgradedFromContent: boolean
    }>(`/api/tasks/${taskId}/documents`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  detach(taskId: string, documentId: string) {
    return apiFetch<{ removed: number }>(
      `/api/tasks/${taskId}/documents/${documentId}`,
      { method: 'DELETE' }
    )
  },

  search(query: string, limit = 10) {
    const params = new URLSearchParams({ search: query, limit: String(limit) })
    return apiFetch<{
      documents: Array<{ id: string; title: string; emoji: string | null }>
    }>(`/api/documents?${params.toString()}`)
  },
}
```

- [ ] **Step 5.3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5.4: Commit**

```bash
git add lib/api-client/task-documents.ts
git commit -m "feat: api-client attach/detach/search for task documents [LUM-93]"
```

---

## Task 6: LinkWebLinkPopover (replaces WebLinkAddDialog)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/LinkWebLinkPopover.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/WebLinkSection.tsx`
- Delete: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkAddDialog.tsx`
- Test: `__tests__/app/workspace/components/LinkWebLinkPopover.test.tsx`

- [ ] **Step 6.1: Read LinkPrPopover for the pattern**

Re-skim `LinkPrPopover.tsx`. Mirror its overall shape: trigger button → Popover panel → input row → footer error.

- [ ] **Step 6.2: Write failing component test**

Create `__tests__/app/workspace/components/LinkWebLinkPopover.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import { LinkWebLinkPopover } from '@/app/workspace/[workspaceUrl]/components/LinkWebLinkPopover'

const renderWithIntl = (ui: React.ReactNode) =>
  render(
    <IntlProvider locale='en' messages={{}}>
      {ui}
    </IntlProvider>
  )

describe('LinkWebLinkPopover', () => {
  it('submits URL via Enter', async () => {
    const onAttach = jest.fn().mockResolvedValue(undefined)
    renderWithIntl(<LinkWebLinkPopover onAttach={onAttach} />)
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    const input = screen.getByPlaceholderText(/https:\/\//i)
    await userEvent.type(input, 'https://example.com{enter}')
    expect(onAttach).toHaveBeenCalledWith('https://example.com')
  })

  it('shows error on 422', async () => {
    const onAttach = jest
      .fn()
      .mockRejectedValue({ status: 422, message: 'bad url' })
    renderWithIntl(<LinkWebLinkPopover onAttach={onAttach} />)
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    const input = screen.getByPlaceholderText(/https:\/\//i)
    await userEvent.type(input, 'not-a-url{enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /bad url|invalid/i
    )
  })
})
```

Run: `npm test -- LinkWebLinkPopover`
Expected: FAIL (component doesn't exist).

- [ ] **Step 6.3: Implement the component**

Create `app/workspace/[workspaceUrl]/components/LinkWebLinkPopover.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SectionAddButton } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SectionAddButton'

export interface LinkWebLinkPopoverProps {
  onAttach: (url: string) => Promise<void>
}

export function LinkWebLinkPopover({ onAttach }: LinkWebLinkPopoverProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!url.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onAttach(url.trim())
      setUrl('')
      setOpen(false)
    } catch (err) {
      const e = err as { message?: string }
      setError(
        e.message ??
          intl.formatMessage({ id: 'task.contextLink.common.errors.network' })
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SectionAddButton />
      </PopoverTrigger>
      <PopoverContent className='w-80 p-3'>
        <input
          type='url'
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          disabled={submitting}
          placeholder={intl.formatMessage({
            id: 'task.contextLink.weblink.placeholder',
          })}
          className='w-full rounded border px-2 py-1 text-sm'
          autoFocus
        />
        {error && (
          <p role='alert' className='mt-2 text-xs text-red-600'>
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 6.4: Wire into WebLinkSection**

Modify `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/WebLinkSection.tsx`:

- Remove `dialogOpen` state and the `<WebLinkAddDialog ... />` render
- Pass `<LinkWebLinkPopover onAttach={handleAttach} />` to `addSlot`
- `handleAttach` calls `webLinksClient.add(taskId, { url })` and on success invalidates the section query

- [ ] **Step 6.5: Run test**

Run: `npm test -- LinkWebLinkPopover`
Expected: PASS.

- [ ] **Step 6.6: Delete the dialog file**

```bash
rm app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkAddDialog.tsx
```

Then `grep -r "WebLinkAddDialog" app components lib` — expected: no matches.

- [ ] **Step 6.7: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6.8: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/LinkWebLinkPopover.tsx app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/WebLinkSection.tsx __tests__/app/workspace/components/LinkWebLinkPopover.test.tsx
git rm app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkAddDialog.tsx
git commit -m "refactor: replace WebLinkAddDialog with LinkWebLinkPopover [LUM-93]"
```

---

## Task 7: LinkSlackPopover (replaces AddSlackContextDialog)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/LinkSlackPopover.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SlackContextSection.tsx`
- Delete: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AddSlackContextDialog.tsx`
- Test: `__tests__/app/workspace/components/LinkSlackPopover.test.tsx`

- [ ] **Step 7.1: Write failing test**

Create `__tests__/app/workspace/components/LinkSlackPopover.test.tsx`. Same pattern as the weblink test — submit a permalink via Enter, assert error on 422, assert "Slack not connected" 409 surfaces the right i18n key.

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import { LinkSlackPopover } from '@/app/workspace/[workspaceUrl]/components/LinkSlackPopover'

const renderWithIntl = (ui: React.ReactNode) =>
  render(
    <IntlProvider locale='en' messages={{}}>
      {ui}
    </IntlProvider>
  )

describe('LinkSlackPopover', () => {
  it('submits permalink via Enter when Slack is connected', async () => {
    const onAttach = jest.fn().mockResolvedValue(undefined)
    renderWithIntl(<LinkSlackPopover connected onAttach={onAttach} />)
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    const input = screen.getByPlaceholderText(/slack\.com/i)
    await userEvent.type(
      input,
      'https://example.slack.com/archives/C1/p1700000000{enter}'
    )
    expect(onAttach).toHaveBeenCalledWith(
      'https://example.slack.com/archives/C1/p1700000000'
    )
  })

  it('disables submit when Slack is not connected', async () => {
    const onAttach = jest.fn()
    renderWithIntl(<LinkSlackPopover connected={false} onAttach={onAttach} />)
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    expect(
      screen.getByRole('alert', { name: /workspaceNotConnected|connect/i })
    ).toBeInTheDocument()
  })
})
```

Run: `npm test -- LinkSlackPopover`
Expected: FAIL.

- [ ] **Step 7.2: Implement the component**

Create `app/workspace/[workspaceUrl]/components/LinkSlackPopover.tsx` — same shape as `LinkWebLinkPopover` but with a `connected: boolean` prop. When `!connected`, render a `role="alert"` block inside the popover ("Connect Slack to attach messages" — link to settings) and don't render the input.

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SectionAddButton } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SectionAddButton'

export interface LinkSlackPopoverProps {
  connected: boolean
  onAttach: (permalink: string) => Promise<void>
}

export function LinkSlackPopover({
  connected,
  onAttach,
}: LinkSlackPopoverProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [permalink, setPermalink] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!permalink.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onAttach(permalink.trim())
      setPermalink('')
      setOpen(false)
    } catch (err) {
      const e = err as { message?: string }
      setError(
        e.message ??
          intl.formatMessage({ id: 'task.contextLink.common.errors.network' })
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SectionAddButton />
      </PopoverTrigger>
      <PopoverContent className='w-80 p-3'>
        {!connected ? (
          <div role='alert' className='text-xs'>
            {intl.formatMessage({
              id: 'task.contextLink.slack.errors.workspaceNotConnected',
            })}{' '}
            <Link href='/settings/integrations/slack' className='underline'>
              {intl.formatMessage({
                id: 'task.contextLink.slack.connectCta',
              })}
            </Link>
          </div>
        ) : (
          <>
            <input
              type='url'
              value={permalink}
              onChange={e => setPermalink(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void submit()
                }
              }}
              disabled={submitting}
              placeholder={intl.formatMessage({
                id: 'task.contextLink.slack.placeholder',
              })}
              className='w-full rounded border px-2 py-1 text-sm'
              autoFocus
            />
            {error && (
              <p role='alert' className='mt-2 text-xs text-red-600'>
                {error}
              </p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 7.3: Wire into SlackContextSection**

In `SlackContextSection.tsx` replace the `handleAddClick → AddSlackContextDialog` plumbing with `<LinkSlackPopover connected={slackConnected} onAttach={handleAttach} />`. `handleAttach` calls `slackContextsClient.link(taskId, permalink)`.

- [ ] **Step 7.4: Run test**

Run: `npm test -- LinkSlackPopover`
Expected: PASS.

- [ ] **Step 7.5: Delete the dialog**

```bash
rm app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AddSlackContextDialog.tsx
```

`grep -r "AddSlackContextDialog" app components lib` — expected: no matches.

- [ ] **Step 7.6: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7.7: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/LinkSlackPopover.tsx app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SlackContextSection.tsx __tests__/app/workspace/components/LinkSlackPopover.test.tsx
git rm app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AddSlackContextDialog.tsx
git commit -m "refactor: replace AddSlackContextDialog with LinkSlackPopover [LUM-93]"
```

---

## Task 8: LinkDocPopover (new — mounted on DocumentsSection)

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/LinkDocPopover.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx`
- Test: `__tests__/app/workspace/components/LinkDocPopover.test.tsx`

- [ ] **Step 8.1: Write failing test**

Create `__tests__/app/workspace/components/LinkDocPopover.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import { LinkDocPopover } from '@/app/workspace/[workspaceUrl]/components/LinkDocPopover'

const renderWithIntl = (ui: React.ReactNode) =>
  render(
    <IntlProvider locale='en' messages={{}}>
      {ui}
    </IntlProvider>
  )

describe('LinkDocPopover', () => {
  it('attaches by documentId when user clicks a search result', async () => {
    const onSearch = jest
      .fn()
      .mockResolvedValue([{ id: 'cmd_a', title: 'Roadmap', emoji: null }])
    const onAttach = jest.fn().mockResolvedValue(undefined)
    renderWithIntl(<LinkDocPopover onSearch={onSearch} onAttach={onAttach} />)
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'road')
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('road'))
    await userEvent.click(await screen.findByText('Roadmap'))
    expect(onAttach).toHaveBeenCalledWith({ documentId: 'cmd_a' })
  })

  it('attaches by identifier on Enter when input looks like a slug-N', async () => {
    const onSearch = jest.fn().mockResolvedValue([])
    const onAttach = jest.fn().mockResolvedValue(undefined)
    renderWithIntl(<LinkDocPopover onSearch={onSearch} onAttach={onAttach} />)
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    await userEvent.type(
      screen.getByPlaceholderText(/search/i),
      'roadmap-42{enter}'
    )
    expect(onAttach).toHaveBeenCalledWith({ identifier: 'roadmap-42' })
  })

  it('attaches by identifier on Enter when input is a doc URL', async () => {
    const onSearch = jest.fn().mockResolvedValue([])
    const onAttach = jest.fn().mockResolvedValue(undefined)
    renderWithIntl(<LinkDocPopover onSearch={onSearch} onAttach={onAttach} />)
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    await userEvent.type(
      screen.getByPlaceholderText(/search/i),
      'https://www.uselumo.ai/workspace/lumo/documents/roadmap-42{enter}'
    )
    expect(onAttach).toHaveBeenCalledWith({
      identifier: 'https://www.uselumo.ai/workspace/lumo/documents/roadmap-42',
    })
  })
})
```

Run: `npm test -- LinkDocPopover`
Expected: FAIL.

- [ ] **Step 8.2: Implement the component**

Create `app/workspace/[workspaceUrl]/components/LinkDocPopover.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SectionAddButton } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SectionAddButton'

interface DocResult {
  id: string
  title: string
  emoji: string | null
}

export interface LinkDocPopoverProps {
  onSearch: (query: string) => Promise<DocResult[]>
  onAttach: (
    payload: { identifier: string } | { documentId: string }
  ) => Promise<void>
}

const URL_PATTERN = /\/documents\//
const CUID_PATTERN = /^cmd_[a-z0-9]+$/i
const SLUG_PATTERN = /^[a-z0-9-]+-\d+$/i

function looksLikeIdentifier(input: string): boolean {
  const t = input.trim()
  return URL_PATTERN.test(t) || CUID_PATTERN.test(t) || SLUG_PATTERN.test(t)
}

export function LinkDocPopover({ onSearch, onAttach }: LinkDocPopoverProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DocResult[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounced search for free-text queries
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q || looksLikeIdentifier(q)) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      void onSearch(q)
        .then(setResults)
        .catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(t)
  }, [open, query, onSearch])

  const attachAndClose = async (
    payload: { identifier: string } | { documentId: string }
  ) => {
    setSubmitting(true)
    setError(null)
    try {
      await onAttach(payload)
      setQuery('')
      setResults([])
      setOpen(false)
    } catch (err) {
      const e = err as { message?: string }
      setError(
        e.message ??
          intl.formatMessage({ id: 'task.contextLink.common.errors.network' })
      )
    } finally {
      setSubmitting(false)
    }
  }

  const onEnter = () => {
    const t = query.trim()
    if (!t || submitting) return
    if (looksLikeIdentifier(t)) {
      void attachAndClose({ identifier: t })
    } else if (results[0]) {
      void attachAndClose({ documentId: results[0].id })
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SectionAddButton />
      </PopoverTrigger>
      <PopoverContent className='w-96 p-3'>
        <input
          type='text'
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onEnter()
            }
          }}
          disabled={submitting}
          placeholder={intl.formatMessage({
            id: 'task.contextLink.doc.placeholder',
          })}
          className='w-full rounded border px-2 py-1 text-sm'
          autoFocus
        />
        <ul className='mt-2 max-h-64 overflow-y-auto'>
          {results.map(r => (
            <li key={r.id}>
              <button
                type='button'
                className='flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted'
                onClick={() => attachAndClose({ documentId: r.id })}
                disabled={submitting}
              >
                {r.emoji && <span>{r.emoji}</span>}
                <span>{r.title}</span>
              </button>
            </li>
          ))}
          {!looksLikeIdentifier(query) &&
            query.trim() &&
            results.length === 0 && (
              <li className='px-2 py-1 text-xs text-muted-foreground'>
                {intl.formatMessage({ id: 'task.contextLink.doc.searchEmpty' })}
              </li>
            )}
        </ul>
        {error && (
          <p role='alert' className='mt-2 text-xs text-red-600'>
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 8.3: Wire into DocumentsSection**

In `DocumentsSection.tsx`, pass `addSlot={<LinkDocPopover onSearch={search} onAttach={attach} />}` to the section wrapper. Implement `search` as `taskDocumentsClient.search(query).then(r => r.documents)` and `attach` as `taskDocumentsClient.attach(taskId, payload).then(() => qc.invalidateQueries(['task-documents', taskId]))`.

- [ ] **Step 8.4: Run test**

Run: `npm test -- LinkDocPopover`
Expected: PASS.

- [ ] **Step 8.5: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8.6: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/LinkDocPopover.tsx app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx __tests__/app/workspace/components/LinkDocPopover.test.tsx
git commit -m "feat: add LinkDocPopover for task-side doc attach [LUM-93]"
```

---

## Task 9: Doc detach handler in DocumentsSection

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx`

- [ ] **Step 9.1: Add a delete button per row + a toast on CONTENT_MENTION_ONLY**

The existing read-only doc list has no detach action. Add a small "×" button per row that calls `taskDocumentsClient.detach(taskId, documentId)`. On 409 with `code === 'CONTENT_MENTION_ONLY'`, show a toast with the i18n key `task.contextLink.doc.errors.contentMentionOnly`. On success, invalidate the query.

```tsx
async function handleDetach(documentId: string) {
  try {
    await taskDocumentsClient.detach(taskId, documentId)
    await qc.invalidateQueries({ queryKey: ['task-documents', taskId] })
  } catch (err) {
    const e = err as { status?: number; code?: string }
    if (e.status === 409 && e.code === 'CONTENT_MENTION_ONLY') {
      toast.error(
        intl.formatMessage({
          id: 'task.contextLink.doc.errors.contentMentionOnly',
        })
      )
    } else {
      toast.error(
        intl.formatMessage({ id: 'task.contextLink.common.errors.network' })
      )
    }
  }
}
```

(`apiFetch` should already surface `code` in the thrown error — confirm; if not, parse from the error body.)

- [ ] **Step 9.2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9.3: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx
git commit -m "feat: add doc detach action to task documents section [LUM-93]"
```

---

## Task 10: i18n for 16 locales

**Files:**

- Modify: every file under `lib/i18n/*.json` (16 files)

- [ ] **Step 10.1: Catalogue what to add**

New keys (translate per locale, no English fallback):

```
task.contextLink.common.loading                 — e.g. "Loading…"
task.contextLink.common.errors.network          — e.g. "Network error. Try again."
task.contextLink.common.errors.unauthorized     — e.g. "You don't have permission to do that."

task.contextLink.weblink.placeholder            — e.g. "Paste a URL (https://…)"
task.contextLink.weblink.errors.urlInvalid      — e.g. "That doesn't look like a valid URL."

task.contextLink.slack.placeholder              — e.g. "Paste a Slack message link"
task.contextLink.slack.errors.permalinkInvalid  — e.g. "That doesn't look like a Slack permalink."
task.contextLink.slack.errors.workspaceNotConnected — e.g. "Connect Slack first."
task.contextLink.slack.connectCta               — e.g. "Open integrations →"

task.contextLink.doc.placeholder                — e.g. "Search docs or paste a doc URL"
task.contextLink.doc.searchEmpty                — e.g. "No matching documents."
task.contextLink.doc.errors.notFound            — e.g. "Document not found or not visible."
task.contextLink.doc.errors.contentMentionOnly  — e.g. "This link comes from the doc body. Remove @LUM-N inside the doc to unlink."
task.contextLink.doc.lockTooltip                — e.g. "You no longer have access to this document."
```

Keys to remove (currently consumed only by `WebLinkAddDialog` and `AddSlackContextDialog`):

```bash
git grep -l "WebLinkAddDialog\|AddSlackContextDialog\|weblink.note\|slack.attach.title\|slack.attach.permalink"
```

Use that list to identify the exact removed keys per locale.

- [ ] **Step 10.2: Update each locale file**

For each of `de, en, en-AU, en-GB, es, es-419, fr, hi, id, ja, ko, ms, ru, vi, zh-CN, zh-TW`:

1. Insert the new keys with a proper translation in that language. **No English fallback** — provide a real translation per CLAUDE.md.
2. Remove the dialog-only keys identified in Step 10.1.

Use the en.json change as a template, then translate values per locale. Coordinate via the existing i18n style (key sort order, indentation) in each file.

- [ ] **Step 10.3: Verify no orphan keys & no missing keys**

Run a quick consistency check:

```bash
node -e "
const fs = require('fs');
const files = fs.readdirSync('lib/i18n').filter(f => f.endsWith('.json'));
const keysets = files.map(f => ({ f, keys: new Set(Object.keys(JSON.parse(fs.readFileSync('lib/i18n/' + f, 'utf8')))) }));
const reference = keysets[0].keys;
for (const { f, keys } of keysets.slice(1)) {
  const missing = [...reference].filter(k => !keys.has(k));
  const extra = [...keys].filter(k => !reference.has(k));
  if (missing.length || extra.length) console.log(f, { missing, extra });
}
"
```

Expected: empty output (all locale files have identical key sets).

- [ ] **Step 10.4: TypeScript check & full test pass**

Run:

```bash
npx tsc --noEmit && npm test
```

Expected: no errors, all tests pass.

- [ ] **Step 10.5: Commit**

```bash
git add lib/i18n/
git commit -m "i18n: add context-link popover keys, drop dialog keys [LUM-93]"
```

---

## Task 11: Self-review & PR

- [ ] **Step 11.1: Run all checks**

```bash
npx tsc --noEmit
npm test
npm run lint
```

Expected: all green.

- [ ] **Step 11.2: Manual smoke test in dev**

Run `npm run dev`, open a task detail page, verify:

1. PR section behaves identically to before (no regression).
2. Weblink popover: paste URL + Enter attaches; no Note field shown.
3. Slack popover: when Slack is connected, paste permalink + Enter attaches; when not connected, the popover shows the connect CTA.
4. Doc popover: type a partial title → results appear → click attaches; paste a doc URL + Enter attaches; paste a slug-N + Enter attaches.
5. Doc detach: click × on a doc that was attached via popover → it's gone. Click × on a doc that's linked only via `@LUM-N` in the doc body → toast shows the "content mention" error.

- [ ] **Step 11.3: Push & PR**

```bash
git push -u origin lumo/LUM-93-unify-context-link-flows
gh pr create --title "feat: unify task context link flows [LUM-93]" --body "$(cat <<'EOF'
## Summary
- Convert weblink and Slack attach UIs from modal dialogs to Radix popovers (matches existing PR pattern)
- Drop the weblink Note input field; `TaskWebLink.note` column kept (no migration)
- Add a new LinkDocPopover entry on the task detail page, reusing `documentService.addExplicitMention` (same semantics as `lumo doc bind`)
- New task-side endpoints: `POST /api/tasks/[id]/documents`, `DELETE /api/tasks/[id]/documents/[documentId]`

## Test plan
- [ ] `npm test` green
- [ ] `npx tsc --noEmit` green
- [ ] Manual smoke test of all four section popovers (see plan §11.2)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage:** All goals (1) consistent UI, (2) drop weblink Note, (3) doc attach entry — each mapped to tasks 6/7/8 + 1. Non-goals respected (PR untouched; no `note` column drop; no shared shell; no CLI command changes).

**Type consistency:** `taskDocumentsClient.attach` payload `{ identifier } | { documentId }` matches `attachTaskDocumentBodySchema` matches the POST handler's parsed body. `taskDocumentsClient.detach(taskId, documentId)` matches the DELETE route signature.

**Placeholder scan:** No "TBD" / "later" / "similar to". Every step contains the code or command to run. Where signatures need confirmation (e.g. `documentRepository.findBySlug`), the step calls out exactly what to verify and what to add if missing.

**Open risks:**

- `documentRepository.findBySlug` may not exist; Task 3 covers adding it.
- `apiFetch` may or may not propagate the response body's `code` field on error. If not, Task 9's CONTENT_MENTION_ONLY detection needs a custom error mapper. Verify when implementing.
- Existing `__tests__` paths in the codebase may use `__tests__/` directly or be co-located — confirm before creating new test files; adapt paths if the project uses a different convention.
