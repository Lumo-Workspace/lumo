# CLI Sanitize Control Characters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip terminal control characters (esp. ESC `\x1b`) from untrusted, server-returned fields before the CLI prints them, to prevent ANSI escape-sequence injection (LUM-139).

**Architecture:** One shared pure function `sanitizeField()` in `cli/src/lib/sanitize.ts`. Apply it (a) inside pure format helpers so callers stay unchanged, and (b) at inline print sites in network commands. Only attacker-controllable fields are sanitized; IDs, URLs, identifiers, enums, numbers, and CLI constants are left untouched.

**Tech Stack:** TypeScript (CLI under `cli/src/`), Jest (root `__tests__/cli/`, run via root `npx jest`), path alias `@/cli/src/...`.

**Working directory:** worktree `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-139-cli-sanitize`, branch `lumo/LUM-139-cli-sanitize-control-chars` (off origin/main). Run all commands from there. `node_modules` is symlinked from the main checkout.

**Spec:** `docs/superpowers/specs/2026-06-01-cli-sanitize-control-chars-design.md`

---

## File Structure

**Created:**
- `cli/src/lib/sanitize.ts` — the single `sanitizeField()` function.
- `__tests__/cli/sanitize.test.ts` — unit tests for `sanitizeField`.
- `__tests__/cli/sanitize-output.test.ts` — integration tests for representative inline command sites.

**Modified (pure format helpers — sanitize inside):**
- `cli/src/lib/format.ts` — `formatTaskListTable` (title, project.name)
- `cli/src/commands/doc-list.ts` — `formatDocListRows`, `formatDocListRowsAsTree` (title, project.name)
- `cli/src/commands/sprint-update.ts` — `formatSprintUpdateSummary` (before.name, after.name)
- `cli/src/commands/milestone-update.ts` — `formatMilestoneUpdateSummary` (before.name, after.name)
- `cli/src/commands/sprint-summary.ts` — `formatSprintSummary` (name, tldr, report)
- `cli/src/commands/task-create.ts` — `formatCreatedTask` (title)
- `cli/src/commands/task-update.ts` — `formatUpdatedTask` (title)

**Modified (inline print sites):**
- `cli/src/commands/task-artifact-add.ts`, `task-artifact-show.ts`
- `cli/src/commands/task-comment-list.ts`, `task-slack-show.ts`
- `cli/src/commands/task-figma-add.ts`, `task-figma-rm.ts`, `task-figma-refresh.ts`, `task-figma-context.ts`
- `cli/src/commands/doc-share.ts`, `doc-unshare.ts`
- `cli/src/commands/sprint-start.ts`, `sprint-close.ts`, `sprint-delete.ts`
- `cli/src/commands/task-create.ts` (sprint-name line), `milestone-delete.ts`
- `cli/src/commands/task-pr-show.ts`, `task-web-show.ts`, `auth-login.ts`
- `cli/src/commands/doc-create.ts`, `doc-update.ts`, `doc-sync.ts`, `doc-delete.ts`, `doc-import-gdoc.ts`, `doc-move.ts`

**Existing tests to extend:** `__tests__/cli/doc-list-format.test.ts`, and (if present) the task-list / sprint-create / task-create format tests; otherwise add the assertions to the new test files.

---

## Task 1: Sanitize module

**Files:**
- Create: `cli/src/lib/sanitize.ts`
- Test: `__tests__/cli/sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/sanitize.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { sanitizeField } from '@/cli/src/lib/sanitize'

describe('sanitizeField', () => {
  it('strips the ESC character (ANSI injection vector)', () => {
    expect(sanitizeField('hi\x1b[31mRED\x1b[0m')).toBe('hi[31mRED[0m')
  })

  it('strips NUL, BEL, backspace, and DEL', () => {
    expect(sanitizeField('a\x00b\x07c\x08d\x7fe')).toBe('abcde')
  })

  it('keeps tab and newline so tables and multi-line bodies survive', () => {
    expect(sanitizeField('a\tb\nc')).toBe('a\tb\nc')
  })

  it('returns ordinary text unchanged', () => {
    expect(sanitizeField('Fix Slack OAuth redirect — 修复')).toBe(
      'Fix Slack OAuth redirect — 修复'
    )
  })

  it('returns an empty string unchanged', () => {
    expect(sanitizeField('')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/sanitize.test.ts`
