# Task Description Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix CLI-created task descriptions that collapse into a single `<p>` by normalizing markdown → HTML on every write and exposing `descriptionMarkdown` on CLI-facing read responses; backfill the already-flattened tasks.

**Architecture:** Server-side embedded conversion. `normalizeRichText()` runs on every task description write (always emits HTML, idempotent for HTML input). `withMarkdown()` adds a sibling `descriptionMarkdown` to CLI-facing responses (`/api/tasks/by-identifier/[id]` and `/api/tasks/context/[id]`). A one-shot script backfills tasks whose stored HTML is a single `<p>` wrapper around still-markdown text.

**Tech Stack:** TypeScript / Next.js / Prisma / Jest. Existing `lib/utils/markdown.ts` already exposes `markdownToHtml`, `htmlToMarkdown`, `isHtml`, `isMarkdown` — we build on top.

**Spec refinement:** The spec referenced `/api/tasks/:id` for the read path, but CLI traffic actually flows through `/api/tasks/by-identifier/[id]` (handled by `taskCliService.showFromCli`) and `/api/tasks/context/[id]`. The plan targets those two paths and leaves the web-only `/api/tasks/[id]` untouched.

---

## File Structure

**New files:**

- `lib/services/task-rendering.ts` — `withMarkdown()` helper, ~20 LOC, sole responsibility: enrich a task object with `descriptionMarkdown`.
- `scripts/backfill-task-descriptions.ts` — one-shot CLI script, dry-run by default, requires `--apply` to write. Self-contained.
- `__tests__/lib/services/task-rendering.test.ts` — unit tests for `withMarkdown`.
- `__tests__/scripts/backfill-task-descriptions.test.ts` — unit tests for the pure decision/rebuild helpers.
- `__tests__/cli/task-show-format.test.ts` — unit tests for `formatTaskShow` preferring `descriptionMarkdown`.

**Extended files (append to existing test files):**

- `__tests__/lib/utils/markdown.test.ts` — `normalizeRichText` cases.
- `__tests__/lib/services/task-state.service.test.ts` — verify normalization on update.
- `__tests__/api-tasks-create.test.ts` — verify normalization on create.
- `__tests__/cli/task-context-format.test.ts` — verify markdown preference (file already exists; append).

**Modified non-test files (precise minimal edits):**

- `lib/utils/markdown.ts` — add `normalizeRichText` + private `looksLikeHtmlDocument`.
- `lib/services/task-creation.service.ts` — 1 line (line 107).
- `lib/services/task-state.service.ts` — 1 line (line 151).
- `lib/services/task-cli.service.ts` — extend `ShowTaskFromCliResult` interface + 1 line in `showFromCli` return.
- `lib/services/task-context.service.ts` — wrap the returned `task` object with `withMarkdown(...)`.
- `cli/src/commands/task-show.ts` — extend `ShowResponse` interface + `??` fallback in `formatTaskShow`.
- `cli/src/commands/task-context.ts` — extend `TaskContextResponse` interface + `??` fallback in `formatTaskContextMarkdown`.

---

## Task 1: Add `normalizeRichText` to `lib/utils/markdown.ts`

**Files:**

- Modify: `lib/utils/markdown.ts`
- Test: `__tests__/lib/utils/markdown.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe('markdown utils', ...)` block in `__tests__/lib/utils/markdown.test.ts`:

```ts
import { normalizeRichText } from '@/lib/utils/markdown'

describe('normalizeRichText', () => {
  it('returns null for null / undefined / empty / whitespace', () => {
    expect(normalizeRichText(null)).toBeNull()
    expect(normalizeRichText(undefined)).toBeNull()
    expect(normalizeRichText('')).toBeNull()
    expect(normalizeRichText('   \n  ')).toBeNull()
  })

  it('converts plain markdown to HTML', () => {
    // marked is mocked at the top of this file to return `<p>${input}</p>`
    const result = normalizeRichText('## Heading')
    expect(result).toContain('<p>')
    expect(result).toContain('## Heading')
  })

  it('passes through input that starts with a structural HTML tag', () => {
    const html = '<p>already html</p>'
    expect(normalizeRichText(html)).toBe(html)
  })

  it('passes through HTML with leading whitespace and attributes', () => {
    const html = '   <div class="x">x</div>'
    expect(normalizeRichText(html)).toBe(html)
  })

  it('treats markdown that mentions <p> as markdown (not HTML)', () => {
    // The body is markdown narrative that references the <p> tag literally.
    // The stricter looksLikeHtmlDocument check should NOT match.
    const input = 'wrapped in a single `<p>` tag'
    const result = normalizeRichText(input)
    expect(result).toContain('<p>') // marked mock wraps everything
    expect(result).toContain('`<p>`') // original content preserved
  })

  it('is idempotent for Web-written HTML through a round-trip', () => {
    // Simulate Tiptap output: structural HTML at start.
    const tiptap = '<p>hello <strong>world</strong></p>'
    const once = normalizeRichText(tiptap)
    const twice = normalizeRichText(once)
    expect(twice).toBe(once)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/utils/markdown.test.ts`
