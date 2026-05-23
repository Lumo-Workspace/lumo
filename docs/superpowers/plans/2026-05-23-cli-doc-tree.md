# CLI Doc Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `lumo doc move`, `--parent` on `lumo doc create`, and `--tree` on `lumo doc list` so the CLI can drive the existing Document tree (`parentId` + `sortOrder`) that the Web UI and database already support.

**Architecture:** Pure-CLI implementation except for one minor server-side widening (`findDocumentMentionsByTask` Prisma select) needed for `--task --tree` to work. New pure helpers (`doc-sort-order.ts`, `doc-tree.ts`) keep command handlers thin. Reuses existing `lookupDocId()` / `resolveDoc()` ref resolution and the existing `PATCH /api/documents/[id]/move` endpoint as-is.

**Tech Stack:** TypeScript strict, Commander.js (CLI), Jest (server tests only — `cli/` package has no test infra by convention), Prisma (server-side), Next.js 14 App Router.

**Branch:** `lumo/LUM-80-cli-doc-tree` (already created). All commits go on this branch.

**Spec:** [`docs/superpowers/specs/2026-05-23-cli-doc-tree-design.md`](docs/superpowers/specs/2026-05-23-cli-doc-tree-design.md)

---

## File Structure

| File                                                 | Responsibility                                                                                                                                                                                                                                                        | Action |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `lib/repositories/misc.repository.ts`                | Widen the `select:` inside `findDocumentMentionsByTask` to include `parentId`, `sortOrder`, `visibility`, `project { id, name }`.                                                                                                                                     | edit   |
| `__tests__/lib/repositories/misc.repository.test.ts` | Update the existing `findDocumentMentionsByTask` test to assert the new select shape and a new sample row carrying the new fields.                                                                                                                                    | edit   |
| `cli/src/lib/doc-sort-order.ts`                      | Pure helper `pickNextSortOrder(siblings)` returning `max(sibling.sortOrder) + 1` or `0`.                                                                                                                                                                              | new    |
| `cli/src/lib/doc-tree.ts`                            | Pure helpers `buildTree(rows)` (groups by `parentId`, sorts siblings by `sortOrder` asc, orphans → virtual roots) and `flattenWithDepth(tree)` (pre-order traversal returning `[{ row, depth }, …]`).                                                                 | new    |
| `cli/src/commands/doc-move.ts`                       | `docMove(reference, opts)`: validates `--parent` / `--root` mutual exclusion, resolves doc + parent refs in one `GET /api/documents` round trip, computes `sortOrder` via `pickNextSortOrder`, calls `PATCH /api/documents/<id>/move`, prints the single-line result. | new    |
| `cli/src/commands/doc-create.ts`                     | Add `parent?: string` to `CreateDocOptions`, resolve via `lookupDocId()`, include `parentId` in the request body.                                                                                                                                                     | edit   |
| `cli/src/commands/doc-list.ts`                       | Add `tree?: boolean` to `ListDocOptions`. When set, run the existing fetch + filter pipeline, then render through `formatDocListRowsAsTree(rows)` instead of `formatDocListRows`.                                                                                     | edit   |
| `cli/src/index.ts`                                   | Register `doc move`; add `--parent <doc>` to `doc create`; add `--tree` to `doc list`.                                                                                                                                                                                | edit   |
| `.claude/skills/lumo/SKILL.md`                       | Document the three changes (new `doc move` section, `--parent` flag row on `doc create`, `--tree` flag row on `doc list`); add tree-related triggers to the frontmatter `description`.                                                                                | edit   |

The `cli/src/lib/doc-sort-order.ts` and `cli/src/lib/doc-tree.ts` files exist as standalone pure modules so they're amenable to unit testing once CLI test infra is bootstrapped (separate follow-up task — see spec § Verification strategy).

---

## Task 1: Widen `findDocumentMentionsByTask` select (server, TDD)

**Why first:** Task 6's `--tree` rendering for `lumo doc list --task LUM-N` relies on `parentId`/`sortOrder` being present in the task-scoped payload. Land the server change first so the CLI work can verify end-to-end against production.

**Files:**

- Modify: `__tests__/lib/repositories/misc.repository.test.ts:208-249`
- Modify: `lib/repositories/misc.repository.ts:173-201`

- [ ] **Step 1: Update the existing test to expect the widened select**