Expected: FAIL — `Cannot find module '@/cli/src/lib/sanitize'`.

- [ ] **Step 3: Write the minimal implementation**

Create `cli/src/lib/sanitize.ts`:

```ts
// Matches C0 control chars EXCEPT tab (\x09) and newline (\x0a), plus DEL (\x7f).
// Includes ESC (\x1b), the ANSI escape-sequence injection vector.
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/**
 * Strip terminal control characters (C0, DEL, and the C1 range \x80-\x9f incl.
 * the 8-bit CSI introducer \x9b) from untrusted, server-returned fields before
 * printing them, to prevent ANSI escape-sequence injection. Tab and newline are
 * preserved so fixed-width tables and multi-line bodies render correctly.
 * Callers handle optional values, e.g. `sanitizeField(name ?? '')`.
 */
export function sanitizeField(value: string): string {
  return value.replace(CONTROL_CHARS, '')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/sanitize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/sanitize.ts __tests__/cli/sanitize.test.ts
git commit -m "feat: add sanitizeField to strip control chars from untrusted CLI output [LUM-139]"
```

---

## Task 2: Sanitize inside pure format helpers

These are pure functions; sanitize the untrusted fields inside so callers and tests stay simple. Each step shows the exact edit.

**Files:**
- Modify: `cli/src/lib/format.ts`, `cli/src/commands/doc-list.ts`, `cli/src/commands/sprint-update.ts`, `cli/src/commands/milestone-update.ts`, `cli/src/commands/sprint-summary.ts`, `cli/src/commands/task-create.ts`, `cli/src/commands/task-update.ts`
- Test: extend `__tests__/cli/doc-list-format.test.ts`; add cases to `__tests__/cli/sanitize-output.test.ts` (created in Task 3) for the others, OR a small `__tests__/cli/format-sanitize.test.ts`.

- [ ] **Step 1: Write failing regression tests**

Append to `__tests__/cli/doc-list-format.test.ts` (inside the existing `describe('formatDocListRows', ...)` or a new `describe`):

```ts
import { formatDocListRows, formatDocListRowsAsTree } from '@/cli/src/commands/doc-list'

describe('formatDocListRows sanitization', () => {
  const row = {
    id: 'cmd1111111111111111111111',
    visibility: 'PRIVATE' as const,
    project: { name: 'Lu\x1bmo' },
    title: 'Road\x1b[31mmap',
    parentId: null,
    sortOrder: 0,
  }
  it('strips control chars from title and project name (flat)', () => {
    const line = formatDocListRows([row])[0]
    expect(line).not.toMatch(/\x1b/)
    expect(line).toContain('Road[31mmap')
    expect(line).toContain('Lumo')
  })
  it('strips control chars from title and project name (tree)', () => {
    const line = formatDocListRowsAsTree([row])[0]
    expect(line).not.toMatch(/\x1b/)
  })
})
```