Expected: FAIL — `normalizeRichText` not exported.

- [ ] **Step 3: Implement `normalizeRichText` + private `looksLikeHtmlDocument`**

Append to `lib/utils/markdown.ts`:

```ts
/**
 * Stricter HTML detection used only for the rich-text-write path.
 * Matches strings that *begin* with a block tag (Tiptap output, pasted
 * HTML), so a markdown body that merely mentions a tag inline (e.g.
 * "wrapped in `<p>`") is NOT mistaken for HTML.
 *
 * Kept private to this module — the existing `isHtml` is more permissive
 * and is intentionally left untouched for the document path.
 */
function looksLikeHtmlDocument(text: string): boolean {
  return /^\s*<(p|div|h[1-6]|ul|ol|pre|blockquote|table|img)\b[^>]*>/i.test(
    text
  )
}

/**
 * Normalize a rich-text field for storage in a Tiptap-backed column.
 *
 * - null / undefined / blank input → null (unifies "clear" semantics).
 * - Input that looks like a structural HTML document → returned as-is.
 * - Anything else → markdown → HTML via `markdownToHtml`.
 *
 * Idempotent for Web-written HTML, so Web round-trips don't drift.
 */
export function normalizeRichText(
  input: string | null | undefined
): string | null {
  if (input == null) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  if (looksLikeHtmlDocument(trimmed)) return trimmed
  return markdownToHtml(trimmed)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/utils/markdown.test.ts`
Expected: PASS (all 4 prior + 6 new cases).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/markdown.ts __tests__/lib/utils/markdown.test.ts
git commit -m "feat: add normalizeRichText for task description normalization [LUM-107]"
```

---

## Task 2: Wire `normalizeRichText` into task creation

**Files:**

- Modify: `lib/services/task-creation.service.ts:107`
- Test: `__tests__/api-tasks-create.test.ts` (append)

- [ ] **Step 1: Write a failing test**

Read `__tests__/api-tasks-create.test.ts` to see the existing mocking pattern, then append a new `describe('description normalization', ...)` block at the end. The test must:

- mock `taskRepository.createWithSequence` with a `jest.fn()` you can inspect,
- call `createTask(...)` with `description: '## Heading\n- item'`,
- assert the `description` field passed to `createWithSequence` was normalized (contains `<p>` from the marked mock, not the raw markdown markers verbatim).

Skeleton:

```ts
describe('createTask description normalization', () => {
  it('normalizes markdown description to HTML before persisting', async () => {
    // Reuse the existing setup pattern from this test file
    const createMock = jest.fn().mockResolvedValue({
      id: 't1',
      identifier: 'LUM-1',
      teamIdentifier: 'LUM',
      number: 1,
      title: 'x',
      teamId: 'team1',
    })
    ;(taskRepository.createWithSequence as jest.Mock) = createMock

    await createTask(
      'proj1',
      {
        title: 't',
        description: '## Heading\n- item',
        status: 'TODO',
        priority: 'LOW',
      },
      'actor1',
      'clerk1'
    )

    const passed = createMock.mock.calls[0][0]
    expect(passed.description).toMatch(/<p>/)
    expect(passed.description).not.toBe('## Heading\n- item')
  })

  it('clears description when input is empty string', async () => {
    const createMock = jest.fn().mockResolvedValue({
      id: 't1',
      identifier: 'LUM-1',
      teamIdentifier: 'LUM',
      number: 1,
      title: 'x',
      teamId: 'team1',
    })
    ;(taskRepository.createWithSequence as jest.Mock) = createMock

    await createTask(
      'proj1',
      {
        title: 't',
        description: '',
        status: 'TODO',
        priority: 'LOW',
      },
      'actor1',
      'clerk1'
    )

    expect(createMock.mock.calls[0][0].description).toBeNull()
  })
})
```

If the existing file does not import `taskRepository` or `createTask`, add them. Mock `marked` at top-of-file with the same pattern used in `__tests__/lib/utils/markdown.test.ts` — that test mocks `marked.parse` to return `\`<p>${input}</p>\``.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api-tasks-create.test.ts -t 'description normalization'`
Expected: FAIL — first test fails because raw markdown still passes through; second fails because empty string isn't normalized to null.

- [ ] **Step 3: Edit `lib/services/task-creation.service.ts`**

Add the import (near the top of the file, with the other imports):

```ts
import { normalizeRichText } from '@/lib/utils/markdown'
```

Change line 107 from:

```ts
    description: description ?? null,