Replace lines 208–249 of `__tests__/lib/repositories/misc.repository.test.ts` with:

```typescript
describe('miscRepository.findDocumentMentionsByTask', () => {
  it('returns document mentions with document details including tree fields', async () => {
    const updatedAt = new Date()
    const mentions = [
      {
        id: 'dm1',
        document: {
          id: 'doc1',
          title: 'Design',
          emoji: null,
          updatedAt,
          parentId: null,
          sortOrder: 0,
          visibility: 'WORKSPACE',
          project: { id: 'prj1', name: 'Lumo' },
        },
      },
    ]
    ;(prisma.documentMention.findMany as jest.Mock).mockResolvedValue(mentions)

    const result = await miscRepository.findDocumentMentionsByTask(
      't1',
      'ws-1',
      'm1'
    )

    expect(result).toEqual(mentions)
    expect(prisma.documentMention.findMany).toHaveBeenCalledWith({
      where: {
        taskId: 't1',
        document: {
          workspaceId: 'ws-1',
          OR: [
            { createdById: 'm1' },
            { visibility: 'WORKSPACE' },
            { shares: { some: { memberId: 'm1' } } },
          ],
        },
      },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            emoji: true,
            updatedAt: true,
            parentId: true,
            sortOrder: true,
            visibility: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
    })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails on the assertion (current select still narrow)**

Run: `npx jest __tests__/lib/repositories/misc.repository.test.ts -t "findDocumentMentionsByTask"`

Expected: 1 failed test. The diff should show the actual call missing `parentId`, `sortOrder`, `visibility`, `project`.

- [ ] **Step 3: Widen the repository select**

In `lib/repositories/misc.repository.ts`, replace lines 178–200 (the body of `findDocumentMentionsByTask`) with:

```typescript
return prisma.documentMention.findMany({
  where: {
    taskId,
    document: {
      workspaceId,
      OR: [
        { createdById: memberId },
        { visibility: 'WORKSPACE' },
        { shares: { some: { memberId } } },
      ],
    },
  },
  include: {
    document: {
      select: {
        id: true,
        title: true,
        emoji: true,
        updatedAt: true,
        parentId: true,
        sortOrder: true,
        visibility: true,
        project: { select: { id: true, name: true } },
      },
    },
  },
})
```

- [ ] **Step 4: Re-run the test and confirm it passes**

Run: `npx jest __tests__/lib/repositories/misc.repository.test.ts -t "findDocumentMentionsByTask"`

Expected: 1 passed, 0 failed.

- [ ] **Step 5: Run root typecheck to confirm no downstream regressions**

Run: `npx tsc --noEmit`

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add __tests__/lib/repositories/misc.repository.test.ts lib/repositories/misc.repository.ts
git commit -m "$(cat <<'EOF'
feat: widen task-doc endpoint payload with tree fields [LUM-80]

Add parentId, sortOrder, visibility, and project { id, name } to the
findDocumentMentionsByTask select so lumo doc list --task --tree can
render proper hierarchy and scope/project columns. No web UI consumer
depends on the absence of these fields.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure helper `pickNextSortOrder`

**Files:**

- Create: `cli/src/lib/doc-sort-order.ts`

- [ ] **Step 1: Create the helper**

Write `cli/src/lib/doc-sort-order.ts`:

```typescript
/**
 * Compute the sortOrder to assign to a new/relocated doc so it lands at the
 * end of its sibling list. Empty siblings → 0. Otherwise max(sortOrder) + 1.
 *
 * The "siblings" passed in MUST be the docs already under the target parent
 * (or under root). The caller filters this out of the GET /api/documents
 * payload before calling — keeping this function pure makes it cheap to
 * unit-test in the future.
 */
export function pickNextSortOrder(siblings: { sortOrder: number }[]): number {
  if (siblings.length === 0) return 0
  let max = siblings[0]!.sortOrder
  for (let i = 1; i < siblings.length; i++) {
    const v = siblings[i]!.sortOrder
    if (v > max) max = v
  }
  return max + 1
}
```

- [ ] **Step 2: Typecheck the CLI**

Run: `cd cli && npx tsc --noEmit`

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add cli/src/lib/doc-sort-order.ts
git commit -m "$(cat <<'EOF'
feat: cli pickNextSortOrder helper [LUM-80]

Pure helper computing max(sortOrder) + 1 for siblings, used by doc move
to append moved docs at the end of their new sibling list.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Pure helpers `buildTree` / `flattenWithDepth`

**Files:**

- Create: `cli/src/lib/doc-tree.ts`

- [ ] **Step 1: Create the helpers**

Write `cli/src/lib/doc-tree.ts`:

```typescript
/**
 * Minimal shape a tree node needs. doc-list rows carry more (visibility,
 * project, etc.) but this module only depends on the tree-shape fields.
 */