Create `__tests__/cli/format-sanitize.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { formatTaskListTable } from '@/cli/src/lib/format'
import { formatSprintUpdateSummary } from '@/cli/src/commands/sprint-update'
import { formatMilestoneUpdateSummary } from '@/cli/src/commands/milestone-update'
import { formatSprintSummary } from '@/cli/src/commands/sprint-summary'

describe('format helpers strip control chars', () => {
  it('formatTaskListTable strips ESC from title and project name', () => {
    const out = formatTaskListTable([
      {
        id: 't1',
        number: 1,
        title: 'Fix\x1b[31m bug',
        status: 'TODO',
        priority: 'LOW',
        teamIdentifier: 'LUM',
        project: { id: 'p1', name: 'we\x1bb' },
      },
    ])
    expect(out).not.toMatch(/\x1b/)
    expect(out).toContain('Fix[31m bug')
    expect(out).toContain('web')
  })

  it('formatSprintUpdateSummary strips ESC from sprint names', () => {
    const out = formatSprintUpdateSummary(
      { number: 3, name: 'old\x1bname' },
      { name: 'new\x1bname' }
    )
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatMilestoneUpdateSummary strips ESC from milestone names', () => {
    const out = formatMilestoneUpdateSummary(
      { name: 'v1\x1b.0', status: 'planned' },
      { name: 'v2\x1b.0' }
    )
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatSprintSummary strips ESC from name, tldr, and report', () => {
    const out = formatSprintSummary({
      number: 3,
      name: 'sp\x1brint',
      stats: { done: 1, total: 2 },
      tldr: 'tl\x1bdr',
      report: 're\x1bport',
    })
    expect(out).not.toMatch(/\x1b/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/cli/format-sanitize.test.ts __tests__/cli/doc-list-format.test.ts`
Expected: FAIL — output still contains `\x1b`.

- [ ] **Step 3: Implement — `cli/src/lib/format.ts`**

Add the import at the top:

```ts
import { sanitizeField } from './sanitize'
```

In `formatTaskListTable`, change the `rows` mapping so `project` and `title` are sanitized:

```ts
  const rows = tasks.map(t => ({
    identifier: `${t.teamIdentifier}-${t.number}`,
    status: t.status,
    priority: t.priority,
    project: sanitizeField(t.project.name),
    title: sanitizeField(t.title),
  }))
```

- [ ] **Step 4: Implement — `cli/src/commands/doc-list.ts`**

Add import (with the existing imports):

```ts
import { sanitizeField } from '../lib/sanitize'
```

In `formatDocListRows`, change the return line:

```ts
    const project = sanitizeField(r.project?.name ?? '-').padEnd(14, ' ')
    return `${r.id}  ${label}  ${project}  ${sanitizeField(r.title)}`
```

In `formatDocListRowsAsTree`, change the project line and return line:

```ts
    const project = sanitizeField(row.project?.name ?? '-').padEnd(14, ' ')
    return `${row.id}  ${label}  ${project}  ${indent}${sanitizeField(row.title)}`
```

(Note: sanitize the name BEFORE `.padEnd` so column width is computed on the visible text.)

- [ ] **Step 5: Implement — `cli/src/commands/sprint-update.ts`**

Add import (with existing imports):

```ts
import { sanitizeField } from '../lib/sanitize'
```

In `formatSprintUpdateSummary`, sanitize names at use:

```ts
export function formatSprintUpdateSummary(
  before: SprintSnapshot,
  after: UpdatePayload
): string {
  const beforeName = sanitizeField(before.name)
  const changes: string[] = []
  if (after.name !== undefined && after.name !== before.name) {
    changes.push(`name "${beforeName}" → "${sanitizeField(after.name)}"`)
  }
  if (after.startDate !== undefined) {
    changes.push(`start → ${fmtDate(after.startDate)}`)
  }
  if (after.endDate !== undefined) {
    changes.push(`end → ${fmtDate(after.endDate)}`)
  }
  return `Updated sprint #${before.number} "${beforeName}": ${changes.join(', ')}`
}
```

- [ ] **Step 6: Implement — `cli/src/commands/milestone-update.ts`**

Add import (with existing imports):

```ts
import { sanitizeField } from '../lib/sanitize'
```

In `formatMilestoneUpdateSummary`, sanitize names:

```ts
export function formatMilestoneUpdateSummary(
  before: MilestoneSnapshot,
  after: UpdatePayload
): string {
  const beforeName = sanitizeField(before.name)
  const changes: string[] = []
  if (after.name !== undefined && after.name !== before.name) {
    changes.push(`name "${beforeName}" → "${sanitizeField(after.name)}"`)
  }
  if (after.description !== undefined) {
    changes.push(
      after.description === null ? 'description → ∅' : 'description updated'
    )
  }
  if (after.status !== undefined && after.status !== before.status) {
    changes.push(`status ${before.status} → ${after.status}`)
  }
  if (after.startDate !== undefined) {
    changes.push(`start → ${fmtDate(after.startDate)}`)
  }
  if (after.targetDate !== undefined) {
    changes.push(`target → ${fmtDate(after.targetDate)}`)
  }
  return `Updated milestone "${beforeName}": ${changes.join(', ')}`
}
```

- [ ] **Step 7: Implement — `cli/src/commands/sprint-summary.ts`**

Add import (with existing imports):

```ts
import { sanitizeField } from '../lib/sanitize'
```

In `formatSprintSummary`, sanitize `name`, `tldr`, `report`:

```ts
export function formatSprintSummary(input: SprintSummaryInput): string {
  const { number, name, stats, tldr, report } = input
  const lines: string[] = [`Sprint: #${number} ${sanitizeField(name)}`]

  if (stats === null && tldr === null && report === null) {
    lines.push('', '(no summary generated yet)')
    return lines.join('\n')
  }

  if (stats !== null) {
    lines.push(`Done:   ${stats.done} / ${stats.total}`)
  }

  if (tldr) {
    lines.push('', sanitizeField(tldr))
  }

  if (report) {
    lines.push('', sanitizeField(report))
  }

  return lines.join('\n')
}
```

- [ ] **Step 8: Implement — `cli/src/commands/task-create.ts` and `task-update.ts` (title in the created/updated formatter)**

In `cli/src/commands/task-create.ts`, add import (with existing imports):

```ts
import { sanitizeField } from '../lib/sanitize'
```

Change the escaped-title line in `formatCreatedTask` (sanitize first, then quote-escape):

```ts
  const escapedTitle = sanitizeField(task.title).replace(/"/g, '\\"')
```

In `cli/src/commands/task-update.ts`, add import (with existing imports):

```ts
import { sanitizeField } from '../lib/sanitize'
```

Change the escaped-title line in `formatUpdatedTask`:

```ts
  const escapedTitle = sanitizeField(task.title).replace(/"/g, '\\"')
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx jest __tests__/cli/format-sanitize.test.ts __tests__/cli/doc-list-format.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add cli/src/lib/format.ts cli/src/commands/doc-list.ts cli/src/commands/sprint-update.ts cli/src/commands/milestone-update.ts cli/src/commands/sprint-summary.ts cli/src/commands/task-create.ts cli/src/commands/task-update.ts __tests__/cli/format-sanitize.test.ts __tests__/cli/doc-list-format.test.ts
git commit -m "feat: sanitize untrusted fields inside CLI format helpers [LUM-139]"
```

---

## Task 3: Sanitize inline print sites in network commands

Each command imports `sanitizeField` from `../lib/sanitize` and wraps the untrusted field at the print site. Edits are grouped by file; each shows the before → after line.

**Files:** all command files listed in File Structure under "inline print sites".
**Test:** Create `__tests__/cli/sanitize-output.test.ts` with representative integration tests (slack-show, comment-list) using mocked `fetch`. The remaining inline wraps are mechanical applications of the unit-tested `sanitizeField` and are verified by `tsc` + the full suite; this is called out explicitly so coverage is not silently assumed.

- [ ] **Step 1: Write the failing integration test**

Create `__tests__/cli/sanitize-output.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { taskSlackShow } from '@/cli/src/commands/task-slack-show'

// Minimal credential + fetch mock so the command reaches its print path.
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({
    token: 'lum_test',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  }),
}))