```

to:

```ts
    description: normalizeRichText(description),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api-tasks-create.test.ts`
Expected: PASS, including the new normalization tests and all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-creation.service.ts __tests__/api-tasks-create.test.ts
git commit -m "feat: normalize task description on create [LUM-107]"
```

---

## Task 3: Wire `normalizeRichText` into task updates

**Files:**

- Modify: `lib/services/task-state.service.ts:151`
- Test: `__tests__/lib/services/task-state.service.test.ts` (append)

- [ ] **Step 1: Write a failing test**

Append to the existing `describe(...)` block in `__tests__/lib/services/task-state.service.test.ts`. Reuse the existing mock setup at the top of the file (already mocks `taskRepository.update`).

```ts
describe('updateTask description normalization', () => {
  beforeEach(() => {
    ;(taskRepository.findForUpdate as jest.Mock).mockResolvedValue({
      id: 't1',
      project: { workspaceId: 'w1' },
      status: 'TODO',
      assigneeActorId: null,
    })
    ;(taskRepository.update as jest.Mock).mockResolvedValue({
      id: 't1',
      identifier: 'LUM-1',
      title: 't',
    })
  })

  it('converts markdown description to HTML before update', async () => {
    await updateTask('t1', { description: '## H' }, 'actor1', 'clerk1')
    const data = (taskRepository.update as jest.Mock).mock.calls[0][1]
    expect(data.description).toMatch(/<p>/)
  })

  it('clears description when set to empty string', async () => {
    await updateTask('t1', { description: '' }, 'actor1', 'clerk1')
    const data = (taskRepository.update as jest.Mock).mock.calls[0][1]
    expect(data.description).toBeNull()
  })

  it('passes through HTML descriptions unchanged', async () => {
    const html = '<p>already html</p>'
    await updateTask('t1', { description: html }, 'actor1', 'clerk1')
    const data = (taskRepository.update as jest.Mock).mock.calls[0][1]
    expect(data.description).toBe(html)
  })
})
```

You will likely need to mock `marked` at the top of this file too (copy the `jest.mock('marked', ...)` block from `__tests__/lib/utils/markdown.test.ts`). Verify the existing test file does not already use `marked` to render — if it does, leave the existing mock and just augment behavior.

Also import the `updateTask` function and `taskRepository` reference if not already imported in this file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/services/task-state.service.test.ts -t 'description normalization'`
Expected: FAIL — current code passes `rest.description` through verbatim.

- [ ] **Step 3: Edit `lib/services/task-state.service.ts`**

Add the import (top of file with other imports):

```ts
import { normalizeRichText } from '@/lib/utils/markdown'
```

Change line 151 from:

```ts
if (rest.description !== undefined) data.description = rest.description
```

to:

```ts
if (rest.description !== undefined)
  data.description = normalizeRichText(rest.description)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/services/task-state.service.test.ts`
Expected: PASS (3 new cases + pre-existing suite).

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-state.service.ts __tests__/lib/services/task-state.service.test.ts
git commit -m "feat: normalize task description on update [LUM-107]"
```

---

## Task 4: Create `withMarkdown` helper

**Files:**

- Create: `lib/services/task-rendering.ts`
- Test: `__tests__/lib/services/task-rendering.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/services/task-rendering.test.ts`:

```ts
jest.mock('turndown', () => {
  return jest.fn().mockImplementation(() => ({
    turndown: (html: string) => html.replace(/<p>(.*?)<\/p>/g, '$1'),
  }))
})

import { withMarkdown } from '@/lib/services/task-rendering'

describe('withMarkdown', () => {
  it('adds descriptionMarkdown derived from description HTML', () => {
    const out = withMarkdown({ id: 't1', description: '<p>hello</p>' })
    expect(out.descriptionMarkdown).toBe('hello')
    expect(out.description).toBe('<p>hello</p>')
    expect(out.id).toBe('t1')
  })

  it('emits null descriptionMarkdown when description is null', () => {
    const out = withMarkdown({ id: 't1', description: null })
    expect(out.descriptionMarkdown).toBeNull()
    expect(out.description).toBeNull()
  })

  it('preserves all other fields on the input', () => {
    const out = withMarkdown({
      id: 't1',
      description: '<p>x</p>',
      title: 'T',
      status: 'TODO',
    })
    expect(out.title).toBe('T')
    expect(out.status).toBe('TODO')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/task-rendering.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/services/task-rendering.ts`**

```ts
import { htmlToMarkdown } from '@/lib/utils/markdown'

/**
 * Enrich a task DTO with a `descriptionMarkdown` sibling field rendered
 * from the stored HTML. Leaves `description` (HTML) untouched so Web
 * callers continue to feed it straight into Tiptap.
 *
 * Generic over the input shape so service-layer callers can pipe the
 * raw task entity through without losing field-level types.
 */
export function withMarkdown<T extends { description: string | null }>(
  task: T
): T & { descriptionMarkdown: string | null } {
  return {
    ...task,
    descriptionMarkdown: task.description
      ? htmlToMarkdown(task.description)
      : null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/task-rendering.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-rendering.ts __tests__/lib/services/task-rendering.test.ts
git commit -m "feat: add withMarkdown render helper [LUM-107]"
```