export interface TreeNode<
  T extends { id: string; parentId?: string | null; sortOrder?: number | null },
> {
  row: T
  children: TreeNode<T>[]
}

/**
 * Group a flat list of docs into a forest. Docs whose parentId is null OR
 * whose parent is absent from the input become roots ("virtual roots" in
 * spec parlance). Siblings are sorted by sortOrder ascending; ties broken
 * by id to keep ordering stable when sortOrder collides.
 */
export function buildTree<
  T extends { id: string; parentId?: string | null; sortOrder?: number | null },
>(rows: T[]): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>()
  for (const row of rows) {
    byId.set(row.id, { row, children: [] })
  }

  const roots: TreeNode<T>[] = []
  for (const row of rows) {
    const node = byId.get(row.id)!
    const parent = row.parentId ? byId.get(row.parentId) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => {
      const ao = a.row.sortOrder ?? 0
      const bo = b.row.sortOrder ?? 0
      if (ao !== bo) return ao - bo
      return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0
    })
    for (const n of nodes) sortNodes(n.children)
  }
  sortNodes(roots)

  return roots
}

/**
 * Pre-order traversal yielding rows tagged with depth. Roots → depth 0.
 */
export function flattenWithDepth<
  T extends { id: string; parentId?: string | null; sortOrder?: number | null },
>(roots: TreeNode<T>[]): { row: T; depth: number }[] {
  const out: { row: T; depth: number }[] = []
  const visit = (node: TreeNode<T>, depth: number) => {
    out.push({ row: node.row, depth })
    for (const child of node.children) visit(child, depth + 1)
  }
  for (const r of roots) visit(r, 0)
  return out
}
```

- [ ] **Step 2: Typecheck the CLI**

Run: `cd cli && npx tsc --noEmit`

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add cli/src/lib/doc-tree.ts
git commit -m "$(cat <<'EOF'
feat: cli buildTree / flattenWithDepth helpers [LUM-80]

Pure tree assembly for doc list --tree. Orphan docs (parentId pointing
outside the input set) become virtual roots so filter semantics are
preserved. Siblings sort by sortOrder ascending, ties broken by id.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `lumo doc move` command

**Files:**

- Create: `cli/src/commands/doc-move.ts`
- Modify: `cli/src/index.ts` (import + registration)

- [ ] **Step 1: Create the command handler**

Write `cli/src/commands/doc-move.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveDoc } from '../lib/resolve-doc'
import { pickNextSortOrder } from '../lib/doc-sort-order'

export interface MoveDocOptions {
  parent?: string
  root?: boolean
}

interface DocLike {
  id: string
  title: string
  parentId: string | null
  sortOrder: number
}

