# Doc → Tasks Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click flow that turns markdown checkbox (`taskItem`) lines and selected text inside a doc into linked Lumo tasks. The doc segment becomes an anchor to the new task; the doc is bound to the task via `DocumentMention(source=EXPLICIT)`.

**Architecture:** Single endpoint `POST /api/documents/[id]/extract-tasks` with a `selector` discriminator (`marked` | `all_unchecked`). Server is the single source of truth: parses caller-provided HTML, identifies candidates, in one Prisma transaction creates tasks (`task-creation.service`), inserts mentions, replaces nodes with anchor links, saves doc. Frontend reads `data-task-id` on `taskItem` to render link/badge instead of checkbox; provides three triggers (hover, bubble menu, batch).

**Tech Stack:** TypeScript, Next.js 14 (App Router), Prisma, TipTap 3 (`@tiptap/extension-task-list`, `@tiptap/extension-task-item`), `node-html-parser`, Jest

**Spec:** [docs/superpowers/specs/2026-05-24-doc-spec-to-tasks-design.md](../specs/2026-05-24-doc-spec-to-tasks-design.md)
**Task:** [LUM-91](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-91)

---

## File Structure

### New files

| Path                                                                     | Responsibility                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `lib/validation/extract-tasks.schema.ts`                                 | Zod schema for request body                                                     |
| `lib/services/document-task-extraction.service.ts`                       | Service: parse → identify → transaction (createTask + mention + content update) |
| `app/api/documents/[id]/extract-tasks/route.ts`                          | API route: auth, validate, call service, return response                        |
| `lib/api-client/documents-extract.ts`                                    | Frontend client method `extractTasks(docId, body)`                              |
| `lib/editor/marks/task-link.ts`                                          | TipTap mark for `<a data-task-link>` anchors                                    |
| `lib/editor/nodes/task-item-with-link.ts`                                | Extended `TaskItem` that switches render based on `data-task-id`                |
| `lib/editor/nodes/task-item-node-view.tsx`                               | TipTap NodeView for the extended `taskItem` (renders hover button)              |
| `lib/editor/doc-extract-context.tsx`                                     | React context wiring editor ↔ extract handlers (no app/ coupling)               |
| `app/workspace/[workspaceUrl]/components/extract/HoverExtractButton.tsx` | Hover-revealed `→ task` button rendered inside the NodeView                     |
| `app/workspace/[workspaceUrl]/components/extract/BatchExtractButton.tsx` | Doc-top toolbar batch button with confirm dialog                                |
| `__tests__/services/document-task-extraction.test.ts`                    | Service unit tests                                                              |
| `__tests__/api/documents-extract-tasks.test.ts`                          | API integration tests                                                           |

### Modified files

| Path                                                        | Why                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `package.json`                                              | Add `node-html-parser` dep                                                |
| `lib/editor/extensions.ts`                                  | Swap `TaskItem` import for the extended version; register `TaskLink` mark |
| `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx` | Add "Convert to task" bubble action with disabled-state logic             |
| `app/workspace/[workspaceUrl]/documents/[docId]/page.tsx`   | Mount `BatchExtractButton` in doc toolbar area                            |
| `lib/i18n/*.json` (all 16 locale files)                     | Add `doc.extract.*` keys                                                  |

---

## Phase 1 — Backend service + API

### Task 1: Add `node-html-parser` dependency

**Files:**

- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the package**

Run: `npm install node-html-parser@^7.0.1`
Expected: package added to `dependencies`, lockfile updated.

- [ ] **Step 2: Smoke check**

Run: `node -e "console.log(require('node-html-parser').parse('<p>hi</p>').toString())"`
Expected: prints `<p>hi</p>`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add node-html-parser for doc extract pipeline [LUM-91]"
```

---

### Task 2: Zod validation schema

**Files:**

- Create: `lib/validation/extract-tasks.schema.ts`
- Test: `__tests__/extract-tasks-schema.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/extract-tasks-schema.test.ts
import { extractTasksSchema } from '@/lib/validation/extract-tasks.schema'