---

## Task 5: Expose `descriptionMarkdown` in CLI `task show` response

**Files:**

- Modify: `lib/services/task-cli.service.ts` (extend `ShowTaskFromCliResult` + `showFromCli` return at line 416)
- Test: `__tests__/task-cli.service.show.test.ts` (append)

- [ ] **Step 1: Write a failing test**

Append to `__tests__/task-cli.service.show.test.ts`:

```ts
describe('showFromCli descriptionMarkdown', () => {
  it('includes descriptionMarkdown derived from the stored HTML', async () => {
    // Reuse the existing test setup that returns a task with HTML description.
    // After the change, the returned object should also have descriptionMarkdown.
    const result = await taskCliService.showFromCli({
      workspaceId: 'w1',
      workspaceSlug: 'ws',
      identifier: 'LUM-1',
    })
    expect(result).toHaveProperty('descriptionMarkdown')
    if (result.description) {
      expect(typeof result.descriptionMarkdown).toBe('string')
    }
  })
})
```

If the existing test file already constructs the mocked `detail` with a `description` field, this test will pass shape-wise but reveal the missing field. Otherwise, adjust the mocked `taskService.getTaskDetail` to return a `description: '<p>hello</p>'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/task-cli.service.show.test.ts -t 'descriptionMarkdown'`
Expected: FAIL — `descriptionMarkdown` property missing.

- [ ] **Step 3: Modify `lib/services/task-cli.service.ts`**

Add at the top with other imports:

```ts
import { withMarkdown } from '@/lib/services/task-rendering'
```

Extend the `ShowTaskFromCliResult` interface (around line 350) by adding `descriptionMarkdown` next to `description`:

```ts
export interface ShowTaskFromCliResult {
  id: string
  identifier: string
  title: string
  status: string
  priority: string
  description: string | null
  descriptionMarkdown: string | null
  url: string
  sprintId: string | null
  teamId: string
  project: { id: string; name: string }
  assignee: {
    type: 'member' | 'agent'
    label: string
    email: string | null
  } | null
}
```

Change the return at line 410 from:

```ts
return {
  id: detail.id,
  identifier: resolved.identifier,
  title: detail.title,
  status: detail.status,
  priority: detail.priority,
  description: detail.description,
  url,
  sprintId: detail.sprintId ?? null,
  teamId: detail.teamId,
  project: { id: detail.project.id, name: detail.project.name },
  assignee,
}
```

to:

```ts
return withMarkdown({
  id: detail.id,
  identifier: resolved.identifier,
  title: detail.title,
  status: detail.status,
  priority: detail.priority,
  description: detail.description,
  url,
  sprintId: detail.sprintId ?? null,
  teamId: detail.teamId,
  project: { id: detail.project.id, name: detail.project.name },
  assignee,
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/task-cli.service.show.test.ts`
Expected: PASS — new case plus all pre-existing.

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-cli.service.ts __tests__/task-cli.service.show.test.ts
git commit -m "feat: emit descriptionMarkdown from CLI show endpoint [LUM-107]"
```

---

## Task 6: Expose `descriptionMarkdown` in task context

**Files:**

- Modify: `lib/services/task-context.service.ts:318`
- Test: existing tests in `__tests__/cli/task-context-format.test.ts` cover the CLI render; add a server-side assertion in `__tests__/services/` or rely on Task 4's helper test.

- [ ] **Step 1: Write a failing test**

Create `__tests__/services/task-context-description-markdown.test.ts`:

```ts
jest.mock('turndown', () => {
  return jest.fn().mockImplementation(() => ({
    turndown: (html: string) => html.replace(/<p>(.*?)<\/p>/g, '$1'),
  }))
})

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn().mockResolvedValue([]),
    findActiveProjectMemories: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: { listForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn().mockResolvedValue({
      id: 't1',
      identifier: 'LUM-1',
    }),
  },
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { taskContextService } from '@/lib/services/task-context.service'