export async function docMove(
  reference: string | undefined,
  opts: MoveDocOptions
): Promise<number | void> {
  if (!reference) {
    console.error('Error: usage: lumo doc move <doc> --parent <doc> | --root')
    return 1
  }

  const hasParent = typeof opts.parent === 'string' && opts.parent.length > 0
  const hasRoot = Boolean(opts.root)
  if (hasParent && hasRoot) {
    console.error('Error: --parent and --root are mutually exclusive')
    return 1
  }
  if (!hasParent && !hasRoot) {
    console.error('Error: specify --parent <doc> or --root')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  // One fetch covers ref resolution AND sibling discovery.
  const listUrl = `${trimTrailingSlash(apiUrl)}/api/documents`
  let listRes: Response
  try {
    listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    console.error(`Error: network failure: ${(err as Error).message}`)
    return 1
  }
  if (!listRes.ok) {
    const text = await listRes.text()
    console.error(`Error: ${listRes.status} ${listRes.statusText}: ${text}`)
    return 1
  }
  const { documents } = (await listRes.json()) as { documents: DocLike[] }

  // Resolve the doc to move.
  const docMatch = resolveDoc(reference, documents)
  if (docMatch.kind === 'ambiguous') {
    console.error(
      `Error: title "${reference}" matches ${docMatch.candidates.length} docs:`
    )
    for (const c of docMatch.candidates) {
      console.error(`  ${c.id}  ${c.title}`)
    }
    console.error('Re-run with the cuid.')
    return 1
  }
  if (docMatch.kind === 'not-found') {
    console.error(`Error: Document not found: ${reference}`)
    return 1
  }
  const docRow = documents.find(d => d.id === docMatch.doc.id)!

  // Resolve the parent (if --parent) — uses the same list.
  let newParentId: string | null = null
  let parentTitleForOutput = 'root'
  if (hasParent) {
    const parentMatch = resolveDoc(opts.parent!, documents)
    if (parentMatch.kind === 'ambiguous') {
      console.error(
        `Error: --parent "${opts.parent}" matches ${parentMatch.candidates.length} docs:`
      )
      for (const c of parentMatch.candidates) {
        console.error(`  ${c.id}  ${c.title}`)
      }
      console.error('Re-run with the cuid.')
      return 1
    }
    if (parentMatch.kind === 'not-found') {
      console.error(`Error: Document not found: ${opts.parent}`)
      return 1
    }
    const parentRow = documents.find(d => d.id === parentMatch.doc.id)!
    newParentId = parentRow.id
    parentTitleForOutput = `"${parentRow.title.replace(/"/g, '\\"')}"`
  }

  // Compute next sortOrder from existing siblings under the target parent.
  const siblings = documents.filter(
    d => d.parentId === newParentId && d.id !== docRow.id
  )
  const sortOrder = pickNextSortOrder(siblings)

  // PATCH the move.
  const moveUrl = `${trimTrailingSlash(apiUrl)}/api/documents/${docRow.id}/move`
  let moveRes: Response
  try {
    moveRes = await fetch(moveUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parentId: newParentId, sortOrder }),
    })
  } catch (err) {
    console.error(`Error: network failure: ${(err as Error).message}`)
    return 1
  }
  if (!moveRes.ok) {
    const text = await moveRes.text()
    let msg = text
    try {
      const json = JSON.parse(text) as { error?: string }
      if (json.error) msg = json.error
    } catch {}
    console.error(`Error: ${moveRes.status} ${moveRes.statusText}: ${msg}`)
    return 1
  }

  const escapedDocTitle = docRow.title.replace(/"/g, '\\"')
  console.log(
    `Moved ${docRow.id} "${escapedDocTitle}" → ${parentTitleForOutput}`
  )
}
```

- [ ] **Step 2: Wire the command into the CLI**

In `cli/src/index.ts`, add the import alongside the other doc imports (the block spanning lines 25–34):

```typescript
import { docMove } from './commands/doc-move'
```

Then register the command after the `doc list` block (around line 339). Add this block immediately after the `doc list` `.action(...)` call:

```typescript
doc
  .command('move <doc>')
  .description('Move a doc under a different parent or to top level')
  .option('--parent <doc>', 'New parent doc (cuid or title)')
  .option('--root', 'Move to top level (no parent)')
  .action(
    wrap((reference, opts) =>
      docMove(reference as string | undefined, opts as Record<string, unknown>)
    )
  )
```

- [ ] **Step 3: Typecheck the CLI**

Run: `cd cli && npx tsc --noEmit`

Expected: exits 0.

- [ ] **Step 4: Build and smoke-check Commander wiring**

Run: `cd cli && npm run build && lumo doc move --help`

Expected output includes:

```
Usage: lumo doc move [options] <doc>

Move a doc under a different parent or to top level

Options:
  --parent <doc>  New parent doc (cuid or title)
  --root          Move to top level (no parent)
  -h, --help      display help for command