describe('task slack show sanitization', () => {
  const origFetch = global.fetch
  let out: string
  beforeEach(() => {
    out = ''
    jest.spyOn(console, 'log').mockImplementation((s?: unknown) => {
      out += String(s) + '\n'
    })
  })
  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = origFetch
  })

  it('strips ESC from userName and text', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        snapshot: {
          messages: [{ userId: 'U1', userName: 'Ev\x1bil', text: 'h\x1b[31mi' }],
        },
      }),
    })) as unknown as typeof fetch

    await taskSlackShow('LUM-1', 'ctx_1')
    expect(out).not.toMatch(/\x1b/)
    expect(out).toContain('Evil: h[31mi')
  })
})
```

> Note: verify the actual exported function name and signature of `task-slack-show.ts` before finalizing (e.g. `taskSlackShow(identifier, contextId)`); adjust the import/call to match. If the command reads `LUMO_API_URL` or other env, set it in the test. If mocking proves brittle for a given command, keep the slack-show case as the representative integration test and rely on `tsc` + `sanitizeField` unit tests for the rest.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/cli/sanitize-output.test.ts`
Expected: FAIL — output still contains `\x1b`.

- [ ] **Step 3: Edit `task-slack-show.ts`**

Add `import { sanitizeField } from '../lib/sanitize'`. Change the message loop:

```ts
  for (const m of messages) {
    const author = sanitizeField(m.userName ?? '@' + m.userId)
    console.log(`${author}: ${sanitizeField(m.text)}`)
  }
```

- [ ] **Step 4: Edit `task-comment-list.ts`**

Add `import { sanitizeField } from '../lib/sanitize'`. In `printComment`:

```ts
function printComment(c: CommentNode, indent: string): void {
  const author = sanitizeField(c.authorActorId ?? 'unknown')
  console.log(`${indent}${author} · ${c.createdAt}`)
  const text = sanitizeField(htmlToPlainText(c.body))
  for (const line of (text || '(empty)').split('\n')) {
    console.log(`${indent}${line}`)
  }
  console.log('')
  for (const reply of c.replies ?? []) {
```

(`htmlToPlainText` strips HTML entities but not raw control bytes, so sanitize its result.)

- [ ] **Step 5: Edit `task-artifact-add.ts`**

Add `import { sanitizeField } from '../lib/sanitize'`. Change the success print (line ~139):

```ts
  process.stdout.write(
    `Added [${sanitizeField(data.artifact.kind)}] "${sanitizeField(data.artifact.title)}" to ${identifier}\n`
  )
```

- [ ] **Step 6: Edit `task-artifact-show.ts`**

Add `import { sanitizeField } from '../lib/sanitize'`. Sanitize the free-text server fields (kind, title, source, content); leave id/order/agent-label/task as-is:

```ts
  process.stdout.write(`id:     ${artifact.id}\n`)
  process.stdout.write(`kind:   ${sanitizeField(artifact.kind)}\n`)
  process.stdout.write(`title:  ${sanitizeField(artifact.title)}\n`)
  process.stdout.write(`source: ${sanitizeField(artifact.source)}\n`)
  process.stdout.write(
    `agent:  ${AGENT_LABELS[artifact.agent] ?? artifact.agent}\n`
  )
  process.stdout.write(`order:  ${artifact.order}\n`)
  process.stdout.write(`task:   ${identifier}\n`)
  process.stdout.write(`\n${sanitizeField(artifact.content)}\n`)
```

- [ ] **Step 7: Edit the three figma commands**

In each, add `import { sanitizeField } from '../lib/sanitize'` and sanitize the `label` once where it is built (the label concatenates `fileName`/`frameName`).

`task-figma-add.ts`:

```ts
    const label = sanitizeField(
      link.frameName
        ? `${link.fileName} · ${link.frameName}`
        : `${link.fileName}${link.nodeId === '' ? ' (file-level)' : ''}`
    )
```

`task-figma-rm.ts`:

```ts
  const label = sanitizeField(
    match.frameName
      ? `${match.fileName} · ${match.frameName}`
      : `${match.fileName} (file-level)`
  )
```

`task-figma-refresh.ts`:

```ts
      const label = link
        ? sanitizeField(
            link.frameName
              ? `${link.fileName} · ${link.frameName}`
              : `${link.fileName} (file-level)`
          )
        : r.id
```

- [ ] **Step 8: Edit `task-figma-context.ts`**

Add `import { sanitizeField } from '../lib/sanitize'`. Change the two lines:

```ts
  if (metadata.fileName) console.log(`file:  ${sanitizeField(metadata.fileName)}`)
  if (metadata.frameName) console.log(`frame: ${sanitizeField(metadata.frameName)}`)
```

- [ ] **Step 9: Edit `doc-share.ts` and `doc-unshare.ts`**

Add `import { sanitizeField } from '../lib/sanitize'` to each.

`doc-share.ts` (line ~94):

```ts
  console.log(`Shared ${docId} ↔ ${sanitizeField(result.member.displayName)} (${role})`)
```

`doc-unshare.ts` (lines ~69 and ~83):

```ts
    console.log(`Not shared with ${sanitizeField(result.member.displayName)}`)
```
```ts
  console.log(`Unshared ${docId} ↔ ${sanitizeField(result.member.displayName)}`)
```

- [ ] **Step 10: Edit `sprint-start.ts`, `sprint-close.ts`, `sprint-delete.ts`, and the sprint-name line in `task-create.ts`**

Add `import { sanitizeField } from '../lib/sanitize'` to each (task-create.ts already imported it in Task 2).

`sprint-start.ts` (line ~79):

```ts
  process.stdout.write(`Started sprint #${displayNumber} "${sanitizeField(displayName)}"\n`)
```

`sprint-close.ts` (line ~188):

```ts
  process.stdout.write(`Closed sprint #${sprint.number} "${sanitizeField(sprint.name)}"\n`)
```

`sprint-delete.ts` (line ~104):

```ts
  process.stdout.write(`Deleted sprint #${sprint.number} "${sanitizeField(sprint.name)}"\n`)
```

`task-create.ts` (line ~241):

```ts
        process.stdout.write(`Sprint: #${sprint.number} "${sanitizeField(sprint.name)}"\n`)
```

- [ ] **Step 11: Edit `milestone-delete.ts`**

Add `import { sanitizeField } from '../lib/sanitize'`. Change line ~114:

```ts
  process.stdout.write(`Deleted milestone "${sanitizeField(name)}"\n`)
```

- [ ] **Step 12: Edit `task-pr-show.ts`**

Add `import { sanitizeField } from '../lib/sanitize'`. Sanitize PR title and author (leave repo/state/ci/branch/url — repo is `owner/name` from GitHub, low risk, but sanitize title + author which are free text):

```ts
  console.log(
    `#${pr.number}${pr.repo ? ` (${pr.repo})` : ''}  ${sanitizeField(pr.title ?? '')}`
  )
```
```ts
  if (pr.authorLogin) console.log(`author:   ${sanitizeField(pr.authorLogin)}`)
```

- [ ] **Step 13: Edit `task-web-show.ts`**

Add `import { sanitizeField } from '../lib/sanitize'`. Sanitize the fetched body (line ~73):

```ts
  console.log(sanitizeField(body))
```

- [ ] **Step 14: Edit `auth-login.ts`**

Add `import { sanitizeField } from '../lib/sanitize'`. Sanitize server-returned workspace/key names (lines ~57–58):

```ts
  console.log(`  Workspace: ${sanitizeField(resp.workspace.name)}`)
  console.log(`  Key: ${sanitizeField(resp.apiKey.name)} (${resp.apiKey.prefix})`)