describe('task-context descriptionMarkdown', () => {
  it('returns descriptionMarkdown alongside description', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      title: 'T',
      status: 'TODO',
      description: '<p>body</p>',
      milestoneId: null,
      projectId: 'p1',
    })

    const result = await taskContextService.getContextForIdentifier(
      'w1',
      'm1',
      'LUM-1'
    )
    expect(result).not.toBeNull()
    expect(result!.task.description).toBe('<p>body</p>')
    expect(result!.task.descriptionMarkdown).toBe('body')
  })

  it('returns null descriptionMarkdown when description is null', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      title: 'T',
      status: 'TODO',
      description: null,
      milestoneId: null,
      projectId: 'p1',
    })

    const result = await taskContextService.getContextForIdentifier(
      'w1',
      'm1',
      'LUM-1'
    )
    expect(result!.task.descriptionMarkdown).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/services/task-context-description-markdown.test.ts`
Expected: FAIL — `descriptionMarkdown` property does not exist on the returned `task`.

- [ ] **Step 3: Modify `lib/services/task-context.service.ts`**

Add the import near the top:

```ts
import { htmlToMarkdown } from '@/lib/utils/markdown'
```

Extend the `TaskContext.task` interface (lines 29-41) by adding `descriptionMarkdown: string | null` immediately after `description: string | null`:

```ts
export interface TaskContext {
  task: {
    id: string
    identifier: string
    title: string
    status: string
    description: string | null
    descriptionMarkdown: string | null
    milestone: {
      id: string
      name: string
      status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
      targetDate: string | null
    } | null
  }
  // ... rest unchanged
}
```

In the `return` block of `getContextForIdentifier` (line 318), change:

```ts
      task: {
        id: full.id,
        identifier: resolved.identifier,
        title: full.title,
        status: full.status,
        description: full.description,
        milestone: ...
      },
```

to:

```ts
      task: {
        id: full.id,
        identifier: resolved.identifier,
        title: full.title,
        status: full.status,
        description: full.description,
        descriptionMarkdown: full.description
          ? htmlToMarkdown(full.description)
          : null,
        milestone: ...
      },
```

We render here rather than via `withMarkdown` because the surrounding object shape is bespoke (`milestone`, etc.) — duplicating one line is clearer than a typed cast.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/services/task-context-description-markdown.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-context.service.ts __tests__/services/task-context-description-markdown.test.ts
git commit -m "feat: emit descriptionMarkdown in task context [LUM-107]"
```

---

## Task 7: CLI `task show` prefers `descriptionMarkdown`

**Files:**

- Modify: `cli/src/commands/task-show.ts`
- Test: `__tests__/cli/task-show-format.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/task-show-format.test.ts`:

```ts
import { formatTaskShow } from '@/cli/src/commands/task-show'

const base = {
  id: 't1',
  identifier: 'LUM-1',
  title: 'T',
  status: 'TODO',
  priority: 'LOW',
  url: 'https://example.com/LUM-1',
  project: { id: 'p1', name: 'P' },
  assignee: null,
}

describe('formatTaskShow', () => {
  it('prefers descriptionMarkdown when available', () => {
    const out = formatTaskShow({
      ...base,
      description: '<p>html body</p>',
      descriptionMarkdown: '## md heading',
    } as any)
    expect(out).toContain('## md heading')
    expect(out).not.toContain('<p>html body</p>')
  })

  it('falls back to description when descriptionMarkdown is absent', () => {
    const out = formatTaskShow({
      ...base,
      description: 'plain body',
    } as any)
    expect(out).toContain('plain body')
  })

  it('omits Description block when both fields are empty', () => {
    const out = formatTaskShow({
      ...base,
      description: null,
      descriptionMarkdown: null,
    } as any)
    expect(out).not.toContain('Description:')
  })
})
```

Verify `jest.config.js` resolves `@/cli/...` paths — if not, change the import to a relative path: `import { formatTaskShow } from '../../cli/src/commands/task-show'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/task-show-format.test.ts`
Expected: FAIL — first test fails because the current code reads `description` only.

- [ ] **Step 3: Modify `cli/src/commands/task-show.ts`**

Extend `ShowResponse.task` to include the new field:

```ts
interface ShowResponse {
  task: {
    id: string
    identifier: string
    title: string
    status: string
    priority: string
    description: string | null
    descriptionMarkdown?: string | null
    url: string
    project: { id: string; name: string }
    assignee: {
      type: 'member' | 'agent'
      label: string
      email: string | null
    } | null
  }
}
```

Change the body of `formatTaskShow` so the rendered text prefers markdown:

```ts
const body = task.descriptionMarkdown ?? task.description
if (body && body.trim().length > 0) {
  lines.push('')
  lines.push('Description:')
  for (const line of body.split('\n')) {
    lines.push(`  ${line}`)
  }
}
```