```

- [ ] **Step 5: Smoke-check mutual exclusion (no network)**

Run: `lumo doc move "Nonexistent" --parent "Whatever" --root`

Expected: exits 1, prints `Error: --parent and --root are mutually exclusive`.

Run: `lumo doc move "Nonexistent"`

Expected: exits 1, prints `Error: specify --parent <doc> or --root`.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/doc-move.ts cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat: lumo doc move command [LUM-80]

Move a doc under a new parent (--parent) or to top level (--root).
Mutual exclusion validated client-side before any network call. Doc
and parent refs resolved from the same GET /api/documents payload;
sortOrder appended via pickNextSortOrder.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `--parent` on `lumo doc create`

**Files:**

- Modify: `cli/src/commands/doc-create.ts` (interface + body construction)
- Modify: `cli/src/index.ts` (register the new option)

- [ ] **Step 1: Add `parent` to `CreateDocOptions`**

In `cli/src/commands/doc-create.ts`, replace the `CreateDocOptions` interface (lines 12–20) with:

```typescript
export interface CreateDocOptions {
  content?: string
  file?: string
  scope?: string
  project?: string
  task?: string
  tag?: string[]
  tagId?: string[]
  parent?: string
}
```

- [ ] **Step 2: Resolve `--parent` and include `parentId` in the request body**

Still in `cli/src/commands/doc-create.ts`, add this import near the existing imports at the top:

```typescript
import { lookupDocId } from '../lib/resolve-doc-id'
```

Then inside `docCreate(...)`, between the existing block that computes `tagIds` (currently ending at the body declaration around line 110) and the line `const body: Record<string, unknown> = {` (line 110), insert this block:

```typescript
let resolvedParentId: string | undefined
if (opts.parent !== undefined && opts.parent.length > 0) {
  const id = await lookupDocId(apiUrl, creds.token, opts.parent)
  if (!id) {
    console.error(`Error: --parent doc not found: ${opts.parent}`)
    return 1
  }
  resolvedParentId = id
}
```

Then extend the body construction (currently lines 110–116) so `parentId` is included when present. Replace the body block with:

```typescript
const body: Record<string, unknown> = {
  title: title?.trim() ?? '',
  visibility,
}
if (content.kind === 'ok') body.contentMarkdown = content.markdown
if (opts.project !== undefined) body.projectRef = opts.project
if (tagIds && tagIds.length > 0) body.tagIds = tagIds
if (resolvedParentId !== undefined) body.parentId = resolvedParentId
```

- [ ] **Step 3: Register `--parent` in the CLI**

In `cli/src/index.ts`, add the `--parent` option to the existing `doc create` block (lines 275–289). Insert this line between the `--task` option and the `--tag` option:

```typescript
  .option('--parent <doc>', 'File under this parent doc (cuid or title)')
```

The block should end up looking like this:

```typescript
doc
  .command('create [title]')
  .description('Create a new document')
  .option('--content <text>', 'Inline markdown content')
  .option('--file <path>', 'Read markdown content from file')
  .option('--scope <scope>', 'personal | workspace (default: personal)')
  .option('--project <ref>', 'Project name or slug to file under')
  .option('--task <LUM-N>', 'Bind to this task after creation')
  .option('--parent <doc>', 'File under this parent doc (cuid or title)')
  .option('--tag <name>', 'Attach tag by name (repeatable)', collect, [])
  .option('--tag-id <cuid>', 'Attach tag by id (repeatable)', collect, [])
  .action(
    wrap((title, opts) =>
      docCreate(title as string | undefined, opts as Record<string, string>)
    )
  )
```

- [ ] **Step 4: Typecheck the CLI**

Run: `cd cli && npx tsc --noEmit`

Expected: exits 0.

- [ ] **Step 5: Build and smoke-check the help text**

Run: `cd cli && npm run build && lumo doc create --help`

Expected: the help output includes `--parent <doc>     File under this parent doc (cuid or title)`.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/doc-create.ts cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat: --parent flag on lumo doc create [LUM-80]

Resolve --parent <doc> (cuid or case-insensitive title) via lookupDocId
and include parentId in the POST /api/documents body. Resolution failure
exits before any create call.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `--tree` on `lumo doc list`

**Files:**

- Modify: `cli/src/commands/doc-list.ts` (interface, DocRow type, branch on `tree`)
- Modify: `cli/src/index.ts` (register the new option)

- [ ] **Step 1: Extend `ListDocOptions` and `DocRow`**

In `cli/src/commands/doc-list.ts`, replace the `ListDocOptions` interface (lines 5–10) with:

```typescript
export interface ListDocOptions {
  scope?: string
  project?: string
  task?: string
  limit?: string
  tree?: boolean
}
```

Then replace the `DocRow` interface (lines 12–17) with the wider shape (the new fields are required for tree rendering and now present in both endpoint payloads after Task 1):

```typescript
interface DocRow {
  id: string
  title: string
  visibility: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
  project: { name: string } | null
  parentId: string | null
  sortOrder: number
}
```

- [ ] **Step 2: Add the tree-aware formatter**

Still in `cli/src/commands/doc-list.ts`, add this import next to the existing ones at the top:

```typescript
import { buildTree, flattenWithDepth } from '../lib/doc-tree'
```

Then add this exported function below `formatDocListRows` (the existing function ends at line 31). The shape mirrors `formatDocListRows` — same column widths — but prefixes the title with two spaces per depth level:

```typescript
export function formatDocListRowsAsTree(rows: DocRow[]): string[] {
  if (rows.length === 0) return []
  const tree = buildTree(rows)
  const flat = flattenWithDepth(tree)
  return flat.map(({ row, depth }) => {
    const label = visibilityLabel(row.visibility).padEnd(10, ' ')
    const project = (row.project?.name ?? '-').padEnd(14, ' ')
    const indent = '  '.repeat(depth)
    return `${row.id}  ${label}  ${project}  ${indent}${row.title}`
  })
}
```

- [ ] **Step 3: Branch on `opts.tree` at the render site**

Still in `cli/src/commands/doc-list.ts`, replace the final two lines (currently `const lines = formatDocListRows(rows)` followed by the `for (const line of lines) console.log(line)` loop — lines 89–90) with:

```typescript
const lines = opts.tree
  ? formatDocListRowsAsTree(rows)
  : formatDocListRows(rows)
for (const line of lines) console.log(line)
```

- [ ] **Step 4: Register `--tree` in the CLI**

In `cli/src/index.ts`, add `--tree` to the existing `doc list` block (lines 331–338). Insert this line between `--limit` and `.action(...)`:

```typescript
  .option('--tree', 'Render as an indented tree')
```

The block should end up looking like this:

```typescript
doc
  .command('list')
  .description('List documents visible to the current user')
  .option('--scope <scope>', 'personal | workspace | all (default: all)')
  .option('--project <ref>', 'Filter by project name/slug')
  .option('--task <LUM-N>', 'Only docs bound to this task')
  .option('--limit <n>', 'Cap output to first N rows')
  .option('--tree', 'Render as an indented tree')
  .action(wrap(opts => docList(opts as Record<string, string>)))
```

- [ ] **Step 5: Typecheck the CLI**

Run: `cd cli && npx tsc --noEmit`

Expected: exits 0.

- [ ] **Step 6: Build and smoke-check the help text**

Run: `cd cli && npm run build && lumo doc list --help`

Expected: help output includes `--tree              Render as an indented tree`.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/doc-list.ts cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat: --tree flag on lumo doc list [LUM-80]

Build the tree client-side from the existing flat list payload; orphan
docs (parent missing from the result, e.g. filtered out by --task)
become virtual roots so filter semantics are preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update `.claude/skills/lumo/SKILL.md`

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md` (frontmatter description; `doc create`, `doc list` sections; new `doc move` section)

- [ ] **Step 1: Open the file and add trigger keywords to the frontmatter `description`**

Append the following phrases to the existing comma-separated list inside the frontmatter `description` field, after the last existing doc-related trigger (do NOT remove anything):

```
"doc tree", "doc move", "move doc", "reparent doc", "文档树", "移动文档"
```

The exact wording of the surrounding `description` is verbose; insert the new triggers in the doc-related cluster (search for "doc share-list" — the new triggers go just after that). The format follows the existing pattern (each phrase in quotes, comma-separated).

- [ ] **Step 2: Add the `--parent` row to the `lumo doc create` flag table**

Find the `### \`lumo doc create [title] [flags]\``section. In the flag table immediately after`--tag-id <cuid>`, add a new row:

```
| `--parent <doc>`   | string              | cuid or case-insensitive title. Files the new doc under this parent. Use omitted/empty for root. |
```

Then in the Examples block under that section, add one new example line below the existing examples:

```bash
lumo doc create "Sub-doc" --parent "RFC"
```

- [ ] **Step 3: Add a new `### \`lumo doc move <doc> [flags]\`` section**

Insert this new section between the existing `### \`lumo doc list [flags]\``section and the`### \`lumo doc delete <doc> --yes\`` section:

````markdown
### `lumo doc move <doc> [flags]` — move a doc under a different parent or to root

Reparents a doc. `<doc>` accepts a cuid or a case-insensitive title; ambiguous titles fail with a candidate list — re-run with the cuid.

| Flag             | Type    | Notes                                            |
| ---------------- | ------- | ------------------------------------------------ |
| `--parent <doc>` | string  | New parent doc (cuid or case-insensitive title). |
| `--root`         | boolean | Move to top level (`parentId = null`).           |

`--parent` and `--root` are **mutually exclusive** and one of them is **required**. CLI errors before any network call if both or neither is supplied.

The new `sortOrder` is computed CLI-side as `max(sibling.sortOrder) + 1` — the moved doc lands at the end of its new sibling list. Reordering among siblings (`--before` / `--after`) is not yet supported; for now use the Web UI to reorder.

Examples:

```bash
lumo doc move "Sub-doc" --parent "Roadmap"
lumo doc move "Sub-doc" --root
lumo doc move cmd_xxx --parent cmd_yyy
```

Output:

```
Moved cmd_xxx "Sub-doc" → "Roadmap"
Moved cmd_xxx "Sub-doc" → root
```

### When to suggest `doc move`

- User says "move doc X under Y", "把文档 X 挂到 Y 下", "reparent X to root", "promote X to top level".
- After `doc create`, if the user realizes the new doc should live elsewhere in the tree — suggest `doc move` rather than recreating.
````

- [ ] **Step 4: Add the `--tree` row + interaction note to the `lumo doc list` flag table**

Find the `### \`lumo doc list [flags]\``section. In the flag table after`--limit <count>`, add a new row:

```
| `--tree`                | boolean | Render as an indented tree (two spaces per depth level) instead of the flat row table. |
```

Then under the flag table, add this paragraph before the existing "Filtering is currently client-side" paragraph:

> `--tree` plus the existing filters work together: the CLI fetches with the filters applied, then builds the tree from whatever rows came back. Docs whose parent is **not** in the result (e.g. filtered out by `--task LUM-N`) render as top-level rows. `--limit N --tree` truncates the flat list to N rows _before_ the tree is built, so a deeply nested subtree may not appear contiguously.

Add one new example to the Examples block of `doc list` (under the existing examples):

```bash
lumo doc list --scope workspace --tree
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "$(cat <<'EOF'
docs: SKILL.md for doc tree CLI changes [LUM-80]

Document --parent on doc create, the new doc move command, and --tree
on doc list. Add tree-related triggers to the frontmatter description
so the agent activates on "doc tree", "move doc", "文档树" etc.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Acceptance verification (manual against a real workspace)

This task produces no commit — it runs the spec's acceptance commands and confirms the actual output matches expectations. Capture any discrepancies and loop back to the relevant task before opening the PR.

**Prereq:** logged-in CLI (`lumo whoami` succeeds) pointing at the same workspace where the test docs will live. Use the development workspace, not a customer's.

- [ ] **Step 1: Build the CLI one more time so all commits are reflected**

Run: `cd cli && npm run build`

Expected: exits 0.

- [ ] **Step 2: Set up test docs**

Run:

```bash
lumo doc create "RFC" --scope workspace
lumo doc create "Sub-doc" --parent "RFC" --scope workspace
lumo doc create "Roadmap" --scope workspace
```

Expected: three `Created cmd_xxx "..."  <url>` lines, no errors.

- [ ] **Step 3: Verify `--parent` filed Sub-doc under RFC**

Run: `lumo doc list --scope workspace --tree`

Expected (order may vary among unrelated roots, but the parent/child shape must hold): one row for `RFC` at depth 0, then `Sub-doc` indented two spaces under it; `Roadmap` at depth 0 on its own.

- [ ] **Step 4: Move Sub-doc under Roadmap**

Run: `lumo doc move "Sub-doc" --parent "Roadmap"`

Expected: `Moved cmd_xxx "Sub-doc" → "Roadmap"`, exit 0.

Re-run `lumo doc list --scope workspace --tree` — Sub-doc now sits under Roadmap.

- [ ] **Step 5: Move Sub-doc back to root**

Run: `lumo doc move "Sub-doc" --root`

Expected: `Moved cmd_xxx "Sub-doc" → root`, exit 0.

Re-run `lumo doc list --scope workspace --tree` — Sub-doc is now a top-level row at depth 0.

- [ ] **Step 6: Verify `--task --tree` works (exercises the server widening from Task 1)**

Run:

```bash
lumo doc bind "Sub-doc" LUM-80
lumo doc list --task LUM-80 --tree
```

Expected: the output renders with proper SCOPE column (`WORKSPACE`) and project column — not blanks. Sub-doc is shown at depth 0 (RFC and Roadmap are not in the task-scoped set, so Sub-doc is its own row).

- [ ] **Step 7: Verify mutual-exclusion and missing-flag error paths**

Run: `lumo doc move "Sub-doc" --parent "Roadmap" --root`

Expected: exits 1, prints `Error: --parent and --root are mutually exclusive`.

Run: `lumo doc move "Sub-doc"`

Expected: exits 1, prints `Error: specify --parent <doc> or --root`.

- [ ] **Step 8: Verify subtree-cycle prevention surfaces server error**

Run: `lumo doc move "Sub-doc" --parent "Sub-doc"`

Expected: exits 1, prints a non-empty `Error: 400 Bad Request: ...` line carrying the server's cycle message.

- [ ] **Step 9: Clean up the test docs (optional, only if not desired in workspace)**

```bash
lumo doc delete "Sub-doc" --yes
lumo doc delete "RFC" --yes
lumo doc delete "Roadmap" --yes
```

Expected: three `Deleted cmd_xxx` lines.

If any step's actual output deviates from the expected output, do NOT proceed to Task 9. Diagnose the offending task, fix it, commit the fix as `fix: ... [LUM-80]`, re-run the acceptance loop.

---

## Task 9: PR creation

**Files:** none modified; this task pushes the branch and opens the PR.

- [ ] **Step 1: Final root typecheck**

Run: `npx tsc --noEmit`

Expected: exits 0.

- [ ] **Step 2: Final CLI typecheck + build**

Run: `cd cli && npx tsc --noEmit && npm run build`

Expected: exits 0.

- [ ] **Step 3: Confirm the branch state**

Run: `git log --oneline main..HEAD`

Expected: a contiguous list of the commits from Tasks 1–7 (and any acceptance-loop fix commits from Task 8), all bearing `[LUM-80]`.

Run: `git status`

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 4: Push the branch and open the PR**

Run:

```bash
git push -u origin lumo/LUM-80-cli-doc-tree
gh pr create --title "feat: CLI doc tree — lumo doc move + --parent on create [LUM-80]" --body "$(cat <<'EOF'
## Summary

- Add `lumo doc move <doc> --parent <doc>|--root` to reparent docs from the CLI
- Add `--parent <doc>` to `lumo doc create` so new docs can be filed under a parent
- Add `--tree` to `lumo doc list` for indented hierarchy output (preserves filter semantics — orphans become virtual roots)
- Widen `findDocumentMentionsByTask` Prisma select with `parentId`, `sortOrder`, `visibility`, `project` so `--task --tree` can render the right columns. Purely additive — the only Web consumer (`taskDocumentsClient.list`) ignores the extra fields. No schema migration.

## Out of scope (deferred follow-ups)

- Re-ordering among siblings (`--before <sibling>` / `--after <sibling>`).
- Bootstrapping CLI Jest infra so the new pure helpers (`doc-tree.ts`, `doc-sort-order.ts`) get unit-test coverage.

## Test plan

- [x] `npx jest __tests__/lib/repositories/misc.repository.test.ts` — passes (server widening covered).
- [x] `npx tsc --noEmit` at repo root — passes.
- [x] `cd cli && npx tsc --noEmit && npm run build` — passes.
- [x] Acceptance commands from the spec ran successfully against the dev workspace (Task 8 of the plan).
- [ ] Reviewer to spot-check `lumo doc list --task <existing LUM-N> --tree` against a task that already has docs bound on the deployed branch.

## Spec / plan

- Spec: `docs/superpowers/specs/2026-05-23-cli-doc-tree-design.md`
- Plan: `docs/superpowers/plans/2026-05-23-cli-doc-tree.md`
EOF
)"
```

Expected: PR URL printed. Report the URL back to the user.

---