```

- [ ] **Step 15: Edit the six doc title sites (compose with the existing quote-escape)**

In each file add `import { sanitizeField } from '../lib/sanitize'` and wrap the raw title with `sanitizeField(...)` BEFORE the existing `.replace(/"/g, '\\"')`.

`doc-create.ts` (line ~47):

```ts
  const escaped = sanitizeField(doc.title).replace(/"/g, '\\"')
```

`doc-update.ts` (line ~32):

```ts
  const escaped = sanitizeField(doc.title).replace(/"/g, '\\"')
```

`doc-sync.ts` (line ~10):

```ts
  const escaped = sanitizeField(doc.title).replace(/"/g, '\\"')
```

`doc-delete.ts` (line ~56):

```ts
  const escaped = sanitizeField(title).replace(/"/g, '\\"')
```

`doc-import-gdoc.ts` (line ~18):

```ts
  const escaped = sanitizeField(doc.title).replace(/"/g, '\\"')
```

`doc-move.ts` (line ~134) — note the variable is `escapedDocTitle`, and `parentTitleForOutput` is also a doc title; sanitize both:

```ts
  const escapedDocTitle = sanitizeField(docRow.title).replace(/"/g, '\\"')
```

For `parentTitleForOutput` in `doc-move.ts`: locate where it is assigned from the parent doc title and wrap that source value with `sanitizeField(...)`. If it is a constant like `'root'` in the root branch, leave that branch unchanged.

- [ ] **Step 16: Run the new integration test**

Run: `npx jest __tests__/cli/sanitize-output.test.ts`
Expected: PASS.

- [ ] **Step 17: Commit**

```bash
git add cli/src/commands/ __tests__/cli/sanitize-output.test.ts
git commit -m "feat: strip control chars at CLI inline print sites [LUM-139]"
```

---

## Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If unrelated pre-existing errors appear, confirm they exist on origin/main too; only new errors block.)

- [ ] **Step 2: Run the full CLI test suite**

Run: `npx jest __tests__/cli __tests__/task-cli.service.test.ts __tests__/task-cli.service.show.test.ts __tests__/task-cli.service.update.test.ts __tests__/cli-create-task-schema.test.ts __tests__/cli-update-task-schema.test.ts`
Expected: all PASS (baseline was 56 suites / 301 tests; new tests add to that).

- [ ] **Step 3: Grep for missed untrusted print sites**

Run:
```bash
grep -rn "process.stdout.write\|console.log" cli/src/commands cli/src/lib \
  | grep -iE "\.title|\.name|\.text|\.body|author|frame|displayName|\.content|\.tldr|\.report" \
  | grep -v sanitizeField | grep -vi "Error:"
```
Expected: only false positives (constants, already-sanitized-via-helper values, IDs). Review each remaining line; sanitize any genuinely untrusted field that slipped through.

- [ ] **Step 4: Confirm no SKILL.md change needed**

Command invocation, flags, and output structure are unchanged (only invisible control chars are filtered). Per CLAUDE.md, an output-structure-preserving fix does not require a `SKILL.md` update. No change.

- [ ] **Step 5: Final commit (if Step 3 surfaced additional sites)**

```bash
git add -A
git commit -m "fix: sanitize remaining untrusted CLI print sites [LUM-139]"
```

---

## Self-Review notes

- **Spec coverage:** every application point in the spec maps to a task — format helpers (Task 2), inline sites incl. artifact/comment/slack/figma/member/sprint/milestone/doc-title/pr/web/auth (Task 3); "NOT sanitized" list respected (IDs/URLs/identifiers/enums/numbers left alone); SKILL.md untouched (Task 4 Step 4); tests for `sanitizeField` + helpers + representative inline (Tasks 1–3).
- **Naming consistency:** `sanitizeField` used everywhere; import path `./sanitize` from `cli/src/lib/`, `../lib/sanitize` from `cli/src/commands/`.
- **Known follow-up:** integration-test coverage of inline sites is representative (slack-show, comment-list), not exhaustive — called out in Task 3 rather than silently assumed; the central function is fully unit-tested and `tsc` guards the wraps.