(Replaces the existing `if (task.description && ...)` block at line 42.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/task-show-format.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/task-show.ts __tests__/cli/task-show-format.test.ts
git commit -m "feat(cli): task show prefers descriptionMarkdown [LUM-107]"
```

---

## Task 8: CLI `task context` prefers `descriptionMarkdown`

**Files:**

- Modify: `cli/src/commands/task-context.ts`
- Test: `__tests__/cli/task-context-format.test.ts` (append)

- [ ] **Step 1: Write a failing test**

Append to `__tests__/cli/task-context-format.test.ts`:

```ts
describe('formatTaskContextMarkdown descriptionMarkdown', () => {
  it('prefers descriptionMarkdown over description', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'T',
          status: 'TODO',
          description: '<p>html</p>',
          descriptionMarkdown: '## md',
        },
        sessions: [],
      } as any,
      new Date('2026-05-28T00:00:00Z')
    )
    expect(out).toContain('## md')
    expect(out).not.toContain('<p>html</p>')
  })

  it('falls back to description when descriptionMarkdown missing', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'T',
          status: 'TODO',
          description: 'plain body',
        },
        sessions: [],
      } as any,
      new Date('2026-05-28T00:00:00Z')
    )
    expect(out).toContain('plain body')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/task-context-format.test.ts -t 'descriptionMarkdown'`
Expected: FAIL — current code reads `description` only.

- [ ] **Step 3: Modify `cli/src/commands/task-context.ts`**

Extend `TaskContextResponse.task` to include the new field (line 5-17 area):

```ts
  task: {
    id?: string
    identifier: string
    title: string
    status: string
    description: string | null
    descriptionMarkdown?: string | null
    milestone?: { ... } | null
  }