describe('extractTasksSchema', () => {
  it('accepts marked selector', () => {
    const r = extractTasksSchema.safeParse({
      content: '<p>hi</p>',
      selector: { type: 'marked' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts all_unchecked selector', () => {
    const r = extractTasksSchema.safeParse({
      content: '<p>hi</p>',
      selector: { type: 'all_unchecked' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown selector', () => {
    const r = extractTasksSchema.safeParse({
      content: '<p>hi</p>',
      selector: { type: 'bogus' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty content', () => {
    const r = extractTasksSchema.safeParse({
      content: '',
      selector: { type: 'marked' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects content over 1MB', () => {
    const r = extractTasksSchema.safeParse({
      content: 'x'.repeat(1_048_577),
      selector: { type: 'marked' },
    })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

Run: `npx jest __tests__/extract-tasks-schema.test.ts -t extractTasksSchema`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schema**

```ts
// lib/validation/extract-tasks.schema.ts
import { z } from 'zod'

export const extractTasksSchema = z.object({
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(1_048_576, 'Content exceeds 1MB limit'),
  selector: z.discriminatedUnion('type', [
    z.object({ type: z.literal('marked') }),
    z.object({ type: z.literal('all_unchecked') }),
  ]),
})

export type ExtractTasksInput = z.infer<typeof extractTasksSchema>
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx jest __tests__/extract-tasks-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validation/extract-tasks.schema.ts __tests__/extract-tasks-schema.test.ts
git commit -m "feat: Zod schema for doc extract-tasks request [LUM-91]"
```

---

### Task 3: Service — HTML parsing + candidate identification

This task ships only the _read_ side of the service: take HTML + selector → return a list of candidates with their textContent and a reference to the DOM node. Mutation comes in Task 4.

**Files:**

- Create: `lib/services/document-task-extraction.service.ts`
- Test: `__tests__/services/document-task-extraction.test.ts`

- [ ] **Step 1: Write failing tests for candidate identification**

```ts
// __tests__/services/document-task-extraction.test.ts
import { findExtractionCandidates } from '@/lib/services/document-task-extraction.service'

describe('findExtractionCandidates', () => {
  const taskListHtml = `
    <ul data-type="taskList">
      <li data-type="taskItem" data-checked="false"><div><p>first</p></div></li>
      <li data-type="taskItem" data-checked="true"><div><p>done</p></div></li>
      <li data-type="taskItem" data-checked="false"><div><p>second</p></div></li>
    </ul>
  `

  it('all_unchecked selector picks only unchecked items', () => {
    const cs = findExtractionCandidates(taskListHtml, { type: 'all_unchecked' })
    expect(cs.map(c => c.text)).toEqual(['first', 'second'])
  })

  it('all_unchecked skips items already linked', () => {
    const html = `
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false">
          <div><p><a data-task-link="cm_x">already</a></p></div>
        </li>
        <li data-type="taskItem" data-checked="false"><div><p>fresh</p></div></li>
      </ul>
    `
    const cs = findExtractionCandidates(html, { type: 'all_unchecked' })
    expect(cs.map(c => c.text)).toEqual(['fresh'])
  })

  it('marked selector picks data-extract-pending nodes', () => {
    const html = `
      <p>before <span data-extract-pending="true">hello</span> after</p>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false" data-extract-pending="true">
          <div><p>checkbox item</p></div>
        </li>
      </ul>
    `
    const cs = findExtractionCandidates(html, { type: 'marked' })
    expect(cs.map(c => c.text)).toEqual(['hello', 'checkbox item'])
  })

  it('returns empty array when nothing matches', () => {
    const cs = findExtractionCandidates('<p>plain</p>', { type: 'marked' })
    expect(cs).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx jest __tests__/services/document-task-extraction.test.ts -t findExtractionCandidates`
Expected: FAIL — function not found.

- [ ] **Step 3: Implement candidate identification**

```ts
// lib/services/document-task-extraction.service.ts
import { parse, HTMLElement } from 'node-html-parser'

export type Selector = { type: 'marked' } | { type: 'all_unchecked' }

export interface Candidate {
  node: HTMLElement
  text: string
}

/** Parse HTML and return extraction candidates per selector. Internal helper, exported for unit tests. */
export function findExtractionCandidates(
  html: string,
  selector: Selector
): Candidate[] {
  const root = parse(html)
  let nodes: HTMLElement[]

  if (selector.type === 'all_unchecked') {
    nodes = root
      .querySelectorAll('li[data-type="taskItem"][data-checked="false"]')
      .filter(n => n.querySelector('a[data-task-link]') === null)
  } else {
    nodes = root.querySelectorAll('[data-extract-pending="true"]')
  }

  return nodes.map(node => ({
    node,
    text: node.text.trim(),
  }))
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx jest __tests__/services/document-task-extraction.test.ts -t findExtractionCandidates`
Expected: PASS — all 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/services/document-task-extraction.service.ts __tests__/services/document-task-extraction.test.ts
git commit -m "feat: HTML candidate identification for doc extract [LUM-91]"
```

---

### Task 4: Service — node replacement (HTML mutation)

**Files:**

- Modify: `lib/services/document-task-extraction.service.ts`
- Modify: `__tests__/services/document-task-extraction.test.ts`

- [ ] **Step 1: Write failing tests for replacement**

Append to the test file:

```ts
// __tests__/services/document-task-extraction.test.ts (append)
import { replaceWithTaskLink } from '@/lib/services/document-task-extraction.service'
import { parse } from 'node-html-parser'

describe('replaceWithTaskLink', () => {
  it('wraps taskItem inner text with anchor and stamps li attrs', () => {
    const root = parse(`
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p>first</p></div></li>
      </ul>
    `)
    const li = root.querySelector('li')!
    replaceWithTaskLink(li, {
      taskId: 'cm_a',
      identifier: 'LUM-1',
      href: '/workspace/lumo/my-tasks/LUM-1',
    })
    const html = root.toString()
    expect(html).toContain('data-task-id="cm_a"')
    expect(html).toContain('data-task-identifier="LUM-1"')
    expect(html).toMatch(/<a [^>]*data-task-link="cm_a"[^>]*>first<\/a>/)
    // The <li> remains in place
    expect(root.querySelectorAll('li').length).toBe(1)
  })

  it('replaces data-extract-pending span with anchor in place', () => {
    const root = parse(
      '<p>pre <span data-extract-pending="true">mid</span> post</p>'
    )
    const span = root.querySelector('span')!
    replaceWithTaskLink(span, {
      taskId: 'cm_b',
      identifier: 'LUM-2',
      href: '/workspace/lumo/my-tasks/LUM-2',
    })
    expect(root.toString()).toBe(
      '<p>pre <a data-task-link="cm_b" data-task-identifier="LUM-2" href="/workspace/lumo/my-tasks/LUM-2">mid</a> post</p>'
    )
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx jest __tests__/services/document-task-extraction.test.ts -t replaceWithTaskLink`
Expected: FAIL — function not found.

- [ ] **Step 3: Implement replacement**

Append to `lib/services/document-task-extraction.service.ts`:

```ts
// lib/services/document-task-extraction.service.ts (append)

export interface ReplacementMeta {
  taskId: string
  identifier: string
  href: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function anchorHtml(text: string, meta: ReplacementMeta): string {
  return (
    `<a data-task-link="${meta.taskId}"` +
    ` data-task-identifier="${meta.identifier}"` +
    ` href="${meta.href}">${escapeHtml(text)}</a>`
  )
}

/** Replace one candidate node in place. Mutates the DOM tree. */
export function replaceWithTaskLink(
  node: HTMLElement,
  meta: ReplacementMeta
): void {
  if (node.tagName === 'LI' && node.getAttribute('data-type') === 'taskItem') {
    node.setAttribute('data-task-id', meta.taskId)
    node.setAttribute('data-task-identifier', meta.identifier)
    const inner = node.querySelector('p') ?? node.querySelector('div')
    if (inner) {
      const text = inner.text.trim()
      inner.set_content(anchorHtml(text, meta))
    }
    return
  }
  // <span data-extract-pending> path
  const text = node.text.trim()
  node.replaceWith(anchorHtml(text, meta))
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx jest __tests__/services/document-task-extraction.test.ts -t replaceWithTaskLink`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/document-task-extraction.service.ts __tests__/services/document-task-extraction.test.ts
git commit -m "feat: HTML node replacement for doc extract [LUM-91]"
```

---

### Task 5: Service — orchestrator `extractTasksFromDoc`

**Files:**

- Modify: `lib/services/document-task-extraction.service.ts`
- Modify: `__tests__/services/document-task-extraction.test.ts`

- [ ] **Step 1: Write failing tests for orchestrator**

Append to the test file. Mock Prisma + repositories + `task-creation.service`:

```ts
// __tests__/services/document-task-extraction.test.ts (append)
import { extractTasksFromDoc } from '@/lib/services/document-task-extraction.service'

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findEditable: jest.fn(),
    update: jest.fn(async () => ({
      updatedAt: new Date('2026-05-24T10:00:00Z'),
    })),
  },
}))

jest.mock('@/lib/services/task-creation.service', () => ({
  createTask: jest.fn(async (_pid, input, _aid, _cid) => ({
    task: {
      id: `cm_${input.title}`,
      teamIdentifier: 'LUM',
      number: 100,
      title: input.title,
    },
    taskTags: [],
  })),
}))

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor_1' })),
  },
}))

// Bypass Prisma transaction: just execute the callback inline
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(async (fn: any) =>
      fn({
        documentMention: { createMany: jest.fn(async () => ({ count: 0 })) },
      })
    ),
  },
}))

import { documentRepository } from '@/lib/repositories/document.repository'

describe('extractTasksFromDoc', () => {
  beforeEach(() => jest.clearAllMocks())

  const baseDoc = {
    id: 'doc_1',
    projectId: 'proj_1',
    workspaceId: 'ws_1',
    workspace: { slug: 'lumo' },
    content: '',
  }

  it('extracts all unchecked items and returns tasks + updatedContent', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
      content: `<ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p>first</p></div></li>
        <li data-type="taskItem" data-checked="false"><div><p>second</p></div></li>
      </ul>`,
    })

    const res = await extractTasksFromDoc({
      documentId: 'doc_1',
      memberId: 'mem_1',
      callerClerkId: 'user_1',
      workspaceId: 'ws_1',
      content: '<ignored — service refetches>',
      selector: { type: 'all_unchecked' },
    })

    expect(res.tasks.map(t => t.title)).toEqual(['first', 'second'])
    expect(res.tasks.map(t => t.identifier)).toEqual(['LUM-100', 'LUM-100'])
    expect(res.updatedContent).toContain('data-task-id="cm_first"')
    expect(res.skipped).toEqual([])
  })

  it('skips empty checkbox items', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
      content: `<ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p></p></div></li>
        <li data-type="taskItem" data-checked="false"><div><p>real</p></div></li>
      </ul>`,
    })

    const res = await extractTasksFromDoc({
      documentId: 'doc_1',
      memberId: 'mem_1',
      callerClerkId: 'user_1',
      workspaceId: 'ws_1',
      content: '',
      selector: { type: 'all_unchecked' },
    })

    expect(res.tasks.map(t => t.title)).toEqual(['real'])
    expect(res.skipped).toEqual([{ reason: 'empty' }])
  })

  it('truncates over-200-char titles and stores rest in description', async () => {
    const long = 'a'.repeat(250)
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
      content: `<ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p>${long}</p></div></li>
      </ul>`,
    })

    const { createTask } = require('@/lib/services/task-creation.service')

    await extractTasksFromDoc({
      documentId: 'doc_1',
      memberId: 'mem_1',
      callerClerkId: 'user_1',
      workspaceId: 'ws_1',
      content: '',
      selector: { type: 'all_unchecked' },
    })

    expect(createTask).toHaveBeenCalledWith(
      'proj_1',
      expect.objectContaining({
        title: 'a'.repeat(200),
        description: 'a'.repeat(50),
      }),
      'actor_1',
      'user_1'
    )
  })

  it('throws 400 MISSING_PROJECT when doc has no projectId', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
      projectId: null,
      content: '<p>any</p>',
    })

    await expect(
      extractTasksFromDoc({
        documentId: 'doc_1',
        memberId: 'mem_1',
        callerClerkId: 'user_1',
        workspaceId: 'ws_1',
        content: '',
        selector: { type: 'all_unchecked' },
      })
    ).rejects.toMatchObject({ status: 400, code: 'MISSING_PROJECT' })
  })

  it('throws 403 when findEditable returns null', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce(null)

    await expect(
      extractTasksFromDoc({
        documentId: 'doc_1',
        memberId: 'mem_1',
        callerClerkId: 'user_1',
        workspaceId: 'ws_1',
        content: '',
        selector: { type: 'all_unchecked' },
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('throws 409 NO_CANDIDATES when selector finds nothing', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
      content: '<p>just prose</p>',
    })

    await expect(
      extractTasksFromDoc({
        documentId: 'doc_1',
        memberId: 'mem_1',
        callerClerkId: 'user_1',
        workspaceId: 'ws_1',
        content: '',
        selector: { type: 'marked' },
      })
    ).rejects.toMatchObject({ status: 409, code: 'NO_CANDIDATES' })
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx jest __tests__/services/document-task-extraction.test.ts -t extractTasksFromDoc`
Expected: FAIL — `extractTasksFromDoc` not exported.

- [ ] **Step 3: Implement the orchestrator**

Append to `lib/services/document-task-extraction.service.ts`:

```ts
// lib/services/document-task-extraction.service.ts (append)
import { prisma } from '@/lib/db/prisma'
import { documentRepository } from '@/lib/repositories/document.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { createTask as createTaskService } from '@/lib/services/task-creation.service'

const DEFAULT_PUBLIC_URL = 'https://www.uselumo.ai'
const MAX_TITLE_LENGTH = 200

function publicUrl(): string {
  const v = process.env.LUMO_PUBLIC_URL?.trim()
  return v && v.length > 0 ? v.replace(/\/+$/, '') : DEFAULT_PUBLIC_URL
}

function httpError(status: number, message: string, code?: string): Error {
  return Object.assign(new Error(message), { status, code })
}

export type SkipReason = 'empty' | 'too_long' | 'invalid_marker'

export interface ExtractArgs {
  documentId: string
  memberId: string
  callerClerkId: string
  workspaceId: string
  content: string
  selector: Selector
}

export interface ExtractResult {
  tasks: Array<{ id: string; identifier: string; title: string }>
  updatedContent: string
  updatedAt: string
  skipped: Array<{ reason: SkipReason; label?: string }>
}

export async function extractTasksFromDoc(
  args: ExtractArgs
): Promise<ExtractResult> {
  const doc = await documentRepository.findEditable(
    args.documentId,
    args.memberId,
    args.workspaceId
  )
  if (!doc) {
    throw httpError(403, 'No edit access to this document')
  }
  if (!doc.projectId) {
    throw httpError(
      400,
      'Document has no project — set a project before extracting tasks',
      'MISSING_PROJECT'
    )
  }

  // Use the caller-provided content per spec §4 "Why client sends `content`":
  // doc may have unsaved local edits. Server still owns post-extract state.
  const sourceContent = args.content
  const root = parse(sourceContent)
  const candidates = findExtractionCandidatesInRoot(root, args.selector)
  if (candidates.length === 0) {
    throw httpError(409, 'No extraction candidates found', 'NO_CANDIDATES')
  }

  const actor = await memberRepository.findActorByMemberId(args.memberId)
  if (!actor) {
    throw httpError(500, 'Caller has no actor row')
  }

  const skipped: ExtractResult['skipped'] = []
  const created: Array<{
    id: string
    identifier: string
    title: string
    node: HTMLElement
  }> = []

  // Filter + validate candidates first; create tasks for valid ones.
  for (const c of candidates) {
    if (c.text.length === 0) {
      skipped.push({ reason: 'empty' })
      continue
    }
    // Reject invalid markers: a data-extract-pending wrapping an existing
    // task-link. Safety check; UI also disables this case.
    if (
      c.node.querySelector !== undefined &&
      c.node.querySelector('a[data-task-link]') !== null
    ) {
      skipped.push({ reason: 'invalid_marker', label: c.text.slice(0, 80) })
      continue
    }

    const title = c.text.slice(0, MAX_TITLE_LENGTH)
    const description =
      c.text.length > MAX_TITLE_LENGTH ? c.text.slice(MAX_TITLE_LENGTH) : null

    const { task } = await createTaskService(
      doc.projectId,
      {
        title,
        description,
        status: 'TODO',
        priority: 'LOW',
        assigneeActorId: actor.id,
      },
      actor.id,
      args.callerClerkId
    )

    const identifier = `${task.teamIdentifier}-${task.number}`
    const href = `${publicUrl()}/workspace/${doc.workspace.slug}/my-tasks/${identifier}`
    replaceWithTaskLink(c.node, { taskId: task.id, identifier, href })

    created.push({ id: task.id, identifier, title, node: c.node })

    if (c.text.length > MAX_TITLE_LENGTH) {
      skipped.push({
        reason: 'too_long',
        label: title.slice(0, 80),
      })
    }
  }

  // Serialize back. The root has been mutated by replaceWithTaskLink calls.
  // We re-parse on demand: the candidates list still references the live tree.
  // Easiest: parse once at the start, retain root, get its toString at the end.
  // Refactor below.

  const updatedHtml = root.toString()

  // Persist mentions + content in a transaction. Tasks are already created
  // above; if the transaction below fails, we accept orphan tasks (Slack
  // notification has already fired). This is the documented trade-off in
  // the spec — atomicity vs side-effect dispatch.
  await prisma.$transaction(async tx => {
    if (created.length > 0) {
      await tx.documentMention.createMany({
        data: created.map(t => ({
          documentId: doc.id,
          taskId: t.id,
          source: 'EXPLICIT' as const,
        })),
        skipDuplicates: true,
      })
    }
  })

  const updated = await documentRepository.update(doc.id, {
    content: updatedHtml,
  })

  return {
    tasks: created.map(({ id, identifier, title }) => ({
      id,
      identifier,
      title,
    })),
    updatedContent: updatedHtml,
    updatedAt: updated.updatedAt.toISOString(),
    skipped,
  }
}

/**
 * Same logic as `findExtractionCandidates` but reuses an existing parsed root.
 * Keeps mutation and serialization on a single tree.
 */
function findExtractionCandidatesInRoot(
  root: HTMLElement,
  selector: Selector
): Candidate[] {
  let nodes: HTMLElement[]
  if (selector.type === 'all_unchecked') {
    nodes = root
      .querySelectorAll('li[data-type="taskItem"][data-checked="false"]')
      .filter(n => n.querySelector('a[data-task-link]') === null)
  } else {
    nodes = root.querySelectorAll('[data-extract-pending="true"]')
  }
  return nodes.map(node => ({ node, text: node.text.trim() }))
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx jest __tests__/services/document-task-extraction.test.ts`
Expected: PASS — all sub-cases.

- [ ] **Step 5: Commit**

```bash
git add lib/services/document-task-extraction.service.ts __tests__/services/document-task-extraction.test.ts
git commit -m "feat: extractTasksFromDoc orchestrator with createTask + mention + save [LUM-91]"
```

---

### Task 6: API route

**Files:**

- Create: `app/api/documents/[id]/extract-tasks/route.ts`
- Create: `__tests__/api/documents-extract-tasks.test.ts`

- [ ] **Step 1: Write failing API integration tests**

```ts
// __tests__/api/documents-extract-tasks.test.ts
/** @jest-environment node */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(async () => ({
    clerkId: 'user_1',
    memberId: 'mem_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'lumo',
    workspaceName: 'Lumo',
    source: 'bearer',
  })),
}))

jest.mock('@/lib/services/document-task-extraction.service', () => ({
  extractTasksFromDoc: jest.fn(),
}))

import { POST } from '@/app/api/documents/[id]/extract-tasks/route'
import { extractTasksFromDoc } from '@/lib/services/document-task-extraction.service'

const svc = extractTasksFromDoc as jest.Mock

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc_1/extract-tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      authorization: 'Bearer lum_test',
      'content-type': 'application/json',
    },
  })
}

describe('POST /api/documents/[id]/extract-tasks', () => {
  beforeEach(() => svc.mockReset())

  it('returns 200 with service result', async () => {
    svc.mockResolvedValueOnce({
      tasks: [{ id: 'cm_1', identifier: 'LUM-1', title: 'first' }],
      updatedContent: '<ul/>',
      updatedAt: '2026-05-24T10:00:00.000Z',
      skipped: [],
    })

    const res = await POST(
      req({
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>first</p></li></ul>',
        selector: { type: 'all_unchecked' },
      }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tasks).toHaveLength(1)
    expect(json.tasks[0].identifier).toBe('LUM-1')
  })

  it('returns 400 on validation failure', async () => {
    const res = await POST(
      req({ content: '', selector: { type: 'all_unchecked' } }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 with MISSING_PROJECT code from service', async () => {
    svc.mockRejectedValueOnce(
      Object.assign(new Error('Document has no project'), {
        status: 400,
        code: 'MISSING_PROJECT',
      })
    )

    const res = await POST(
      req({ content: '<p>x</p>', selector: { type: 'all_unchecked' } }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('MISSING_PROJECT')
  })

  it('returns 403 from service', async () => {
    svc.mockRejectedValueOnce(
      Object.assign(new Error('No edit access'), { status: 403 })
    )

    const res = await POST(
      req({ content: '<p>x</p>', selector: { type: 'all_unchecked' } }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )
    expect(res.status).toBe(403)
  })

  it('returns 409 NO_CANDIDATES from service', async () => {
    svc.mockRejectedValueOnce(
      Object.assign(new Error('No candidates'), {
        status: 409,
        code: 'NO_CANDIDATES',
      })
    )

    const res = await POST(
      req({ content: '<p>x</p>', selector: { type: 'marked' } }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx jest __tests__/api/documents-extract-tasks.test.ts`
Expected: FAIL — route file not found.

- [ ] **Step 3: Implement the route**

```ts
// app/api/documents/[id]/extract-tasks/route.ts
import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { extractTasksSchema } from '@/lib/validation/extract-tasks.schema'
import { extractTasksFromDoc } from '@/lib/services/document-task-extraction.service'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = extractTasksSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  try {
    const result = await extractTasksFromDoc({
      documentId: id,
      memberId: identity.memberId,
      callerClerkId: identity.clerkId,
      workspaceId: identity.workspaceId,
      content: parsed.data.content,
      selector: parsed.data.selector,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500
    const code = (err as { code?: string })?.code
    const message =
      status === 500
        ? 'Internal Server Error'
        : err instanceof Error
          ? err.message
          : 'Error'
    if (status === 500) {
      console.error('POST /api/documents/[id]/extract-tasks error:', err)
    }
    return NextResponse.json(
      code ? { error: message, code } : { error: message },
      { status }
    )
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx jest __tests__/api/documents-extract-tasks.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add app/api/documents/[id]/extract-tasks/route.ts __tests__/api/documents-extract-tasks.test.ts
git commit -m "feat: POST /api/documents/[id]/extract-tasks route [LUM-91]"
```

---

### Task 7: API client helper

**Files:**

- Create: `lib/api-client/documents-extract.ts`

- [ ] **Step 1: Implement the client helper**

```ts
// lib/api-client/documents-extract.ts
export type ExtractSelector = { type: 'marked' } | { type: 'all_unchecked' }

export interface ExtractResponse {
  tasks: Array<{ id: string; identifier: string; title: string }>
  updatedContent: string
  updatedAt: string
  skipped: Array<{
    reason: 'empty' | 'too_long' | 'invalid_marker'
    label?: string
  }>
}

export class ExtractTasksError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string
  ) {
    super(message)
  }
}

export async function extractTasks(
  documentId: string,
  body: { content: string; selector: ExtractSelector }
): Promise<ExtractResponse> {
  const res = await fetch(`/api/documents/${documentId}/extract-tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      error?: string
      code?: string
    }
    throw new ExtractTasksError(
      res.status,
      json.code,
      json.error ?? `extract-tasks failed (${res.status})`
    )
  }
  return res.json()
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/api-client/documents-extract.ts
git commit -m "feat: extractTasks API client helper [LUM-91]"
```

---

## Phase 2 — Frontend display of linked items

### Task 8: TipTap `taskLink` mark

**Files:**

- Create: `lib/editor/marks/task-link.ts`
- Modify: `lib/editor/extensions.ts`

- [ ] **Step 1: Implement the mark extension**

```ts
// lib/editor/marks/task-link.ts
import { Mark, mergeAttributes } from '@tiptap/core'

export interface TaskLinkOptions {
  HTMLAttributes: Record<string, unknown>
}

/**
 * An anchor with `data-task-link="<taskId>"`. Parses from extract-tasks
 * output and survives round-trips. Click handling lives in the doc page —
 * this just preserves attrs and renders.
 */
export const TaskLink = Mark.create<TaskLinkOptions>({
  name: 'taskLink',

  // Must beat @tiptap/extension-link (priority 100) for the
  // `a[data-task-link]` parse rule.
  priority: 1000,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      taskId: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-link'),
        renderHTML: attrs =>
          attrs.taskId ? { 'data-task-link': attrs.taskId } : {},
      },
      identifier: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-identifier'),
        renderHTML: attrs =>
          attrs.identifier ? { 'data-task-identifier': attrs.identifier } : {},
      },
      href: {
        default: null,
        parseHTML: el => el.getAttribute('href'),
        renderHTML: attrs => (attrs.href ? { href: attrs.href } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-task-link]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'task-link',
      }),
      0,
    ]
  },
})
```

- [ ] **Step 2: Register in extensions module**

Edit `lib/editor/extensions.ts`. Add at the top with the other extension imports:

```ts
import { TaskLink } from './marks/task-link'
```

In `getBaseExtensions()` (the existing factory at [lib/editor/extensions.ts:18](lib/editor/extensions.ts:18)), append `TaskLink` to the returned array. Order does not matter because `TaskLink` has `priority: 1000` which already beats `@tiptap/extension-link` (priority 100) when parsing `<a data-task-link>` elements.

- [ ] **Step 3: Sanity check by building**

Run: `npx tsc --noEmit`
Expected: no type errors in `lib/editor/`.

- [ ] **Step 4: Commit**

```bash
git add lib/editor/marks/task-link.ts lib/editor/extensions.ts
git commit -m "feat: TipTap taskLink mark for extracted task anchors [LUM-91]"
```

---

### Task 9: Extended `TaskItem` that detects `data-task-id`

**Files:**

- Create: `lib/editor/nodes/task-item-with-link.ts`
- Modify: `lib/editor/extensions.ts`

- [ ] **Step 1: Implement extended TaskItem**

```ts
// lib/editor/nodes/task-item-with-link.ts
import TaskItem from '@tiptap/extension-task-item'

/**
 * Extends the stock TaskItem to carry data-task-id / data-task-identifier
 * when the row was extracted to a task. The CSS at `.task-item[data-task-id]`
 * suppresses the checkbox and shows a task badge instead.
 */
export const TaskItemWithLink = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-id'),
        renderHTML: attrs =>
          attrs.taskId ? { 'data-task-id': attrs.taskId } : {},
      },
      taskIdentifier: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-identifier'),
        renderHTML: attrs =>
          attrs.taskIdentifier
            ? { 'data-task-identifier': attrs.taskIdentifier }
            : {},
      },
    }
  },
})
```

- [ ] **Step 2: Swap the import in `lib/editor/extensions.ts`**

Change line 5 from:

```ts
import TaskItem from '@tiptap/extension-task-item'
```

to:

```ts
import { TaskItemWithLink as TaskItem } from './nodes/task-item-with-link'
```

(Aliasing keeps the existing usage `TaskItem.configure(...)` working unchanged.)

- [ ] **Step 3: Add CSS for "extracted" state**

In the global stylesheet (`app/globals.css` or doc-editor-scoped file), add:

```css
/* Hide checkbox UI on extracted taskItem rows */
li[data-type='taskItem'][data-task-id] > label {
  display: none;
}
li[data-type='taskItem'][data-task-id] > div {
  margin-left: 0;
  padding-left: 0.5rem;
  border-left: 2px solid var(--accent, #4f46e5);
}
li[data-type='taskItem'][data-task-id] a.task-link::before {
  content: attr(data-task-identifier) ' · ';
  color: var(--muted-foreground, #888);
  font-variant-numeric: tabular-nums;
  margin-right: 0.25rem;
}
```

- [ ] **Step 4: Manual smoke**

Run: `npm run dev` and open any doc that has a `[ ]` line. Confirm rendering unchanged from before (no data-task-id present yet → no styling override applied).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/nodes/task-item-with-link.ts lib/editor/extensions.ts app/globals.css
git commit -m "feat: extended TaskItem with data-task-id parsing + extracted-state CSS [LUM-91]"
```

---

### Task 10: End-to-end render verification

This is a verification task — no production code change. It pins down that a doc whose `content` includes the extracted shape renders correctly.

**Files:**

- Create: `__tests__/components/extract-rendering.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// __tests__/components/extract-rendering.test.tsx
import { render } from '@testing-library/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { getBaseExtensions } from '@/lib/editor/extensions'

function Editor({ content }: { content: string }) {
  const editor = useEditor({
    extensions: getBaseExtensions(),
    content,
    editable: false,
  })
  return <EditorContent editor={editor} />
}

describe('extracted taskItem rendering', () => {
  it('renders a checkbox row with data-task-id as a task badge link', () => {
    const html = `<ul data-type="taskList">
      <li data-type="taskItem" data-checked="false" data-task-id="cm_a" data-task-identifier="LUM-1">
        <label><input type="checkbox"><span></span></label>
        <div><p><a data-task-link="cm_a" data-task-identifier="LUM-1" href="/workspace/lumo/my-tasks/LUM-1">first</a></p></div>
      </li>
    </ul>`
    const { container } = render(<Editor content={html} />)
    const li = container.querySelector('li[data-task-id="cm_a"]')
    expect(li).not.toBeNull()
    const anchor = li!.querySelector('a[data-task-link]')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe('/workspace/lumo/my-tasks/LUM-1')
  })
})
```

`getBaseExtensions()` is the existing factory function exported from `lib/editor/extensions.ts:18`. It returns the array of extensions used by the doc editor.

- [ ] **Step 2: Run test, expect pass (or fail with a clear cause)**

Run: `npx jest __tests__/components/extract-rendering.test.tsx`
Expected: PASS. If FAIL, the most likely cause is the `editorExtensions` export not existing — adjust the import name.

- [ ] **Step 3: Commit**

```bash
git add __tests__/components/extract-rendering.test.tsx
git commit -m "test: round-trip rendering of extracted taskItem [LUM-91]"
```

---

## Phase 3 — Frontend triggers

### Task 11: Hover `→ task` button on `taskItem` rows

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/extract/HoverExtractButton.tsx`
- Modify: `lib/editor/nodes/task-item-with-link.ts` (attach a NodeView that renders the hover button)

- [ ] **Step 1: Implement the hover button**

```tsx
// app/workspace/[workspaceUrl]/components/extract/HoverExtractButton.tsx
'use client'
import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  extractTasks,
  ExtractTasksError,
} from '@/lib/api-client/documents-extract'

export interface HoverExtractButtonProps {
  documentId: string
  /** Returns the current HTML with the target node tagged data-extract-pending=true. */
  prepareContent: () => string
  /** Called after a successful extract with the new full content. */
  onApplied: (newContent: string) => void
  /** Called on error to surface a toast. */
  onError: (err: ExtractTasksError | Error) => void
}

export function HoverExtractButton({
  documentId,
  prepareContent,
  onApplied,
  onError,
}: HoverExtractButtonProps) {
  const intl = useIntl()
  const [pending, setPending] = useState(false)
  const label = intl.formatMessage({ id: 'doc.extract.button.hover' })

  async function go() {
    setPending(true)
    try {
      const res = await extractTasks(documentId, {
        content: prepareContent(),
        selector: { type: 'marked' },
      })
      onApplied(res.updatedContent)
    } catch (err) {
      onError(err as Error)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type='button'
      onClick={go}
      disabled={pending}
      className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100'
      aria-label={label}
    >
      → task
    </button>
  )
}
```

- [ ] **Step 2: Add a NodeView to the extended TaskItem that renders the button**

Update `lib/editor/nodes/task-item-with-link.ts`:

```ts
// lib/editor/nodes/task-item-with-link.ts (replace the export block)
import TaskItem from '@tiptap/extension-task-item'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TaskItemNodeView } from './task-item-node-view'

export const TaskItemWithLink = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-id'),
        renderHTML: attrs =>
          attrs.taskId ? { 'data-task-id': attrs.taskId } : {},
      },
      taskIdentifier: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-identifier'),
        renderHTML: attrs =>
          attrs.taskIdentifier
            ? { 'data-task-identifier': attrs.taskIdentifier }
            : {},
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskItemNodeView)
  },
})
```

- [ ] **Step 3: Implement the NodeView component**

```tsx
// lib/editor/nodes/task-item-node-view.tsx
'use client'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useDocExtractContext } from '@/lib/editor/doc-extract-context'
import { HoverExtractButton } from '@/app/workspace/[workspaceUrl]/components/extract/HoverExtractButton'

export function TaskItemNodeView({ node, getPos, editor }: NodeViewProps) {
  const ctx = useDocExtractContext()
  const isLinked = Boolean(node.attrs.taskId)

  return (
    <NodeViewWrapper
      as='li'
      data-type='taskItem'
      data-checked={node.attrs.checked ? 'true' : 'false'}
      data-task-id={node.attrs.taskId ?? undefined}
      data-task-identifier={node.attrs.taskIdentifier ?? undefined}
      className='group flex items-start gap-2'
    >
      {!isLinked && (
        <label contentEditable={false}>
          <input
            type='checkbox'
            checked={Boolean(node.attrs.checked)}
            onChange={e => {
              const pos = typeof getPos === 'function' ? getPos() : null
              if (pos == null) return
              editor.commands.command(({ tr }) => {
                tr.setNodeAttribute(pos, 'checked', e.target.checked)
                return true
              })
            }}
          />
          <span />
        </label>
      )}
      <div className='flex-1'>
        <NodeViewContent />
      </div>
      {!isLinked && ctx?.documentId && (
        <span contentEditable={false}>
          <HoverExtractButton
            documentId={ctx.documentId}
            prepareContent={() =>
              ctx.stampPendingOnThisNode(getPos as () => number)
            }
            onApplied={ctx.onApplied}
            onError={ctx.onError}
          />
        </span>
      )}
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 4: Implement `DocExtractContext`**

```tsx
// lib/editor/doc-extract-context.tsx
'use client'
import { createContext, useContext, useMemo, ReactNode } from 'react'
import type { Editor } from '@tiptap/core'

export interface DocExtractCtx {
  documentId: string
  editor: Editor
  onApplied: (newContent: string) => void
  onError: (err: Error) => void
  /**
   * Serialize the editor to HTML with data-extract-pending="true"
   * stamped on the node at `getPos()`. Used by the per-row button.
   */
  stampPendingOnThisNode: (getPos: () => number) => string
}

const Ctx = createContext<DocExtractCtx | null>(null)

export function DocExtractProvider({
  value,
  children,
}: {
  value: DocExtractCtx
  children: ReactNode
}) {
  const memo = useMemo(() => value, [value])
  return <Ctx.Provider value={memo}>{children}</Ctx.Provider>
}

export function useDocExtractContext() {
  return useContext(Ctx)
}
```

- [ ] **Step 5: Wire the provider in the doc page**

Edit `app/workspace/[workspaceUrl]/documents/[docId]/page.tsx` (or the component that owns the editor). Around the `<EditorContent>` element, wrap with `<DocExtractProvider value={{...}}>`. Provide:

- `documentId`: from URL params
- `editor`: from `useEditor`
- `onApplied(newContent)`: call `editor.commands.setContent(newContent)` and trigger a save
- `onError(err)`: toast (use the existing toast system; see other doc commands for an example)
- `stampPendingOnThisNode(getPos)`: serialize editor to HTML, parse via `node-html-parser`, find the node corresponding to `getPos()` (use a unique marker: insert a temporary `data-extract-pending="true"` attr via `editor.commands.command`, serialize, then revert in a setTimeout). Implementation note: the simplest correct way is `editor.commands.setNodeAttribute(getPos(), 'taskId', '__pending__')` → serialize → `editor.commands.setNodeAttribute(getPos(), 'taskId', null)` immediately after.

- [ ] **Step 6: Smoke test in browser**

Run: `npm run dev` → open a doc with a `[ ]` line → hover over it. Confirm the `→ task` button shows. Click it. Expect a task to be created in the workspace and the row to render as a link.

- [ ] **Step 7: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/extract/ lib/editor/nodes/task-item-with-link.ts app/workspace/[workspaceUrl]/documents/[docId]/page.tsx
git commit -m "feat: hover '→ task' button on doc checkbox rows [LUM-91]"
```

---

### Task 12: Bubble-menu "Convert to task" action

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx`

- [ ] **Step 1: Add the menu item**

In `BubbleMenuBar.tsx`, add a new `ToolbarButton` for "Convert to task". It needs:

- Disabled when `editor.state.selection.empty`
- Disabled when selection crosses paragraph boundaries — compute via `editor.state.selection.$from.parent !== editor.state.selection.$to.parent`
- Disabled when the selection range contains any node with `data-task-link` attribute — iterate via `editor.state.doc.nodesBetween($from.pos, $to.pos, ...)`
- onClick: serialize the editor to HTML, wrap the selection range in `<span data-extract-pending="true">…</span>` (via TipTap: `editor.commands.command(({ tr }) => { tr.addMark(...) })` is awkward for a non-mark wrapper — easier: split text into pre/mid/post strings client-side, splice the marker, then call `extractTasks`)
- After success: call `ctx.onApplied(newContent)`

Concrete addition (insert near other ToolbarButtons in the file):

```tsx
import { useDocExtractContext } from '@/lib/editor/doc-extract-context'
// …

const extractCtx = useDocExtractContext()

const canConvert = (() => {
  if (!extractCtx) return false
  if (editor.state.selection.empty) return false
  const { $from, $to } = editor.state.selection
  if ($from.parent !== $to.parent) return false
  let containsLink = false
  editor.state.doc.nodesBetween($from.pos, $to.pos, node => {
    if (node.marks.some(m => m.type.name === 'taskLink')) containsLink = true
  })
  return !containsLink
})()

// In the rendered menu:
<ToolbarButton
  onClick={async () => {
    if (!extractCtx) return
    try {
      const content = wrapSelectionWithExtractPending(editor)
      const res = await extractTasks(extractCtx.documentId, {
        content,
        selector: { type: 'marked' },
      })
      extractCtx.onApplied(res.updatedContent)
    } catch (err) {
      extractCtx.onError(err as Error)
    }
  }}
  disabled={!canConvert}
  ariaLabel={intl.formatMessage({ id: 'doc.extract.button.bubble' })}
>
  {intl.formatMessage({ id: 'doc.extract.button.bubble' })}
</ToolbarButton>
```

- [ ] **Step 2: Implement `wrapSelectionWithExtractPending`**

In a new helper file `app/workspace/[workspaceUrl]/components/extract/wrapSelection.ts`:

```ts
// wrapSelection.ts
import type { Editor } from '@tiptap/core'

/**
 * Serialize the editor to HTML with the current selection wrapped in
 * <span data-extract-pending="true">…</span>. Restores the editor to its
 * pre-call state immediately after serialization (no visible flicker).
 */
export function wrapSelectionWithExtractPending(editor: Editor): string {
  const { from, to } = editor.state.selection
  if (from === to) return editor.getHTML()

  const text = editor.state.doc.textBetween(from, to, '\n', '\n')
  const marker = `__EXTRACT_PENDING_${Date.now()}__`

  editor.chain().insertContentAt({ from, to }, marker).run()
  let html = editor.getHTML()
  editor
    .chain()
    .insertContentAt({ from, to: from + marker.length }, text)
    .run()

  html = html.replace(
    marker,
    `<span data-extract-pending="true">${text}</span>`
  )
  return html
}
```

- [ ] **Step 3: Smoke test in browser**

Run: `npm run dev` → open a doc, type some prose, select a few words → bubble menu shows "Convert to task" → click → expect that text becomes an `<a data-task-link>`.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx app/workspace/[workspaceUrl]/components/extract/wrapSelection.ts
git commit -m "feat: bubble-menu 'Convert to task' for selected text [LUM-91]"
```

---

### Task 13: Toolbar batch button + confirm dialog

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/extract/BatchExtractButton.tsx`
- Modify: `app/workspace/[workspaceUrl]/documents/[docId]/page.tsx`

- [ ] **Step 1: Implement the batch button**

```tsx
// BatchExtractButton.tsx
'use client'
import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import type { Editor } from '@tiptap/core'
import { useDocExtractContext } from '@/lib/editor/doc-extract-context'
import { extractTasks } from '@/lib/api-client/documents-extract'

function countUncheckedUnlinked(editor: Editor): number {
  let n = 0
  editor.state.doc.descendants(node => {
    if (node.type.name !== 'taskItem') return true
    if (node.attrs.checked) return false
    if (node.attrs.taskId) return false
    n += 1
    return false
  })
  return n
}

export function BatchExtractButton({ editor }: { editor: Editor }) {
  const ctx = useDocExtractContext()
  const intl = useIntl()
  const [count, setCount] = useState(() => countUncheckedUnlinked(editor))
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const update = () => setCount(countUncheckedUnlinked(editor))
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor])

  if (count === 0 || !ctx) return null

  async function go() {
    setPending(true)
    try {
      const res = await extractTasks(ctx!.documentId, {
        content: editor.getHTML(),
        selector: { type: 'all_unchecked' },
      })
      ctx!.onApplied(res.updatedContent)
    } catch (err) {
      ctx!.onError(err as Error)
    } finally {
      setPending(false)
      setConfirming(false)
    }
  }

  return (
    <>
      <button
        type='button'
        onClick={() => setConfirming(true)}
        className='inline-flex items-center gap-1 rounded border px-2 py-1 text-sm'
      >
        {intl.formatMessage({ id: 'doc.extract.button.batch' }, { count })}
      </button>
      {confirming && (
        <ConfirmDialog
          title={intl.formatMessage(
            { id: 'doc.extract.confirm.title' },
            { count }
          )}
          message={intl.formatMessage({ id: 'doc.extract.confirm.message' })}
          cta={intl.formatMessage({ id: 'doc.extract.confirm.cta' }, { count })}
          pending={pending}
          onCancel={() => setConfirming(false)}
          onConfirm={go}
        />
      )}
    </>
  )
}

function ConfirmDialog({
  title,
  message,
  cta,
  pending,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  cta: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      role='dialog'
      aria-modal='true'
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/30'
    >
      <div className='w-96 rounded bg-background p-4 shadow-lg'>
        <h2 className='mb-2 text-lg font-semibold'>{title}</h2>
        <p className='mb-4 text-sm text-muted-foreground'>{message}</p>
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={onCancel}
            disabled={pending}
            className='rounded border px-3 py-1 text-sm'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={onConfirm}
            disabled={pending}
            className='rounded bg-primary px-3 py-1 text-sm text-primary-foreground'
          >
            {cta}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount in the doc page**

In `app/workspace/[workspaceUrl]/documents/[docId]/page.tsx`, add `<BatchExtractButton editor={editor} />` to the top toolbar area (near the title / settings buttons).

- [ ] **Step 3: Smoke test**

Run: `npm run dev` → open a doc with at least 2 unchecked `[ ]` lines → the toolbar shows `Extract 2 unchecked` → click → confirm dialog appears → confirm → both rows become links.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/extract/BatchExtractButton.tsx app/workspace/[workspaceUrl]/documents/[docId]/page.tsx
git commit -m "feat: doc toolbar batch extract button + confirm [LUM-91]"
```

---

### Task 14: Toast wiring (success / skipped / error)

**Files:**

- Modify: `app/workspace/[workspaceUrl]/documents/[docId]/page.tsx`

- [ ] **Step 1: Implement an `onApplied` that surfaces toasts**

In the doc page where you wired `DocExtractProvider` earlier, expand the `onApplied` handler:

```tsx
const onApplied = (res: {
  updatedContent: string
  tasks: { identifier: string }[]
  skipped: { reason: string }[]
}) => {
  editor.commands.setContent(res.updatedContent, false)
  // Trigger save (existing doc save handler)
  saveDoc(res.updatedContent)

  toast.success(
    intl.formatMessage(
      { id: 'doc.extract.toast.success' },
      { count: res.tasks.length }
    )
  )
  const emptySkips = res.skipped.filter(s => s.reason === 'empty').length
  if (emptySkips > 0) {
    toast.info(
      intl.formatMessage(
        { id: 'doc.extract.toast.skipped_empty' },
        { count: emptySkips }
      )
    )
  }
  const truncated = res.skipped.filter(s => s.reason === 'too_long').length
  if (truncated > 0) {
    toast.info(
      intl.formatMessage(
        { id: 'doc.extract.toast.truncated' },
        { count: truncated }
      )
    )
  }
}
```

Note: this requires changing the context shape — `onApplied` now takes the full result object, not just `updatedContent`. Update `lib/editor/doc-extract-context.tsx`, `HoverExtractButton.tsx`, and `BatchExtractButton.tsx` to pass the full response object.

- [ ] **Step 2: Implement an `onError` that surfaces toasts**

```tsx
const onError = (err: Error) => {
  if (err instanceof ExtractTasksError) {
    if (err.code === 'MISSING_PROJECT') {
      toast.error(
        intl.formatMessage({ id: 'doc.extract.toast.error_no_project' })
      )
      return
    }
    if (err.status === 409) {
      // No candidates — happens if user clicks batch when nothing matches
      return
    }
  }
  toast.error(intl.formatMessage({ id: 'doc.extract.toast.error_unknown' }))
}
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev` → trigger each path (success, empty-skipped, no-project) → confirm toasts appear with correct text.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/[workspaceUrl]/documents/[docId]/page.tsx app/workspace/[workspaceUrl]/components/extract/
git commit -m "feat: toast wiring for doc extract success/skip/error states [LUM-91]"
```

---

## Phase 4 — i18n

### Task 15: Add `doc.extract.*` keys to every locale file

**Files:**

- Modify: `lib/i18n/en.json`, `zh-CN.json`, `zh-TW.json`, `ja.json`, `ko.json`, `de.json`, `fr.json`, `es.json`, `es-419.json`, `en-AU.json`, `en-GB.json`, `hi.json`, `id.json`, `ms.json`, `ru.json`, `vi.json`

Per CLAUDE.md: every locale gets a real translation. No English fallback.

- [ ] **Step 1: Add keys to `en.json`**

Add under the existing `doc` namespace (or top-level — match the file's existing structure):

```json
{
  "doc.extract.button.hover": "→ task",
  "doc.extract.button.bubble": "Convert to task",
  "doc.extract.button.batch": "Extract {count, plural, one {1 unchecked} other {# unchecked}}",
  "doc.extract.confirm.title": "Create {count, plural, one {1 task} other {# tasks}}?",
  "doc.extract.confirm.message": "Each task will be assigned to you with priority Low.",
  "doc.extract.confirm.cta": "Create {count, plural, one {task} other {# tasks}}",
  "doc.extract.toast.success": "Created {count, plural, one {1 task} other {# tasks}}.",
  "doc.extract.toast.skipped_empty": "Skipped {count, plural, one {1 empty item} other {# empty items}}.",
  "doc.extract.toast.truncated": "{count, plural, one {1 task had its title truncated} other {# tasks had their titles truncated}} — see task descriptions.",
  "doc.extract.toast.error_no_project": "This doc has no project. Tasks need a project — set one in doc settings.",
  "doc.extract.toast.error_unknown": "Could not extract tasks. Try again or refresh.",
  "doc.extract.linked_task_label": "Linked to {identifier}",
  "doc.extract.undo_warning": "Tasks are kept even if you undo. Remove them in the task list."
}
```

- [ ] **Step 2: Add the same keys to every other locale file**

For each of the 15 non-English locales, add the same keys with a proper translation. Acceptable approaches:

- Hand-translate using domain knowledge for the languages you read
- LLM-assist for languages you don't read, but **read the output back** and sanity-check the ICU plural syntax is preserved

Example for `zh-CN.json`:

```json
{
  "doc.extract.button.hover": "→ 任务",
  "doc.extract.button.bubble": "转为任务",
  "doc.extract.button.batch": "提取 {count} 个未完成项",
  "doc.extract.confirm.title": "创建 {count} 个任务？",
  "doc.extract.confirm.message": "每个任务都会指派给你，优先级 Low。",
  "doc.extract.confirm.cta": "创建 {count} 个任务",
  "doc.extract.toast.success": "已创建 {count} 个任务。",
  "doc.extract.toast.skipped_empty": "跳过了 {count} 个空白项。",
  "doc.extract.toast.truncated": "{count} 个任务的标题被截断 —— 完整内容见任务详情。",
  "doc.extract.toast.error_no_project": "此文档没有所属项目。请先在文档设置里设置项目。",
  "doc.extract.toast.error_unknown": "提取失败，请重试或刷新。",
  "doc.extract.linked_task_label": "已关联到 {identifier}",
  "doc.extract.undo_warning": "撤销不会删除已创建的任务，请去任务列表删除。"
}
```

- [ ] **Step 3: Run the locale-parity test**

The codebase has `__tests__/i18n-locale-parity.test.ts` which enforces every locale has the same key set.

Run: `npx jest __tests__/i18n-locale-parity.test.ts`
Expected: PASS — no missing-key errors across locales.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n/
git commit -m "feat: i18n keys for doc extract feature across 16 locales [LUM-91]"
```

---

## Phase 5 — Polish

### Task 16: Undo-warning toast (fire once per session)

**Files:**

- Modify: `lib/editor/doc-extract-context.tsx`
- Modify: `app/workspace/[workspaceUrl]/documents/[docId]/page.tsx`

- [ ] **Step 1: Track first-extract-of-session in component state**

In the doc page, add a `useRef<boolean>(false)` for `hasShownUndoWarning`. In `onApplied`, before showing the success toast, if the ref is false, show the undo-warning toast and set the ref to true.

```tsx
const hasShownUndoWarning = useRef(false)

// inside onApplied, before toast.success:
if (!hasShownUndoWarning.current) {
  toast.info(intl.formatMessage({ id: 'doc.extract.undo_warning' }), {
    duration: 6000,
  })
  hasShownUndoWarning.current = true
}
```

- [ ] **Step 2: Smoke test**

Open a doc, extract once → undo-warning shows. Extract again → no warning (only success toast).

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/documents/[docId]/page.tsx
git commit -m "feat: one-time undo warning toast on first extract per session [LUM-91]"
```

---

### Task 17: SKILL.md doc sync

Per CLAUDE.md's "CLI & Skills 同步" rule: if `cli/src/commands/` changed → `.claude/skills/lumo/SKILL.md` updated. This feature does NOT add a CLI command (V2 only), so no SKILL.md update is required for V1. This task documents the explicit "no change" decision so the implementer doesn't search for it.

- [ ] **Step 1: Verify no CLI files changed in this branch**

Run: `git diff origin/main..HEAD -- cli/src/commands/ | wc -l`
Expected: 0.

- [ ] **Step 2: If non-zero, ABORT** — a CLI command crept in. Per the spec, CLI is V2. Either remove the CLI changes or extend this plan with a SKILL.md update task.

(No commit; this is a verification gate.)

---

## Self-Review Notes (from plan author)

- **Spec coverage:** §1 Overview ↔ task 5 (orchestrator), §3 User Flows A/B/C ↔ tasks 11/12/13, §4 Data Model ↔ tasks 5 (mention insertion) + 9 (TaskItem attrs), §5 API ↔ tasks 6 + 7, §6 Service Layer ↔ tasks 3+4+5, §7 HTML Transformation ↔ task 4, §8 Front-end ↔ tasks 8+9+10+11+12+13, §9 Edge Cases ↔ tests in tasks 5 + 6 + 14, §10 i18n ↔ task 15, §11 Testing ↔ tests interleaved throughout, §12 Risks ↔ task 16 (undo warning) + monitoring deferred to ops, §13 Implementation Order ↔ followed.
- **Open question 1 (toggle checkbox on extract?)**: Spec answers (a) — no, leave unchecked. Task 9's CSS hides the checkbox entirely instead. Plan honors the spec answer.
- **Open question 2 (nested taskList in blockquotes/lists)**: Selector in task 3 is unscoped (`li[data-type="taskItem"][data-checked="false"]`) — `node-html-parser` handles depth natively. Covered.
- **Open question 3 (preview list in confirm dialog)**: Spec says no for V1. Task 13's ConfirmDialog shows count only. Honored.

---

## Verification before declaring done

Run the full test suite:

```bash
npm test
```

Expected: green. New files contribute:

- `__tests__/extract-tasks-schema.test.ts` (5 cases)
- `__tests__/services/document-task-extraction.test.ts` (~10 cases)
- `__tests__/api/documents-extract-tasks.test.ts` (5 cases)
- `__tests__/components/extract-rendering.test.tsx` (1 case)
- `__tests__/i18n-locale-parity.test.ts` (existing — should still pass)

Run type check:

```bash
npx tsc --noEmit
```

Expected: 0 errors.

Manual smoke against `npm run dev`:

1. Open a doc with multiple `[ ]` lines
2. Hover one → click `→ task` → row becomes link, task appears in `lumo task list`
3. Select prose text → bubble menu "Convert to task" → text becomes link, new task appears
4. Click toolbar `Extract N unchecked` → confirm → all remaining unchecked rows become links
5. Try on a doc with `projectId === null` → expect the "Set project" toast
6. Cmd+Z after extract → row visually reverts but `lumo task list` still shows the task

If all 6 pass → ready to ship.