```

Change line 106-108 from:

```ts
if (data.task.description && data.task.description.trim().length > 0) {
  lines.push(`**Description**: ${data.task.description}`)
}
```

to:

```ts
const body = data.task.descriptionMarkdown ?? data.task.description
if (body && body.trim().length > 0) {
  lines.push(`**Description**: ${body}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/task-context-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/task-context.ts __tests__/cli/task-context-format.test.ts
git commit -m "feat(cli): task context prefers descriptionMarkdown [LUM-107]"
```

---

## Task 9: Backfill script — pure helpers (`shouldBackfill`, `rebuild`)

**Files:**

- Create: `scripts/backfill-task-descriptions.ts`
- Test: `__tests__/scripts/backfill-task-descriptions.test.ts`

We split the work: Task 9 lands the pure helpers and unit tests; Task 10 wires them into the actual `prisma.task` scan + `--apply` flow.

- [ ] **Step 1: Write the failing test**

Create `__tests__/scripts/backfill-task-descriptions.test.ts`:

```ts
jest.mock('marked', () => ({
  marked: { parse: jest.fn((md: string) => `<p>MD:${md}</p>`) },
}))

import { shouldBackfill, rebuild } from '@/scripts/backfill-task-descriptions'

describe('shouldBackfill', () => {
  it('matches a single <p> wrapping markdown markers', () => {
    expect(shouldBackfill('<p>## heading inside</p>')).toBe(true)
    expect(shouldBackfill('<p>- list item</p>')).toBe(true)
    expect(shouldBackfill('<p>**bold** word</p>')).toBe(true)
  })

  it('rejects null / empty', () => {
    expect(shouldBackfill(null)).toBe(false)
    expect(shouldBackfill('')).toBe(false)
  })

  it('rejects properly structured HTML', () => {
    expect(shouldBackfill('<h2>Heading</h2><p>body</p>')).toBe(false)
    expect(shouldBackfill('<p>line1</p><p>line2</p>')).toBe(false)
    expect(shouldBackfill('<ul><li>a</li></ul>')).toBe(false)
  })

  it('rejects single <p> without markdown markers', () => {
    expect(shouldBackfill('<p>plain prose with no markers</p>')).toBe(false)
  })

  it('rejects single <p> that contains nested block tags', () => {
    expect(shouldBackfill('<p>text <ul><li>x</li></ul></p>')).toBe(false)
  })
})

describe('rebuild', () => {
  it('decodes HTML entities then runs markdownToHtml', () => {
    // Inner contains an HTML entity for `<` that should be decoded back first.
    const out = rebuild('<p>&lt;p&gt; was the wrapper, ## heading</p>')
    expect(out).toContain('MD:<p> was the wrapper, ## heading')
  })

  it('handles all five entities &amp; &lt; &gt; &quot; &#39;', () => {
    const out = rebuild(`<p>&amp; &lt; &gt; &quot; &#39;</p>`)
    expect(out).toContain('& < > " \'')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/scripts/backfill-task-descriptions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `scripts/backfill-task-descriptions.ts` (helpers only for now)**

```ts
/**
 * One-shot script to recover task descriptions that were stored as a
 * single <p> wrapping still-markdown text. Run with --apply to write;
 * default is dry-run.
 *
 * Authorization is required before --apply against prod (same gate as
 * `prisma migrate deploy`).
 */
import { markdownToHtml, isMarkdown } from '@/lib/utils/markdown'

const SINGLE_P = /^\s*<p>([\s\S]+)<\/p>\s*$/i
const NESTED_BLOCK = /<(p|div|h[1-6]|ul|ol|li|pre|blockquote|table)\b/i

export function shouldBackfill(html: string | null): boolean {
  if (!html) return false
  const single = SINGLE_P.exec(html)
  if (!single) return false
  const inner = single[1]
  if (NESTED_BLOCK.test(inner)) return false
  return isMarkdown(inner)
}

export function rebuild(html: string): string {
  const match = SINGLE_P.exec(html)
  if (!match) return html
  const decoded = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return markdownToHtml(decoded)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/scripts/backfill-task-descriptions.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-task-descriptions.ts __tests__/scripts/backfill-task-descriptions.test.ts
git commit -m "feat: backfill script — pure helpers [LUM-107]"
```

---

## Task 10: Backfill script — driver (dry-run + `--apply`)

**Files:**

- Modify: `scripts/backfill-task-descriptions.ts`

This task adds the I/O around the helpers. The driver does not get unit tests — its safety net is the dry-run default plus a sample print.

- [ ] **Step 1: Append the driver to `scripts/backfill-task-descriptions.ts`**

```ts
import { prisma } from '@/lib/db/prisma'

async function main() {
  const apply = process.argv.includes('--apply')
  const mode = apply ? 'APPLY' : 'DRY-RUN'
  // eslint-disable-next-line no-console
  console.log(`Mode: ${mode}`)

  const tasks = await prisma.task.findMany({
    select: { id: true, identifier: true, description: true },
  })

  const hits: Array<{
    id: string
    identifier: string
    before: string
    after: string
  }> = []
  for (const t of tasks) {
    if (!shouldBackfill(t.description)) continue
    hits.push({
      id: t.id,
      identifier: t.identifier,
      before: t.description!,
      after: rebuild(t.description!),
    })
  }

  // eslint-disable-next-line no-console
  console.log(`Matched: ${hits.length} / ${tasks.length}`)

  // Print up to 5 sample diffs so a human can sanity-check before --apply.
  for (const h of hits.slice(0, 5)) {
    // eslint-disable-next-line no-console
    console.log(`\n--- ${h.identifier} ---`)
    // eslint-disable-next-line no-console
    console.log('BEFORE:', h.before.slice(0, 200))
    // eslint-disable-next-line no-console
    console.log('AFTER :', h.after.slice(0, 200))
  }

  if (!apply) {
    // eslint-disable-next-line no-console
    console.log('\nRe-run with --apply to write changes.')
    return
  }

  let ok = 0
  const failed: string[] = []
  for (const h of hits) {
    try {
      await prisma.task.update({
        where: { id: h.id },
        data: { description: h.after },
      })
      // eslint-disable-next-line no-console
      console.log(`Updated ${h.identifier}`)
      ok++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push(`${h.identifier}: ${msg}`)
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `\nDone. Updated ${ok}. Skipped ${tasks.length - hits.length} (no marker / already structured). Failed ${failed.length}.`
  )
  for (const f of failed) {
    // eslint-disable-next-line no-console
    console.error(`  ${f}`)
  }
}

main()
  .catch(err => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Local dry-run against `.env.local`**

Run: `npx tsx scripts/backfill-task-descriptions.ts`
Expected: prints `Mode: DRY-RUN`, then `Matched: N / M`, then up to 5 sample diffs, ending with the "Re-run with --apply" hint. **No DB writes.** If any sample diff looks wrong, stop and investigate.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-task-descriptions.ts
git commit -m "feat: backfill script driver [LUM-107]"
```

---

## Task 11: End-to-end verification (local)

No code changes — exercise the feature end-to-end before opening the PR.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (in a separate terminal). Wait until it logs `Ready in ...`.

- [ ] **Step 2: Create a task with structured markdown via CLI**

```bash
LUMO_API_URL=http://localhost:3000 lumo task create "e2e md test" \
  -d $'## Section\n\n- item one\n- item two\n\n**bold** word'
```

Expected: prints `Created LUM-XXX "e2e md test"  <url>`.

- [ ] **Step 3: Open the URL in a browser**

Expected: the description renders with a real heading, a real bulleted list, and bold text. **Not** a single flattened paragraph.

- [ ] **Step 4: Round-trip — edit and save from the Web UI**

In the browser, click into the description, add a single trailing word, click outside to blur (save).

- [ ] **Step 5: `lumo task show` the same task**

```bash
LUMO_API_URL=http://localhost:3000 lumo task show LUM-XXX
```

Expected: `Description:` block prints the markdown form (`##`, `-`, `**` intact). The edit from Step 4 should be present.

- [ ] **Step 6: `lumo task context` the same task**

```bash
LUMO_API_URL=http://localhost:3000 lumo task context LUM-XXX
```

Expected: `**Description**: ## Section\n- item one\n- item two\n**bold** word` (markdown form, not HTML).

- [ ] **Step 7: Stop the dev server.**

- [ ] **Step 8: No commit needed; results go in the PR description.**

---

## Task 12: Backfill prod (gated)

This task only runs after the previous tasks are merged and deployed.

- [ ] **Step 1: Prod dry-run**

Run:

```bash
DOTENV_CONFIG_PATH=.env.production npx tsx scripts/backfill-task-descriptions.ts
```

Expected: `Mode: DRY-RUN`, prints `Matched: N / M`, sample diffs. Confirm LUM-106 is in the sample.

- [ ] **Step 2: Ask the user for explicit authorization to write**

Quote the prod `Matched` count and 1-2 sample diffs in your message and wait for the user to authorize. Do NOT proceed without that authorization in the current session (same gate as `prisma migrate deploy`, per CLAUDE.md).

- [ ] **Step 3: Apply (only after authorization)**

```bash
DOTENV_CONFIG_PATH=.env.production npx tsx scripts/backfill-task-descriptions.ts --apply
```

Expected: per-task "Updated LUM-XXX" lines, ending with `Done. Updated N. ...`.

- [ ] **Step 4: Spot-check via CLI**

```bash
lumo task show LUM-106
```

Expected: the description prints as structured markdown with `##` headings and `-` lists.

- [ ] **Step 5: Spot-check in the Web UI**

Open LUM-106 in a browser. Expected: structured rendering.

- [ ] **Step 6: No commit.** The script is a one-shot and its trace lives in the PR description / chat log.

---

## Task 13: Open PR

- [ ] **Step 1: Type-check + lint + test the whole repo**

Run, in order:

```bash
npx tsc --noEmit
npm run lint
npm test
```

Expected: zero errors at each step.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin lumo/LUM-107-fix-cli-task-description-rendering
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat: normalize task description on write, emit markdown on read [LUM-107]" --body "$(cat <<'EOF'
## Summary

- Server normalizes task `description` on every write (`normalizeRichText` = markdown → HTML, HTML pass-through, idempotent). Web ↔ CLI round-trips stay stable.
- CLI-facing read paths (`/api/tasks/by-identifier/[id]` and `/api/tasks/context/[id]`) now also emit `descriptionMarkdown` so terminals render human-readable markdown.
- One-shot `scripts/backfill-task-descriptions.ts` recovers tasks like LUM-106 that were already flattened into a single `<p>`.

## Test plan

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] End-to-end verified locally (Task 11 in plan): created a task via CLI with markdown, opened it in browser (structured rendering), edited + saved in Web, ran `lumo task show` (markdown back), ran `lumo task context` (markdown back).
- [ ] Backfill script: ran prod dry-run, attached match count and sample diffs below.

## Notes

- No schema migration. No new npm dependencies.
- The existing `isHtml` heuristic is intentionally left untouched (document service still depends on it). New stricter `looksLikeHtmlDocument` lives privately in `lib/utils/markdown.ts`, scoped to the task-description write path only.
- After merge: run `scripts/backfill-task-descriptions.ts --apply` against prod (separate authorization required).

EOF
)"
```

Return the PR URL.

---

## Self-Review

**Spec coverage check:**

| Spec section                          | Covered by                                                         |
| ------------------------------------- | ------------------------------------------------------------------ |
| §1 Architecture overview              | Tasks 1-8 implement the write + read path; Task 9-10 the backfill  |
| §2 Write path: `normalizeRichText`    | Task 1                                                             |
| §2 Write call sites (creation, state) | Tasks 2, 3                                                         |
| §3 Read path: `descriptionMarkdown`   | Tasks 4 (helper), 5 (showFromCli), 6 (context)                     |
| §3 CLI read fallback                  | Tasks 7, 8                                                         |
| §4 Backfill decision + rebuild        | Task 9                                                             |
| §4 Backfill dry-run + `--apply` flow  | Tasks 10, 12                                                       |
| §5 Unit tests                         | Tests in every code task (1-9)                                     |
| §5 Manual e2e                         | Task 11                                                            |
| §5 Web round-trip idempotency         | Task 1 includes the "round-trip idempotent" case                   |
| §6 Out of scope                       | Plan does not touch `/api/tasks/[id]` (web), comments, doc service |

No gaps.

**Type consistency:**

- `normalizeRichText(input: string | null | undefined): string | null` — same shape in tests and implementation.
- `withMarkdown<T extends {description: string|null}>(task: T): T & {descriptionMarkdown: string | null}` — consistent across Tasks 4, 5.
- `ShowTaskFromCliResult` adds `descriptionMarkdown: string | null` — consistent in Task 5 + CLI consumer in Task 7 (uses optional `?` because the CLI may run against an older server).
- `TaskContext.task.descriptionMarkdown: string | null` — consistent in Task 6 server + Task 8 CLI consumer.

**Placeholders:** none — every code step shows the actual code; every test step shows the actual test; every command shows the literal command + expected output.
