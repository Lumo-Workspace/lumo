# CLI Doc Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `lumo doc create / update / show / list / delete / bind / unbind` from the terminal, with personal/workspace scope and explicit task ↔ doc binding.

**Architecture:** Add a `source` column to `DocumentMention` so CLI-managed bindings survive content-derived re-sync. Add server-side markdown ↔ Tiptap JSON converters so CLI users write markdown while the Web editor keeps reading Tiptap JSON. Wrap the existing `Document` REST surface and the two new `mentions` routes from a thin CLI.

**Tech Stack:** Next.js App Router · TypeScript strict · Prisma · Postgres · Jest · Commander (CLI) · markdown-it (new dep, server-only) for markdown → Tiptap parsing.

**Working directory:** Worktree at `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-66-cli-doc-commands` on branch `lumo/LUM-66-cli-doc-commands`. **All git commands and file paths below assume cwd = this worktree.** Use `git -C <path>` or `cd` to the worktree before running anything.

**Spec:** [docs/superpowers/specs/2026-05-22-cli-doc-commands-design.md](../specs/2026-05-22-cli-doc-commands-design.md)

---

## File Structure

### Server-side (new)
- `lib/utils/markdown-tiptap.ts` — markdown ⇄ Tiptap JSON converters (pure functions)
- `app/api/documents/[id]/mentions/route.ts` — `POST` body `{ taskIdentifier }`
- `app/api/documents/[id]/mentions/[taskId]/route.ts` — `DELETE`
- `prisma/migrations/<ts>_add_document_mention_source/migration.sql` — additive column + enum

### Server-side (modified)
- `prisma/schema.prisma` — `DocMentionSource` enum + `source` column on `DocumentMention`
- `lib/validation/schemas.ts` — `contentMarkdown?` on create + update schemas, new `createDocumentMentionSchema`
- `lib/repositories/document.repository.ts` — `source`-aware sync; `addExplicitMention` / `removeExplicitMention`
- `lib/services/document.service.ts` — accept `contentMarkdown`, expose `addExplicitMention`, `removeExplicitMention`, convert markdown ↔ Tiptap
- `app/api/documents/route.ts` — `POST` accepts `contentMarkdown`
- `app/api/documents/[id]/route.ts` — `PATCH` accepts `contentMarkdown`

### CLI (new)
- `cli/src/lib/resolve-doc.ts` — title-or-cuid lookup
- `cli/src/lib/doc-input.ts` — read `--content` / `--file` / stdin (mutually exclusive)
- `cli/src/commands/doc-create.ts`
- `cli/src/commands/doc-update.ts`
- `cli/src/commands/doc-show.ts`
- `cli/src/commands/doc-list.ts`
- `cli/src/commands/doc-delete.ts`
- `cli/src/commands/doc-bind.ts`
- `cli/src/commands/doc-unbind.ts`

### CLI (modified)
- `cli/src/index.ts` — register subcommands under `lumo doc …`
- `cli/package.json` — bump version

### Docs / config (modified)
- `.claude/skills/lumo/SKILL.md` — trigger words + `## Document Management` section
- `package.json` — add `markdown-it` dep (+`@types/markdown-it` devDep)

### Tests (new)
- `__tests__/lib/markdown-tiptap.test.ts`
- `__tests__/api/documents-mentions.test.ts`
- `__tests__/cli/doc-create-format.test.ts`
- `__tests__/cli/doc-update-format.test.ts`
- `__tests__/cli/doc-show-format.test.ts`
- `__tests__/cli/doc-list-format.test.ts`
- `__tests__/cli/doc-bind-format.test.ts`
- `__tests__/cli/doc-input.test.ts`

### Tests (modified)
- `__tests__/document.service.test.ts` — add cases for explicit mentions + source-aware sync + contentMarkdown
- `__tests__/document.repository.test.ts` — source field roundtrip

---

## Task 1: Add `DocMentionSource` enum + `source` column

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<TIMESTAMP>_add_document_mention_source/migration.sql`

Per CLAUDE.md "Database Migrations" — write SQL by hand, apply with `prisma db execute`, then `prisma migrate resolve --applied` to record. Generate Prisma Client at the end.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Find the `DocVisibility` enum (around line 63) and right below the `DocShareRole` enum, add:

```prisma
enum DocMentionSource {
  CONTENT  // derived from a mention node in document content
  EXPLICIT // created via CLI or explicit API; survives content re-sync
}
```

Find the `DocumentMention` model (around line 936) and add the `source` field:

```prisma
model DocumentMention {
  id         String   @id @default(cuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  taskId     String
  task       Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  source     DocMentionSource @default(CONTENT)

  createdAt DateTime @default(now())

  @@unique([documentId, taskId])
}
```

- [ ] **Step 2: Create the migration SQL**

Pick a timestamp matching today (`date -u +%Y%m%d%H%M%S` to generate one). Use `20260522000000` for this template.

Create `prisma/migrations/20260522000000_add_document_mention_source/migration.sql`:

```sql
CREATE TYPE "DocMentionSource" AS ENUM ('CONTENT', 'EXPLICIT');

ALTER TABLE "DocumentMention"
ADD COLUMN "source" "DocMentionSource" NOT NULL DEFAULT 'CONTENT';
```

- [ ] **Step 3: Apply locally**

```bash
npx prisma db execute --file prisma/migrations/20260522000000_add_document_mention_source/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260522000000_add_document_mention_source
npx prisma generate
```

Expected: `db execute` prints nothing on success; `migrate resolve` prints `Migration <name> recorded as applied`; `generate` regenerates the client.

If `prisma migrate dev` is your habit, NOTE: per CLAUDE.md we use the manual workflow because dev DB drift can otherwise reject the migration. Do **not** run `prisma migrate dev` or `migrate reset` without explicit user approval.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: pass. The new enum is exported from `@prisma/client`; nothing else uses it yet.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260522000000_add_document_mention_source/
git commit -m "feat: add DocMentionSource enum and source column [LUM-66]"
```

---

## Task 2: Markdown ⇄ Tiptap converter (pure functions, TDD)

**Files:**
- Create: `lib/utils/markdown-tiptap.ts`
- Create: `__tests__/lib/markdown-tiptap.test.ts`
- Modify: `package.json` (add `markdown-it` and `@types/markdown-it`)

Supported nodes: paragraph, heading (h1–h6), bullet_list, ordered_list, list_item, code_block (fenced), blockquote. Inline marks: strong, em, code, link. Anything else degrades to plain text. Mentions (`@LUM-N`) are **not** parsed in markdown — explicit `doc bind` is the only path to a `DocumentMention` row from CLI.

Tiptap JSON node shape (matches the existing `extractTaskMentionIds` walker — `node.type`, `node.content`, `node.attrs`, `node.marks`):

```json
{
  "type": "doc",
  "content": [
    { "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }
  ]
}
```

- [ ] **Step 1: Install dep**

```bash
npm install markdown-it
npm install --save-dev @types/markdown-it
```

Expected: lock-file updated; PR description must mention the new dep per CLAUDE.md.

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/markdown-tiptap.test.ts`:

```typescript
import {
  markdownToTiptap,
  tiptapToMarkdown,
} from '@/lib/utils/markdown-tiptap'

describe('markdownToTiptap', () => {
  it('wraps a plain paragraph', () => {
    expect(markdownToTiptap('Hello world')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    })
  })

  it('renders heading levels 1-6', () => {
    const doc = markdownToTiptap('# H1\n## H2\n### H3')
    expect(doc.content).toHaveLength(3)
    expect(doc.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'H1' }],
    })
    expect(doc.content[1]?.attrs).toEqual({ level: 2 })
    expect(doc.content[2]?.attrs).toEqual({ level: 3 })
  })

  it('renders bullet lists', () => {
    const doc = markdownToTiptap('- one\n- two')
    expect(doc.content[0]).toMatchObject({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'one' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'two' }],
            },
          ],
        },
      ],
    })
  })

  it('renders ordered lists', () => {
    const doc = markdownToTiptap('1. one\n2. two')
    expect(doc.content[0]?.type).toBe('orderedList')
  })

  it('renders fenced code blocks with language', () => {
    const doc = markdownToTiptap('```ts\nconst x = 1\n```')
    expect(doc.content[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1\n' }],
    })
  })

  it('applies bold and italic marks', () => {
    const doc = markdownToTiptap('**bold** and *italic*')
    const para = doc.content[0]
    expect(para?.content).toEqual([
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
    ])
  })

  it('applies inline code mark', () => {
    const doc = markdownToTiptap('use `npm test`')
    expect(doc.content[0]?.content).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'text', text: 'npm test', marks: [{ type: 'code' }] },
    ])
  })

  it('emits link marks with href attr', () => {
    const doc = markdownToTiptap('[lumo](https://uselumo.ai)')
    expect(doc.content[0]?.content).toEqual([
      {
        type: 'text',
        text: 'lumo',
        marks: [{ type: 'link', attrs: { href: 'https://uselumo.ai' } }],
      },
    ])
  })

  it('returns an empty doc for empty input', () => {
    expect(markdownToTiptap('')).toEqual({ type: 'doc', content: [] })
  })
})

describe('tiptapToMarkdown', () => {
  it('renders paragraphs and headings', () => {
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body.' }],
        },
      ],
    })
    expect(md).toBe('## Title\n\nBody.\n')
  })

  it('renders bullet and ordered lists', () => {
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
              ],
            },
          ],
        },
      ],
    })
    expect(md).toBe('- a\n- b\n')
  })

  it('renders mention nodes as @LUM-N when identifier attr is present', () => {
    const md = tiptapToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'mention',
              attrs: {
                mentionType: 'task',
                id: 'task_cuid_xx',
                identifier: 'LUM-42',
              },
            },
          ],
        },
      ],
    })
    expect(md).toContain('@LUM-42')
  })

  it('returns empty string for empty doc', () => {
    expect(tiptapToMarkdown({ type: 'doc', content: [] })).toBe('')
  })

  it('renders nothing readable when given malformed input', () => {
    expect(tiptapToMarkdown(null as unknown as object)).toBe('')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest __tests__/lib/markdown-tiptap.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/utils/markdown-tiptap'`.

- [ ] **Step 4: Implement the converter**

Create `lib/utils/markdown-tiptap.ts`:

```typescript
import MarkdownIt from 'markdown-it'

type TiptapMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'code' }
  | { type: 'link'; attrs: { href: string } }

export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

interface MarkdownItToken {
  type: string
  tag: string
  attrs?: [string, string][] | null
  content: string
  children?: MarkdownItToken[] | null
  info?: string
  markup?: string
  level: number
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

/**
 * Parse a markdown string into a Tiptap JSON doc node.
 * Supports paragraphs, headings (h1-h6), bullet/ordered lists, fenced
 * code blocks, blockquotes, and inline marks (bold, italic, code, link).
 * Unsupported nodes degrade to plain text inside a paragraph.
 */
export function markdownToTiptap(input: string): TiptapNode {
  if (!input || input.length === 0) {
    return { type: 'doc', content: [] }
  }
  const tokens = md.parse(input, {}) as MarkdownItToken[]
  const content = blocksFromTokens(tokens)
  return { type: 'doc', content }
}

function blocksFromTokens(tokens: MarkdownItToken[]): TiptapNode[] {
  const out: TiptapNode[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    switch (t.type) {
      case 'paragraph_open': {
        const end = findMatch(tokens, i, 'paragraph_close')
        const inline = tokens[i + 1]
        out.push({
          type: 'paragraph',
          content: inline ? inlineFromToken(inline) : [],
        })
        i = end
        break
      }
      case 'heading_open': {
        const level = parseInt(t.tag.replace('h', ''), 10)
        const end = findMatch(tokens, i, 'heading_close')
        const inline = tokens[i + 1]
        out.push({
          type: 'heading',
          attrs: { level },
          content: inline ? inlineFromToken(inline) : [],
        })
        i = end
        break
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const isOrdered = t.type === 'ordered_list_open'
        const closeType = isOrdered ? 'ordered_list_close' : 'bullet_list_close'
        const end = findMatch(tokens, i, closeType)
        const slice = tokens.slice(i + 1, end)
        out.push({
          type: isOrdered ? 'orderedList' : 'bulletList',
          content: listItemsFromTokens(slice),
        })
        i = end
        break
      }
      case 'fence': {
        out.push({
          type: 'codeBlock',
          attrs: { language: t.info || null },
          content: t.content ? [{ type: 'text', text: t.content }] : [],
        })
        break
      }
      case 'blockquote_open': {
        const end = findMatch(tokens, i, 'blockquote_close')
        const slice = tokens.slice(i + 1, end)
        out.push({ type: 'blockquote', content: blocksFromTokens(slice) })
        i = end
        break
      }
      default:
        // unsupported block: skip; markdown-it emits its inline siblings
        // separately, so dropping the wrapper is safe.
        break
    }
  }
  return out
}

function listItemsFromTokens(tokens: MarkdownItToken[]): TiptapNode[] {
  const items: TiptapNode[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.type === 'list_item_open') {
      const end = findMatch(tokens, i, 'list_item_close')
      const inner = tokens.slice(i + 1, end)
      items.push({ type: 'listItem', content: blocksFromTokens(inner) })
      i = end
    }
  }
  return items
}

function inlineFromToken(t: MarkdownItToken): TiptapNode[] {
  if (!t.children) {
    return t.content ? [{ type: 'text', text: t.content }] : []
  }
  const out: TiptapNode[] = []
  const markStack: TiptapMark[] = []
  for (const child of t.children) {
    switch (child.type) {
      case 'text':
        if (child.content) {
          out.push(makeText(child.content, markStack))
        }
        break
      case 'softbreak':
      case 'hardbreak':
        out.push(makeText('\n', markStack))
        break
      case 'code_inline':
        out.push(makeText(child.content, [...markStack, { type: 'code' }]))
        break
      case 'strong_open':
        markStack.push({ type: 'bold' })
        break
      case 'strong_close':
        markStack.pop()
        break
      case 'em_open':
        markStack.push({ type: 'italic' })
        break
      case 'em_close':
        markStack.pop()
        break
      case 'link_open': {
        const href =
          child.attrs?.find(a => a[0] === 'href')?.[1] ?? ''
        markStack.push({ type: 'link', attrs: { href } })
        break
      }
      case 'link_close':
        markStack.pop()
        break
      default:
        if (child.content) {
          out.push(makeText(child.content, markStack))
        }
    }
  }
  return out
}

function makeText(text: string, marks: TiptapMark[]): TiptapNode {
  const node: TiptapNode = { type: 'text', text }
  if (marks.length > 0) node.marks = marks.map(cloneMark)
  return node
}

function cloneMark(m: TiptapMark): TiptapMark {
  if (m.type === 'link') return { type: 'link', attrs: { ...m.attrs } }
  return { type: m.type } as TiptapMark
}

function findMatch(
  tokens: MarkdownItToken[],
  start: number,
  closeType: string
): number {
  const startLevel = tokens[start]?.level ?? 0
  for (let i = start + 1; i < tokens.length; i++) {
    if (tokens[i]?.type === closeType && tokens[i]?.level === startLevel) {
      return i
    }
  }
  return tokens.length - 1
}

/**
 * Render a Tiptap JSON doc node back to markdown text.
 * Best-effort: paragraphs, headings, lists, code blocks, mention nodes.
 * Returns '' for null/non-object input.
 */
export function tiptapToMarkdown(doc: TiptapNode | object): string {
  if (!doc || typeof doc !== 'object') return ''
  const node = doc as TiptapNode
  if (!Array.isArray(node.content)) return ''
  const lines = node.content.map(renderBlock).filter(Boolean)
  return lines.join('\n')
}

function renderBlock(block: TiptapNode): string {
  switch (block.type) {
    case 'paragraph':
      return renderInlines(block.content ?? []) + '\n'
    case 'heading': {
      const level = (block.attrs?.level as number | undefined) ?? 1
      return '#'.repeat(level) + ' ' + renderInlines(block.content ?? []) + '\n\n'
    }
    case 'bulletList':
      return (
        (block.content ?? [])
          .map(item => '- ' + renderListItem(item))
          .join('\n') + '\n'
      )
    case 'orderedList':
      return (
        (block.content ?? [])
          .map((item, idx) => `${idx + 1}. ` + renderListItem(item))
          .join('\n') + '\n'
      )
    case 'codeBlock': {
      const lang = (block.attrs?.language as string | undefined) ?? ''
      const body = (block.content ?? [])
        .map(c => c.text ?? '')
        .join('')
      return '```' + lang + '\n' + body + '```\n'
    }
    case 'blockquote':
      return (
        (block.content ?? [])
          .map(b => '> ' + renderBlock(b))
          .join('') + '\n'
      )
    default:
      return ''
  }
}

function renderListItem(item: TiptapNode): string {
  const blocks = item.content ?? []
  return blocks.map(b => renderInlines(b.content ?? [])).join(' ')
}

function renderInlines(nodes: TiptapNode[]): string {
  return nodes.map(renderInline).join('')
}

function renderInline(node: TiptapNode): string {
  if (node.type === 'mention') {
    const ident = (node.attrs?.identifier as string | undefined) ?? ''
    return ident ? `@${ident}` : ''
  }
  if (node.type !== 'text') return ''
  let text = node.text ?? ''
  if (!node.marks) return text
  for (const mark of node.marks) {
    switch (mark.type) {
      case 'bold':
        text = `**${text}**`
        break
      case 'italic':
        text = `*${text}*`
        break
      case 'code':
        text = `\`${text}\``
        break
      case 'link': {
        const href = mark.attrs?.href ?? ''
        text = `[${text}](${href})`
        break
      }
    }
  }
  return text
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest __tests__/lib/markdown-tiptap.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add lib/utils/markdown-tiptap.ts __tests__/lib/markdown-tiptap.test.ts package.json package-lock.json
git commit -m "feat: markdown ⇄ Tiptap JSON converter [LUM-66]"
```

---

## Task 3: Repository — source-aware mention CRUD and sync

**Files:**
- Modify: `lib/repositories/document.repository.ts`
- Modify: `__tests__/document.repository.test.ts`

Two new methods + change `updateWithChildrenAndMentions` to only replace `source = CONTENT` rows.

- [ ] **Step 1: Write the failing test**

Open `__tests__/document.repository.test.ts`. The file already mocks `prisma`. Add these cases at the bottom of the file (inside the existing top-level `describe` or alongside it):

```typescript
import { documentRepository } from '@/lib/repositories/document.repository'

describe('documentRepository — explicit mentions', () => {
  it('addExplicitMention upserts a row with source EXPLICIT', async () => {
    // Mock setup: see how prisma is mocked at the top of this file and
    // mirror the same pattern. The mock should accept upsert and return
    // a row with source EXPLICIT.
    const row = await documentRepository.addExplicitMention('doc1', 'task1')
    expect(row.source).toBe('EXPLICIT')
  })

  it('removeExplicitMention only deletes EXPLICIT rows', async () => {
    const deleted = await documentRepository.removeExplicitMention(
      'doc1',
      'task1'
    )
    expect(deleted).toBe(1)
  })

  it('removeExplicitMention returns 0 when the row is CONTENT-sourced', async () => {
    const deleted = await documentRepository.removeExplicitMention(
      'doc-with-content-mention',
      'task1'
    )
    expect(deleted).toBe(0)
  })
})

describe('documentRepository — sync preserves EXPLICIT', () => {
  it('updateWithChildrenAndMentions does not delete EXPLICIT rows when content-derived sync runs', async () => {
    // Existing rows: [{taskId: 't1', source: CONTENT}, {taskId: 't2', source: EXPLICIT}]
    // mentionTaskIds (derived from new content): ['t3']
    // After sync, t1 should be gone (CONTENT replaced), t2 should remain (EXPLICIT preserved), t3 should be added with CONTENT.
    const deleteManyCalls: unknown[] = []
    const createManyCalls: unknown[] = []
    // Configure the mocked prisma.$transaction tx.documentMention to:
    //   findMany → [{taskId:'t1',source:'CONTENT'},{taskId:'t2',source:'EXPLICIT'}]
    //   deleteMany → record args into deleteManyCalls
    //   createMany → record args into createManyCalls
    // (See existing tests in this file for the mocking convention.)
    await documentRepository.updateWithChildrenAndMentions(
      'doc1',
      {},
      undefined,
      ['t3']
    )
    // deleteMany must be scoped to source CONTENT
    expect(deleteManyCalls[0]).toMatchObject({
      where: { documentId: 'doc1', taskId: { in: ['t1'] }, source: 'CONTENT' },
    })
    // createMany must default new rows to source CONTENT
    expect(createManyCalls[0]).toMatchObject({
      data: [{ documentId: 'doc1', taskId: 't3', source: 'CONTENT' }],
    })
  })
})
```

> Note: the placeholder comments describe how to wire the prisma mock — adapt to the existing mocking style in this file (jest.mock at top + per-test resets).

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/document.repository.test.ts
```

Expected: 4 failing cases.

- [ ] **Step 3: Implement repository changes**

Open `lib/repositories/document.repository.ts`. After the `update` method (around line 213), add:

```typescript
  /**
   * Add or upgrade a doc↔task mention as EXPLICIT.
   * If an existing CONTENT-sourced row exists, upgrade it.
   * If an EXPLICIT row exists, no-op.
   */
  async addExplicitMention(documentId: string, taskId: string) {
    return prisma.documentMention.upsert({
      where: { documentId_taskId: { documentId, taskId } },
      create: { documentId, taskId, source: 'EXPLICIT' },
      update: { source: 'EXPLICIT' },
    })
  },

  /**
   * Delete an explicit mention. Returns the number of rows deleted (0 or 1).
   * Refuses to delete CONTENT-sourced rows.
   */
  async removeExplicitMention(documentId: string, taskId: string): Promise<number> {
    const result = await prisma.documentMention.deleteMany({
      where: { documentId, taskId, source: 'EXPLICIT' },
    })
    return result.count
  },

  /** Returns whether a row exists for (documentId, taskId) and what source it has. */
  async findMention(documentId: string, taskId: string) {
    return prisma.documentMention.findUnique({
      where: { documentId_taskId: { documentId, taskId } },
      select: { source: true },
    })
  },
```

Then find `updateWithChildrenAndMentions` (line 215). Locate the mention-sync block (lines ~246–266). Replace it with:

```typescript
      // Sync mentions if mentionTaskIds is provided.
      // Only replaces source=CONTENT rows; EXPLICIT rows are preserved.
      if (mentionTaskIds !== undefined) {
        const existing = await tx.documentMention.findMany({
          where: { documentId: id, source: 'CONTENT' },
          select: { taskId: true },
        })
        const existingIds = new Set(existing.map(m => m.taskId))
        const newIds = new Set(mentionTaskIds)

        const toDelete = [...existingIds].filter(mid => !newIds.has(mid))
        if (toDelete.length > 0) {
          await tx.documentMention.deleteMany({
            where: {
              documentId: id,
              taskId: { in: toDelete },
              source: 'CONTENT',
            },
          })
        }

        // Determine which mentionTaskIds need a new row. Skip any that
        // already exist as EXPLICIT (those count as bound already).
        const allExisting = await tx.documentMention.findMany({
          where: { documentId: id },
          select: { taskId: true },
        })
        const everExisting = new Set(allExisting.map(m => m.taskId))
        const toCreate = [...newIds].filter(mid => !everExisting.has(mid))
        if (toCreate.length > 0) {
          await tx.documentMention.createMany({
            data: toCreate.map(taskId => ({
              documentId: id,
              taskId,
              source: 'CONTENT',
            })),
          })
        }
      }
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/document.repository.test.ts
```

Expected: all 4 new cases pass; all prior tests pass.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/document.repository.ts __tests__/document.repository.test.ts
git commit -m "feat: source-aware DocumentMention CRUD and sync [LUM-66]"
```

---

## Task 4: Service — explicit mention API + contentMarkdown support

**Files:**
- Modify: `lib/services/document.service.ts`
- Modify: `__tests__/document.service.test.ts`

Three new service methods + accept `contentMarkdown` on create/update.

- [ ] **Step 1: Write the failing test**

In `__tests__/document.service.test.ts`, add (adapt mocks to match existing style):

```typescript
describe('documentService — explicit mentions', () => {
  it('addExplicitMention upgrades an existing CONTENT row to EXPLICIT', async () => {
    // Mock: findMention → { source: 'CONTENT' }
    // Mock: addExplicitMention → upsert result with source: 'EXPLICIT'
    const result = await documentService.addExplicitMention(
      'doc1',
      'LUM-42',
      'workspace1',
      'member1'
    )
    expect(result.upgradedFromContent).toBe(true)
    expect(result.source).toBe('EXPLICIT')
  })

  it('addExplicitMention is idempotent when row is already EXPLICIT', async () => {
    const result = await documentService.addExplicitMention(
      'doc1',
      'LUM-42',
      'workspace1',
      'member1'
    )
    expect(result.alreadyBound).toBe(true)
  })

  it('removeExplicitMention returns refused when row is CONTENT-only', async () => {
    const result = await documentService.removeExplicitMention(
      'doc1',
      'LUM-42',
      'workspace1',
      'member1'
    )
    expect(result.refused).toBe(true)
    expect(result.reason).toMatch(/content-derived/i)
  })

  it('removeExplicitMention is idempotent when no row exists', async () => {
    const result = await documentService.removeExplicitMention(
      'doc1',
      'LUM-999',
      'workspace1',
      'member1'
    )
    expect(result.removed).toBe(0)
  })
})

describe('documentService — contentMarkdown', () => {
  it('createDocument with contentMarkdown stores converted Tiptap JSON', async () => {
    const result = await documentService.createDocument(
      'workspace1',
      'member1',
      {
        title: 't',
        visibility: 'PRIVATE',
        contentMarkdown: '# Hello',
      }
    )
    // Inspect the JSON that was written to content (via repository mock):
    expect(result.content).toContain('"type":"heading"')
    expect(result.content).toContain('"level":1')
  })

  it('updateDocument with contentMarkdown overwrites content', async () => {
    const result = await documentService.updateDocument(
      'doc1',
      'member1',
      'workspace1',
      { contentMarkdown: 'just text' }
    )
    expect(result.content).toContain('paragraph')
  })

  it('updateDocument rejects passing both content and contentMarkdown', async () => {
    await expect(
      documentService.updateDocument('doc1', 'member1', 'workspace1', {
        content: '{}',
        contentMarkdown: 'x',
      })
    ).rejects.toThrow(/mutually exclusive/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/document.service.test.ts
```

Expected: 7 failing cases.

- [ ] **Step 3: Implement service changes**

Open `lib/services/document.service.ts`. At the top, add:

```typescript
import { markdownToTiptap } from '@/lib/utils/markdown-tiptap'
import { taskRepository } from '@/lib/repositories/task.repository'
```

(If `taskRepository` lookup helper for identifiers doesn't exist, use `prisma.task.findUnique` via a small private helper — but check what the codebase already provides under `lib/repositories/task.repository.ts`; reuse first.)

Extend the existing input types:

```typescript
export interface CreateDocumentInput {
  title: string
  emoji?: string | null
  parentId?: string | null
  projectId?: string | null
  visibility: 'WORKSPACE' | 'PRIVATE' | 'SHARED'
  contentMarkdown?: string
}

export interface UpdateDocumentInput {
  title?: string
  content?: string | null
  contentMarkdown?: string
  emoji?: string | null
  visibility?: string
  projectId?: string | null
  sortOrder?: number
  publicToken?: string | null
  tags?: string[]
  tagIds?: string[]
  childOrder?: string[]
}
```

In `createDocument`, before the `documentRepository.create` call, if `data.contentMarkdown` is set, convert it and pass `content` through:

```typescript
    const content =
      data.contentMarkdown !== undefined
        ? JSON.stringify(markdownToTiptap(data.contentMarkdown))
        : null
    const document = await documentRepository.create({
      // ... existing fields
      content,
      sortOrder: maxSortOrder + 1,
    })
    // If we set content on create, run mention sync derived from it.
    if (content) {
      await this.syncDocumentMentions(document.id, content)
    }
```

> If `documentRepository.create` does not currently accept `content`, add it to `CreateDocumentData` and to the prisma create call. This is a one-line addition.

In `updateDocument`, near the top after the permission checks but before assembling `updateData`, add the mutual-exclusion check and conversion:

```typescript
    if (data.content !== undefined && data.contentMarkdown !== undefined) {
      throw Object.assign(
        new Error('content and contentMarkdown are mutually exclusive'),
        { status: 400 }
      )
    }
    if (data.contentMarkdown !== undefined) {
      data.content = JSON.stringify(markdownToTiptap(data.contentMarkdown))
    }
```

After all existing methods in the service object, add:

```typescript
  /**
   * Add an explicit doc↔task binding by task identifier (LUM-N) or cuid.
   * Returns metadata about whether it was newly created, idempotent, or upgraded from CONTENT.
   */
  async addExplicitMention(
    documentId: string,
    taskIdentifier: string,
    workspaceId: string,
    memberId: string
  ) {
    const doc = await documentRepository.findWithPermission(
      documentId,
      memberId,
      workspaceId
    )
    if (!doc) {
      throw Object.assign(new Error('Document not found'), { status: 404 })
    }
    const role = this.getUserRole(doc, memberId)
    if (!role || role === 'VIEWER') {
      throw Object.assign(new Error('Permission denied'), { status: 403 })
    }

    const task = await this.resolveTask(taskIdentifier, workspaceId)
    if (!task) {
      throw Object.assign(new Error(`Task not found: ${taskIdentifier}`), {
        status: 404,
      })
    }

    const existing = await documentRepository.findMention(documentId, task.id)
    const row = await documentRepository.addExplicitMention(documentId, task.id)

    return {
      taskId: task.id,
      taskIdentifier: task.identifier,
      source: row.source,
      alreadyBound: existing?.source === 'EXPLICIT',
      upgradedFromContent: existing?.source === 'CONTENT',
    }
  },

  /**
   * Remove an explicit mention. Refuses to remove CONTENT-only rows.
   */
  async removeExplicitMention(
    documentId: string,
    taskIdentifier: string,
    workspaceId: string,
    memberId: string
  ) {
    const doc = await documentRepository.findWithPermission(
      documentId,
      memberId,
      workspaceId
    )
    if (!doc) {
      throw Object.assign(new Error('Document not found'), { status: 404 })
    }
    const role = this.getUserRole(doc, memberId)
    if (!role || role === 'VIEWER') {
      throw Object.assign(new Error('Permission denied'), { status: 403 })
    }

    const task = await this.resolveTask(taskIdentifier, workspaceId)
    if (!task) {
      throw Object.assign(new Error(`Task not found: ${taskIdentifier}`), {
        status: 404,
      })
    }

    const existing = await documentRepository.findMention(documentId, task.id)
    if (existing && existing.source === 'CONTENT') {
      return {
        removed: 0,
        refused: true,
        reason:
          'Cannot unbind a content-derived mention; remove the @LUM-N from the doc body instead.',
        taskIdentifier: task.identifier,
      }
    }

    const removed = await documentRepository.removeExplicitMention(
      documentId,
      task.id
    )
    return { removed, taskIdentifier: task.identifier }
  },

  /** Resolve task by identifier (LUM-N) or cuid within a workspace. */
  async resolveTask(input: string, workspaceId: string) {
    const trimmed = input.trim()
    if (/^LUM-\d+$/i.test(trimmed)) {
      return prisma.task.findFirst({
        where: { identifier: trimmed.toUpperCase(), project: { workspaceId } },
        select: { id: true, identifier: true },
      })
    }
    return prisma.task.findFirst({
      where: { id: trimmed, project: { workspaceId } },
      select: { id: true, identifier: true },
    })
  },
```

> If `prisma` is not imported in this file yet, add `import { prisma } from '@/lib/db/prisma'` at the top.

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/document.service.test.ts
```

Expected: all new cases pass; existing tests pass.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add lib/services/document.service.ts __tests__/document.service.test.ts
git commit -m "feat: documentService explicit mentions and contentMarkdown [LUM-66]"
```

---

## Task 5: Validation schemas — contentMarkdown + mention schema

**Files:**
- Modify: `lib/validation/schemas.ts`

- [ ] **Step 1: Write the failing test (skip — schemas are exercised by the API route tests added in later tasks)**

This task has no dedicated test file because the field is purely additive on the existing schemas and is covered by the API route tests below. Move straight to implementation.

- [ ] **Step 2: Edit schemas.ts**

Find `createDocumentSchema` (around line 268). Add `contentMarkdown`:

```typescript
export const createDocumentSchema = z.object({
  title: z.string().trim().max(500).optional().default(''),
  emoji: z.string().max(10).nullable().optional(),
  parentId: z.string().cuid().nullable().optional(),
  projectId: z.string().cuid().nullable().optional(),
  workspaceId: z.string().cuid().optional(),
  visibility: z
    .enum(['PRIVATE', 'SHARED', 'WORKSPACE'])
    .optional()
    .default('PRIVATE'),
  contentMarkdown: z.string().max(500000).optional(),
})
```

Find `updateDocumentSchema` (around line 283). Add `contentMarkdown`:

```typescript
export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  content: z.string().max(500000).nullable().optional(),
  contentMarkdown: z.string().max(500000).optional(),
  emoji: z.string().max(10).nullable().optional(),
  visibility: z.enum(['PRIVATE', 'SHARED', 'WORKSPACE']).optional(),
  projectId: z.string().cuid().nullable().optional(),
  sortOrder: z.number().optional(),
  childOrder: z.array(z.string()).optional(),
  publicToken: z.string().max(30).nullable().optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
  tagIds: z.array(z.string().cuid()).max(20).optional(),
})
```

After `updateDocumentSchema`, add a new schema for mention creation:

```typescript
export const createDocumentMentionSchema = z.object({
  taskIdentifier: z
    .string()
    .trim()
    .min(1, 'taskIdentifier is required')
    .max(100),
})
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add lib/validation/schemas.ts
git commit -m "feat: contentMarkdown on doc schemas, createDocumentMentionSchema [LUM-66]"
```

---

## Task 6: API — extend `POST /api/documents` to accept `contentMarkdown`

**Files:**
- Modify: `app/api/documents/route.ts`

- [ ] **Step 1: Edit route**

Find the `POST` handler. The current body destructuring is:

```typescript
  const {
    title,
    emoji,
    parentId: docParentId,
    projectId: docProjectId,
    visibility,
  } = parsed.data
```

Replace with:

```typescript
  const {
    title,
    emoji,
    parentId: docParentId,
    projectId: docProjectId,
    visibility,
    contentMarkdown,
  } = parsed.data
```

Update the `documentService.createDocument` call to pass it through:

```typescript
  const document = await documentService.createDocument(
    ws.workspaceId,
    ws.member.id,
    {
      title,
      visibility,
      emoji: emoji ?? null,
      parentId: docParentId ?? null,
      projectId: docProjectId ?? null,
      contentMarkdown,
    }
  )
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/documents/route.ts
git commit -m "feat: POST /api/documents accepts contentMarkdown [LUM-66]"
```

---

## Task 7: API — extend `PATCH /api/documents/[id]` to accept `contentMarkdown`

**Files:**
- Modify: `app/api/documents/[id]/route.ts`

- [ ] **Step 1: Edit route**

In the `PATCH` handler, the existing block that copies parsed fields into `data` (around line 60–80) needs `contentMarkdown` added. Find the line:

```typescript
    if (parsed.data.content !== undefined) data.content = parsed.data.content
```

Add immediately after:

```typescript
    if (parsed.data.contentMarkdown !== undefined)
      data.contentMarkdown = parsed.data.contentMarkdown
```

`UpdateDocumentInput` already has the field after Task 4 — no other changes needed in this route.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/documents/[id]/route.ts
git commit -m "feat: PATCH /api/documents accepts contentMarkdown [LUM-66]"
```

---

## Task 8: API — `POST /api/documents/[id]/mentions`

**Files:**
- Create: `app/api/documents/[id]/mentions/route.ts`
- Create: `__tests__/api/documents-mentions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/documents-mentions.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import { POST } from '@/app/api/documents/[id]/mentions/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(() => Promise.resolve({ userId: 'user_clerk_1' })),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireUserWorkspace: jest.fn(() =>
    Promise.resolve({
      workspaceId: 'ws1',
      member: { id: 'member1' },
    })
  ),
  zodError: jest.fn(() => new Response('zod', { status: 400 })),
}))
jest.mock('@/lib/services', () => ({
  documentService: {
    addExplicitMention: jest.fn(() =>
      Promise.resolve({
        taskId: 'task_cuid_1',
        taskIdentifier: 'LUM-42',
        source: 'EXPLICIT',
        alreadyBound: false,
        upgradedFromContent: false,
      })
    ),
  },
}))

function mkReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc1/mentions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/[id]/mentions', () => {
  it('binds a doc to a task and returns 201', async () => {
    const res = await POST(mkReq({ taskIdentifier: 'LUM-42' }), {
      params: Promise.resolve({ id: 'doc1' }),
    })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.mention.taskIdentifier).toBe('LUM-42')
  })

  it('rejects empty taskIdentifier', async () => {
    const res = await POST(mkReq({ taskIdentifier: '' }), {
      params: Promise.resolve({ id: 'doc1' }),
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/api/documents-mentions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the route**

Create `app/api/documents/[id]/mentions/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createDocumentMentionSchema } from '@/lib/validation/schemas'
import { documentService } from '@/lib/services'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const body = await request.json()
  const parsed = createDocumentMentionSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const mention = await documentService.addExplicitMention(
      id,
      parsed.data.taskIdentifier,
      ws.workspaceId,
      ws.member.id
    )
    return NextResponse.json({ mention }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/api/documents-mentions.test.ts
```

Expected: 2 cases pass.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/documents/[id]/mentions/route.ts __tests__/api/documents-mentions.test.ts
git commit -m "feat: POST /api/documents/[id]/mentions [LUM-66]"
```

---

## Task 9: API — `DELETE /api/documents/[id]/mentions/[taskId]`

**Files:**
- Create: `app/api/documents/[id]/mentions/[taskId]/route.ts`
- Modify: `__tests__/api/documents-mentions.test.ts` (add DELETE cases)

- [ ] **Step 1: Add tests**

Append to `__tests__/api/documents-mentions.test.ts`:

```typescript
import { DELETE } from '@/app/api/documents/[id]/mentions/[taskId]/route'

jest.mock('@/lib/services', () => ({
  documentService: {
    addExplicitMention: jest.fn(),
    removeExplicitMention: jest.fn(),
  },
}))

describe('DELETE /api/documents/[id]/mentions/[taskId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('removes an EXPLICIT mention and returns 200', async () => {
    const { documentService } = require('@/lib/services')
    documentService.removeExplicitMention.mockResolvedValueOnce({
      removed: 1,
      taskIdentifier: 'LUM-42',
    })
    const req = new NextRequest(
      'http://localhost/api/documents/doc1/mentions/task1',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ id: 'doc1', taskId: 'task1' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.removed).toBe(1)
  })

  it('returns 409 when refused (CONTENT-only mention)', async () => {
    const { documentService } = require('@/lib/services')
    documentService.removeExplicitMention.mockResolvedValueOnce({
      removed: 0,
      refused: true,
      reason: 'Cannot unbind a content-derived mention…',
    })
    const req = new NextRequest(
      'http://localhost/api/documents/doc1/mentions/task1',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ id: 'doc1', taskId: 'task1' }),
    })
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/api/documents-mentions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the route**

Create `app/api/documents/[id]/mentions/[taskId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { documentService } from '@/lib/services'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id, taskId } = await params

  try {
    const result = await documentService.removeExplicitMention(
      id,
      taskId,
      ws.workspaceId,
      ws.member.id
    )
    if ('refused' in result && result.refused) {
      return NextResponse.json(
        { error: result.reason, removed: 0 },
        { status: 409 }
      )
    }
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/api/documents-mentions.test.ts
```

Expected: all 4 cases pass.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add app/api/documents/[id]/mentions/[taskId]/route.ts __tests__/api/documents-mentions.test.ts
git commit -m "feat: DELETE /api/documents/[id]/mentions/[taskId] [LUM-66]"
```

---

## Task 10: CLI lib — `resolve-doc.ts`

**Files:**
- Create: `cli/src/lib/resolve-doc.ts`
- Create: `__tests__/cli/resolve-doc.test.ts`

The lookup mirrors the milestone resolver: cuid-shaped input → ID lookup; otherwise → title (case-insensitive) match. Ambiguity → return list of candidates so the caller can format an error.

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/resolve-doc.test.ts`:

```typescript
import { resolveDoc, isLikelyCuid } from '@/cli/src/lib/resolve-doc'

describe('isLikelyCuid', () => {
  it('matches cuid v1 format (c + 24 chars)', () => {
    expect(isLikelyCuid('cmd12345678901234567890ab')).toBe(true)
  })
  it('rejects short or non-c-prefixed strings', () => {
    expect(isLikelyCuid('RFC: doc CLI')).toBe(false)
    expect(isLikelyCuid('abc')).toBe(false)
  })
})

describe('resolveDoc', () => {
  const docs = [
    { id: 'c1aaaaaaaaaaaaaaaaaaaaaaa', title: 'RFC: doc CLI' },
    { id: 'c2bbbbbbbbbbbbbbbbbbbbbbb', title: 'Roadmap' },
    { id: 'c3ccccccccccccccccccccccc', title: 'roadmap' },
  ]

  it('returns the doc with matching cuid', () => {
    const result = resolveDoc('c2bbbbbbbbbbbbbbbbbbbbbbb', docs)
    expect(result.kind).toBe('found')
    if (result.kind === 'found') expect(result.doc.title).toBe('Roadmap')
  })

  it('returns case-insensitive title match (single hit)', () => {
    const result = resolveDoc('rfc: DOC cli', docs)
    expect(result.kind).toBe('found')
  })

  it('reports ambiguous on multiple title matches', () => {
    const result = resolveDoc('roadmap', docs)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') expect(result.candidates).toHaveLength(2)
  })

  it('returns not-found when nothing matches', () => {
    const result = resolveDoc('nothing here', docs)
    expect(result.kind).toBe('not-found')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/cli/resolve-doc.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `cli/src/lib/resolve-doc.ts`:

```typescript
export interface DocLike {
  id: string
  title: string
}

export type ResolveResult =
  | { kind: 'found'; doc: DocLike }
  | { kind: 'ambiguous'; candidates: DocLike[] }
  | { kind: 'not-found' }

/** A loose check — a real cuid is 'c' + 24 base36 chars. */
export function isLikelyCuid(s: string): boolean {
  return /^c[a-z0-9]{20,}$/i.test(s)
}

/**
 * Resolve a user-typed doc reference against a list. If the input looks
 * like a cuid, do exact-id match; otherwise do case-insensitive title
 * match. Multiple title hits return 'ambiguous' so the caller can list
 * candidates.
 */
export function resolveDoc(input: string, docs: DocLike[]): ResolveResult {
  const trimmed = input.trim()
  if (isLikelyCuid(trimmed)) {
    const doc = docs.find(d => d.id === trimmed)
    return doc ? { kind: 'found', doc } : { kind: 'not-found' }
  }
  const lower = trimmed.toLowerCase()
  const hits = docs.filter(d => d.title.toLowerCase() === lower)
  if (hits.length === 0) return { kind: 'not-found' }
  if (hits.length === 1) return { kind: 'found', doc: hits[0]! }
  return { kind: 'ambiguous', candidates: hits }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/cli/resolve-doc.test.ts
```

Expected: 6 cases pass.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add cli/src/lib/resolve-doc.ts __tests__/cli/resolve-doc.test.ts
git commit -m "feat: cli/lib/resolve-doc [LUM-66]"
```

---

## Task 11: CLI lib — `doc-input.ts`

**Files:**
- Create: `cli/src/lib/doc-input.ts`
- Create: `__tests__/cli/doc-input.test.ts`

Mutually-exclusive resolution of `--content`, `--file`, and stdin. If stdin is a TTY (no real pipe), treat as "no content".

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/doc-input.test.ts`:

```typescript
import { resolveDocContent } from '@/cli/src/lib/doc-input'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('resolveDocContent', () => {
  it('returns content from --content', async () => {
    const result = await resolveDocContent({
      content: 'hi',
      file: undefined,
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async () => '',
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('hi')
  })

  it('returns content from --file', async () => {
    const tmp = path.join(os.tmpdir(), 'lumo-doc-test.md')
    fs.writeFileSync(tmp, '# Hello')
    const result = await resolveDocContent({
      content: undefined,
      file: tmp,
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async p => fs.promises.readFile(p, 'utf8'),
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('# Hello')
    fs.unlinkSync(tmp)
  })

  it('returns content from stdin when not a TTY', async () => {
    const result = await resolveDocContent({
      content: undefined,
      file: undefined,
      stdinIsTTY: false,
      readStdin: async () => '## piped',
      readFile: async () => '',
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('## piped')
  })

  it('returns none when nothing is provided and stdin is a TTY', async () => {
    const result = await resolveDocContent({
      content: undefined,
      file: undefined,
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async () => '',
    })
    expect(result.kind).toBe('none')
  })

  it('errors when --content and --file are both set', async () => {
    const result = await resolveDocContent({
      content: 'a',
      file: '/tmp/b.md',
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async () => '',
    })
    expect(result.kind).toBe('error')
  })

  it('errors when --content and stdin pipe are both set', async () => {
    const result = await resolveDocContent({
      content: 'a',
      file: undefined,
      stdinIsTTY: false,
      readStdin: async () => 'b',
      readFile: async () => '',
    })
    expect(result.kind).toBe('error')
  })

  it('errors when --file and stdin pipe are both set', async () => {
    const result = await resolveDocContent({
      content: undefined,
      file: '/tmp/x.md',
      stdinIsTTY: false,
      readStdin: async () => 'b',
      readFile: async () => '',
    })
    expect(result.kind).toBe('error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/cli/doc-input.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `cli/src/lib/doc-input.ts`:

```typescript
import * as fs from 'fs'

export interface ResolveDocContentArgs {
  content: string | undefined
  file: string | undefined
  stdinIsTTY: boolean
  readStdin: () => Promise<string>
  readFile: (path: string) => Promise<string>
}

export type ResolveDocContentResult =
  | { kind: 'ok'; markdown: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

/**
 * Pick one of --content / --file / stdin as the markdown source.
 * The three are mutually exclusive; specifying more than one is an error.
 * If none of them are set and stdin is a TTY, returns 'none' (caller decides
 * whether that means "create empty doc" or "leave content unchanged").
 */
export async function resolveDocContent(
  args: ResolveDocContentArgs
): Promise<ResolveDocContentResult> {
  const hasContent = args.content !== undefined
  const hasFile = args.file !== undefined && args.file.length > 0
  const hasStdin = !args.stdinIsTTY

  const set = [hasContent, hasFile, hasStdin].filter(Boolean).length
  if (set > 1) {
    return {
      kind: 'error',
      message:
        '--content, --file, and stdin are mutually exclusive (pick one)',
    }
  }

  if (hasContent) return { kind: 'ok', markdown: args.content as string }
  if (hasFile) {
    const text = await args.readFile(args.file as string)
    return { kind: 'ok', markdown: text }
  }
  if (hasStdin) {
    const text = await args.readStdin()
    return { kind: 'ok', markdown: text }
  }
  return { kind: 'none' }
}

/** Read stdin to end as UTF-8 string. Used as the default readStdin. */
export function readStdinToString(): Promise<string> {
  return new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => (buf += chunk))
    process.stdin.on('end', () => resolve(buf))
  })
}

/** Default readFile wrapper for production CLI use. */
export function readFileUtf8(path: string): Promise<string> {
  return fs.promises.readFile(path, 'utf8')
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/cli/doc-input.test.ts
```

Expected: 7 cases pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/doc-input.ts __tests__/cli/doc-input.test.ts
git commit -m "feat: cli/lib/doc-input (--content/--file/stdin) [LUM-66]"
```

---

## Task 12: CLI — `doc create`

**Files:**
- Create: `cli/src/commands/doc-create.ts`
- Create: `__tests__/cli/doc-create-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/doc-create-format.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import {
  formatCreatedDocLine,
  normalizeScope,
} from '@/cli/src/commands/doc-create'

describe('formatCreatedDocLine', () => {
  it('renders cuid, quoted title, and URL', () => {
    expect(
      formatCreatedDocLine({
        id: 'cmdxxxxxxxxxxxxxxxxxxxxx',
        title: 'RFC: doc CLI',
        url: 'https://www.uselumo.ai/workspace/lumo/documents/cmdxxxxxxxxxxxxxxxxxxxxx',
      })
    ).toBe(
      'Created cmdxxxxxxxxxxxxxxxxxxxxx "RFC: doc CLI"  https://www.uselumo.ai/workspace/lumo/documents/cmdxxxxxxxxxxxxxxxxxxxxx'
    )
  })

  it('escapes embedded double-quotes', () => {
    expect(
      formatCreatedDocLine({
        id: 'c1',
        title: 'has "quotes"',
        url: 'https://x',
      })
    ).toContain('"has \\"quotes\\""')
  })
})

describe('normalizeScope', () => {
  it('maps personal to PRIVATE', () => {
    expect(normalizeScope('personal')).toBe('PRIVATE')
    expect(normalizeScope('Personal')).toBe('PRIVATE')
  })
  it('maps workspace to WORKSPACE', () => {
    expect(normalizeScope('workspace')).toBe('WORKSPACE')
  })
  it('returns null for invalid', () => {
    expect(normalizeScope('shared')).toBeNull()
    expect(normalizeScope('xyz')).toBeNull()
    expect(normalizeScope('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/cli/doc-create-format.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `cli/src/commands/doc-create.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import {
  resolveDocContent,
  readStdinToString,
  readFileUtf8,
} from '../lib/doc-input'

export type Scope = 'PRIVATE' | 'WORKSPACE'

export interface CreateDocOptions {
  content?: string
  file?: string
  scope?: string
  project?: string
  task?: string
}

interface CreatedDocResponse {
  document: {
    id: string
    title: string
  }
}

/** personal → PRIVATE, workspace → WORKSPACE. Null on unknown. */
export function normalizeScope(value: string): Scope | null {
  const lower = (value ?? '').toLowerCase()
  if (lower === 'personal') return 'PRIVATE'
  if (lower === 'workspace') return 'WORKSPACE'
  return null
}

export function formatCreatedDocLine(doc: {
  id: string
  title: string
  url: string
}): string {
  const escaped = doc.title.replace(/"/g, '\\"')
  return `Created ${doc.id} "${escaped}"  ${doc.url}`
}

function docUrl(apiUrl: string, workspaceSlug: string, id: string): string {
  return `${trimTrailingSlash(apiUrl)}/workspace/${workspaceSlug}/documents/${id}`
}

export async function docCreate(
  title: string | undefined,
  opts: CreateDocOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  // Default scope = PRIVATE (personal)
  let visibility: Scope = 'PRIVATE'
  if (opts.scope !== undefined) {
    const normalized = normalizeScope(opts.scope)
    if (!normalized) {
      console.error(
        `Error: invalid scope "${opts.scope}". Allowed: personal, workspace`
      )
      return 1
    }
    visibility = normalized
  }

  // Resolve content from --content / --file / stdin
  const content = await resolveDocContent({
    content: opts.content,
    file: opts.file,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readStdin: readStdinToString,
    readFile: readFileUtf8,
  })
  if (content.kind === 'error') {
    console.error(`Error: ${content.message}`)
    return 1
  }

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const url = `${trimTrailingSlash(apiUrl)}/api/documents`

  const body: Record<string, unknown> = {
    title: title?.trim() ?? '',
    visibility,
  }
  if (content.kind === 'ok') body.contentMarkdown = content.markdown
  if (opts.project !== undefined) body.projectRef = opts.project

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error(`Error: network failure: ${(err as Error).message}`)
    return 1
  }

  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }

  const { document } = (await res.json()) as CreatedDocResponse
  const fullUrl = docUrl(apiUrl, creds.workspaceSlug ?? 'lumo', document.id)
  console.log(
    formatCreatedDocLine({ id: document.id, title: document.title, url: fullUrl })
  )

  // Optional bind
  if (opts.task) {
    const bindUrl = `${trimTrailingSlash(apiUrl)}/api/documents/${document.id}/mentions`
    const bindRes = await fetch(bindUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskIdentifier: opts.task }),
    })
    if (!bindRes.ok) {
      const text = await bindRes.text()
      console.error(
        `Warning: doc created but bind to ${opts.task} failed: ${bindRes.status} ${text}`
      )
      return 1
    }
    console.log(`Bound ${document.id} ↔ ${opts.task}`)
  }
}
```

> Note: `body.projectRef` assumes the server endpoint accepts that field. If the existing `createDocumentSchema` expects `projectId` (cuid), add a server-side helper that converts a name/slug ref to a cuid, OR have the CLI resolve project first. Quickest path: extend the schema to accept `projectRef` alongside `projectId`, just like `cliCreateTaskSchema` did for tasks. See `lib/validation/schemas.ts` `cliCreateTaskSchema` for the pattern. Add that branch to Task 5 if not already there.

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/cli/doc-create-format.test.ts
```

Expected: 5 cases pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/doc-create.ts __tests__/cli/doc-create-format.test.ts
git commit -m "feat: lumo doc create [LUM-66]"
```

---

## Task 13: CLI — `doc update`

**Files:**
- Create: `cli/src/commands/doc-update.ts`
- Create: `__tests__/cli/doc-update-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/doc-update-format.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import { formatUpdatedDocLine } from '@/cli/src/commands/doc-update'

describe('formatUpdatedDocLine', () => {
  it('renders updated line with cuid, title, url', () => {
    expect(
      formatUpdatedDocLine({
        id: 'c1',
        title: 'Doc',
        url: 'https://x/y/c1',
      })
    ).toBe('Updated c1 "Doc"  https://x/y/c1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/cli/doc-update-format.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `cli/src/commands/doc-update.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import {
  resolveDocContent,
  readStdinToString,
  readFileUtf8,
} from '../lib/doc-input'
import { normalizeScope } from './doc-create'
import { resolveDoc, isLikelyCuid } from '../lib/resolve-doc'

export interface UpdateDocOptions {
  title?: string
  content?: string
  file?: string
  scope?: string
  project?: string
}

export function formatUpdatedDocLine(doc: {
  id: string
  title: string
  url: string
}): string {
  const escaped = doc.title.replace(/"/g, '\\"')
  return `Updated ${doc.id} "${escaped}"  ${doc.url}`
}

async function lookupDocId(
  apiUrl: string,
  token: string,
  reference: string
): Promise<string | null> {
  if (isLikelyCuid(reference)) return reference
  const listUrl = `${trimTrailingSlash(apiUrl)}/api/documents`
  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const { documents } = (await res.json()) as {
    documents: { id: string; title: string }[]
  }
  const result = resolveDoc(reference, documents)
  if (result.kind === 'found') return result.doc.id
  if (result.kind === 'ambiguous') {
    console.error(
      `Error: title "${reference}" matches ${result.candidates.length} docs:`
    )
    for (const c of result.candidates) {
      console.error(`  ${c.id}  ${c.title}`)
    }
    console.error('Re-run with the cuid.')
    return null
  }
  return null
}

export async function docUpdate(
  reference: string | undefined,
  opts: UpdateDocOptions
): Promise<number | void> {
  if (!reference) {
    console.error('Error: missing <doc>. Usage: lumo doc update <doc> [flags]')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  const id = await lookupDocId(apiUrl, creds.token, reference)
  if (!id) {
    console.error(`Error: Document not found: ${reference}`)
    return 1
  }

  // Build body from flags
  const body: Record<string, unknown> = {}
  if (opts.title !== undefined) {
    if (opts.title.trim().length === 0) {
      console.error('Error: --title cannot be empty')
      return 1
    }
    body.title = opts.title.trim()
  }
  if (opts.scope !== undefined) {
    const v = normalizeScope(opts.scope)
    if (!v) {
      console.error(
        `Error: invalid scope "${opts.scope}". Allowed: personal, workspace`
      )
      return 1
    }
    body.visibility = v
  }
  if (opts.project !== undefined) {
    body.projectRef = opts.project === '' ? null : opts.project
  }

  const content = await resolveDocContent({
    content: opts.content,
    file: opts.file,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readStdin: readStdinToString,
    readFile: readFileUtf8,
  })
  if (content.kind === 'error') {
    console.error(`Error: ${content.message}`)
    return 1
  }
  if (content.kind === 'ok') body.contentMarkdown = content.markdown

  if (Object.keys(body).length === 0) {
    console.error('Error: no fields to update — provide at least one flag')
    return 1
  }

  const url = `${trimTrailingSlash(apiUrl)}/api/documents/${id}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }
  const { document } = (await res.json()) as {
    document: { id: string; title: string }
  }
  const docUrlStr = `${trimTrailingSlash(apiUrl)}/workspace/${creds.workspaceSlug ?? 'lumo'}/documents/${document.id}`
  console.log(
    formatUpdatedDocLine({ id: document.id, title: document.title, url: docUrlStr })
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/cli/doc-update-format.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/doc-update.ts __tests__/cli/doc-update-format.test.ts
git commit -m "feat: lumo doc update [LUM-66]"
```

---

## Task 14: CLI — `doc show`

**Files:**
- Create: `cli/src/commands/doc-show.ts`
- Create: `__tests__/cli/doc-show-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/doc-show-format.test.ts`:

```typescript
import { formatShowOutput } from '@/cli/src/commands/doc-show'

describe('formatShowOutput', () => {
  it('renders a key:value header and body separated by blank line', () => {
    const out = formatShowOutput({
      id: 'c1',
      title: 'RFC: doc CLI',
      scope: 'WORKSPACE',
      projectName: 'Lumo',
      createdAt: '2026-05-22T10:00:00Z',
      updatedAt: '2026-05-22T10:30:00Z',
      mentionedTasks: ['LUM-42'],
      bodyMarkdown: '# Hello\n\nWorld\n',
    })
    expect(out).toContain('ID: c1')
    expect(out).toContain('Title: RFC: doc CLI')
    expect(out).toContain('Scope: workspace')
    expect(out).toContain('Project: Lumo')
    expect(out).toContain('Mentioned tasks: LUM-42')
    // Body separated by blank line:
    expect(out).toMatch(/\n\n# Hello\n\nWorld/)
  })

  it('renders dash for empty project / mentions', () => {
    const out = formatShowOutput({
      id: 'c1',
      title: 't',
      scope: 'PRIVATE',
      projectName: null,
      createdAt: '2026-05-22T10:00:00Z',
      updatedAt: '2026-05-22T10:00:00Z',
      mentionedTasks: [],
      bodyMarkdown: '',
    })
    expect(out).toContain('Project: -')
    expect(out).toContain('Mentioned tasks: -')
    expect(out).toContain('Scope: personal')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/cli/doc-show-format.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `cli/src/commands/doc-show.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { tiptapToMarkdown } from '../../../lib/utils/markdown-tiptap'
import { resolveDoc, isLikelyCuid } from '../lib/resolve-doc'

export interface ShowDocViewModel {
  id: string
  title: string
  scope: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
  projectName: string | null
  createdAt: string
  updatedAt: string
  mentionedTasks: string[]
  bodyMarkdown: string
}

function scopeLabel(s: ShowDocViewModel['scope']): string {
  if (s === 'PRIVATE') return 'personal'
  if (s === 'WORKSPACE') return 'workspace'
  return 'shared'
}

export function formatShowOutput(vm: ShowDocViewModel): string {
  const lines = [
    `ID: ${vm.id}`,
    `Title: ${vm.title}`,
    `Scope: ${scopeLabel(vm.scope)}`,
    `Project: ${vm.projectName ?? '-'}`,
    `Created: ${vm.createdAt}`,
    `Updated: ${vm.updatedAt}`,
    `Mentioned tasks: ${vm.mentionedTasks.length ? vm.mentionedTasks.join(', ') : '-'}`,
  ]
  const header = lines.join('\n')
  return vm.bodyMarkdown ? `${header}\n\n${vm.bodyMarkdown}` : header
}

export async function docShow(
  reference: string | undefined
): Promise<number | void> {
  if (!reference) {
    console.error('Error: missing <doc>. Usage: lumo doc show <doc>')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  let id: string
  if (isLikelyCuid(reference)) {
    id = reference
  } else {
    const listRes = await fetch(`${trimTrailingSlash(apiUrl)}/api/documents`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (!listRes.ok) {
      console.error(`Error: ${listRes.status} ${listRes.statusText}`)
      return 1
    }
    const { documents } = (await listRes.json()) as {
      documents: { id: string; title: string }[]
    }
    const result = resolveDoc(reference, documents)
    if (result.kind === 'not-found') {
      console.error(`Error: Document not found: ${reference}`)
      return 1
    }
    if (result.kind === 'ambiguous') {
      console.error(`Error: title "${reference}" matches ${result.candidates.length} docs:`)
      for (const c of result.candidates) console.error(`  ${c.id}  ${c.title}`)
      console.error('Re-run with the cuid.')
      return 1
    }
    id = result.doc.id
  }

  const res = await fetch(`${trimTrailingSlash(apiUrl)}/api/documents/${id}`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }
  const data = (await res.json()) as {
    document: {
      id: string
      title: string
      visibility: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
      content: string | null
      project: { name: string } | null
      createdAt: string
      updatedAt: string
      mentions: { task: { identifier: string } }[]
    }
  }
  const d = data.document
  const body = d.content
    ? tiptapToMarkdown(JSON.parse(d.content))
    : ''
  console.log(
    formatShowOutput({
      id: d.id,
      title: d.title,
      scope: d.visibility,
      projectName: d.project?.name ?? null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      mentionedTasks: (d.mentions ?? []).map(m => m.task.identifier),
      bodyMarkdown: body,
    })
  )
}
```

> The `GET /api/documents/[id]` route does not currently return `mentions` and `project.name` shaped this way; verify the shape in the existing `app/api/documents/[id]/route.ts` and adjust the type/render accordingly. If mentions aren't in the response, add a small server-side include in the GET handler (separate task, append it here as needed before continuing).

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/cli/doc-show-format.test.ts
```

Expected: 2 cases pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/doc-show.ts __tests__/cli/doc-show-format.test.ts
git commit -m "feat: lumo doc show [LUM-66]"
```

---

## Task 15: CLI — `doc list`

**Files:**
- Create: `cli/src/commands/doc-list.ts`
- Create: `__tests__/cli/doc-list-format.test.ts`

Fixed-width rows: `<cuid>  <SCOPE>  <project|->  <title>`, sorted by updatedAt desc.

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/doc-list-format.test.ts`:

```typescript
import { formatDocListRows } from '@/cli/src/commands/doc-list'

describe('formatDocListRows', () => {
  it('renders fixed-width rows', () => {
    const lines = formatDocListRows([
      {
        id: 'cmd1111111111111111111111',
        visibility: 'PRIVATE',
        project: { name: 'Lumo' },
        title: 'Roadmap',
      },
      {
        id: 'cmd2222222222222222222222',
        visibility: 'WORKSPACE',
        project: null,
        title: 'RFC',
      },
    ])
    expect(lines[0]).toMatch(/^cmd1111111111111111111111\s+PERSONAL\s+Lumo\s+Roadmap$/)
    expect(lines[1]).toMatch(/^cmd2222222222222222222222\s+WORKSPACE\s+-\s+RFC$/)
  })

  it('returns empty array for empty input', () => {
    expect(formatDocListRows([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/cli/doc-list-format.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `cli/src/commands/doc-list.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { normalizeScope } from './doc-create'

export interface ListDocOptions {
  scope?: string
  project?: string
  task?: string
  limit?: string
}

interface DocRow {
  id: string
  title: string
  visibility: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
  project: { name: string } | null
}

function visibilityLabel(v: DocRow['visibility']): string {
  if (v === 'PRIVATE') return 'PERSONAL'
  return v // WORKSPACE | SHARED
}

export function formatDocListRows(rows: DocRow[]): string[] {
  if (rows.length === 0) return []
  return rows.map(r => {
    const label = visibilityLabel(r.visibility).padEnd(10, ' ')
    const project = (r.project?.name ?? '-').padEnd(14, ' ')
    return `${r.id}  ${label}  ${project}  ${r.title}`
  })
}

export async function docList(opts: ListDocOptions): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  // --task takes precedence over --scope/--project
  let url: string
  if (opts.task) {
    // Resolve task identifier on the server through the URL parameter directly.
    // The endpoint accepts task cuid; the CLI passes the identifier verbatim and lets the server resolve.
    url = `${trimTrailingSlash(apiUrl)}/api/tasks/${opts.task}/documents`
  } else {
    const params = new URLSearchParams()
    if (opts.scope && opts.scope !== 'all') {
      const v = normalizeScope(opts.scope)
      if (!v) {
        console.error(
          `Error: invalid scope "${opts.scope}". Allowed: personal, workspace, all`
        )
        return 1
      }
      params.set('visibility', v)
    }
    if (opts.project) params.set('projectRef', opts.project)
    const qs = params.toString()
    url = `${trimTrailingSlash(apiUrl)}/api/documents${qs ? `?${qs}` : ''}`
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }
  const { documents } = (await res.json()) as { documents: DocRow[] }

  // Client-side filtering when --task combined with --scope/--project
  let rows = documents
  if (opts.task && opts.scope && opts.scope !== 'all') {
    const v = normalizeScope(opts.scope)
    if (v) rows = rows.filter(r => r.visibility === v)
  }
  if (opts.task && opts.project) {
    rows = rows.filter(
      r =>
        (r.project?.name ?? '').toLowerCase() === opts.project!.toLowerCase()
    )
  }

  if (opts.limit) {
    const n = parseInt(opts.limit, 10)
    if (!Number.isNaN(n)) rows = rows.slice(0, n)
  }

  const lines = formatDocListRows(rows)
  for (const line of lines) console.log(line)
}
```

> Note: `projectRef` as a query-string filter on `GET /api/documents` is not yet supported by the existing route — it accepts `projectId` (cuid). If you want name/slug filtering on the server, add a small server-side resolver in `app/api/documents/route.ts` analogous to `projectRef` on `task create`. If you'd rather keep this CLI-side, accept `--project` as a cuid only and rename the flag help text accordingly. Pick whichever matches what was done in Task 6.

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/cli/doc-list-format.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/doc-list.ts __tests__/cli/doc-list-format.test.ts
git commit -m "feat: lumo doc list [LUM-66]"
```

---

## Task 16: CLI — `doc delete`

**Files:**
- Create: `cli/src/commands/doc-delete.ts`

No new test file — the only logic worth testing (`--yes` guard) is exercised inline.

- [ ] **Step 1: Implement**

Create `cli/src/commands/doc-delete.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveDoc, isLikelyCuid } from '../lib/resolve-doc'

export interface DeleteDocOptions {
  yes?: boolean
}

export async function docDelete(
  reference: string | undefined,
  opts: DeleteDocOptions
): Promise<number | void> {
  if (!reference) {
    console.error('Error: missing <doc>. Usage: lumo doc delete <doc> --yes')
    return 1
  }
  if (!opts.yes) {
    console.error('Error: Refusing to delete without --yes')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  let id = reference
  let title = ''
  if (!isLikelyCuid(reference)) {
    const listRes = await fetch(`${trimTrailingSlash(apiUrl)}/api/documents`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (!listRes.ok) {
      console.error(`Error: ${listRes.status} ${listRes.statusText}`)
      return 1
    }
    const { documents } = (await listRes.json()) as {
      documents: { id: string; title: string }[]
    }
    const result = resolveDoc(reference, documents)
    if (result.kind !== 'found') {
      if (result.kind === 'ambiguous') {
        console.error(`Error: title "${reference}" matches ${result.candidates.length} docs:`)
        for (const c of result.candidates) console.error(`  ${c.id}  ${c.title}`)
        console.error('Re-run with the cuid.')
      } else {
        console.error(`Error: Document not found: ${reference}`)
      }
      return 1
    }
    id = result.doc.id
    title = result.doc.title
  }

  const res = await fetch(`${trimTrailingSlash(apiUrl)}/api/documents/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }
  const escaped = title.replace(/"/g, '\\"')
  console.log(`Deleted ${id}${title ? ` "${escaped}"` : ''}`)
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/commands/doc-delete.ts
git commit -m "feat: lumo doc delete [LUM-66]"
```

---

## Task 17: CLI — `doc bind`

**Files:**
- Create: `cli/src/commands/doc-bind.ts`
- Create: `__tests__/cli/doc-bind-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/doc-bind-format.test.ts`:

```typescript
import { formatBindOutput } from '@/cli/src/commands/doc-bind'

describe('formatBindOutput', () => {
  it('renders a fresh bind line', () => {
    expect(
      formatBindOutput({
        docId: 'c1',
        identifier: 'LUM-42',
        alreadyBound: false,
        upgradedFromContent: false,
      })
    ).toBe('Bound c1 ↔ LUM-42')
  })
  it('renders idempotent already-bound line', () => {
    expect(
      formatBindOutput({
        docId: 'c1',
        identifier: 'LUM-42',
        alreadyBound: true,
        upgradedFromContent: false,
      })
    ).toBe('Already bound c1 ↔ LUM-42')
  })
  it('renders upgrade annotation', () => {
    expect(
      formatBindOutput({
        docId: 'c1',
        identifier: 'LUM-42',
        alreadyBound: false,
        upgradedFromContent: true,
      })
    ).toBe('Bound c1 ↔ LUM-42 (upgraded from content)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/cli/doc-bind-format.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `cli/src/commands/doc-bind.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveDoc, isLikelyCuid } from '../lib/resolve-doc'

export interface BindFormatArgs {
  docId: string
  identifier: string
  alreadyBound: boolean
  upgradedFromContent: boolean
}

export function formatBindOutput(args: BindFormatArgs): string {
  if (args.alreadyBound) return `Already bound ${args.docId} ↔ ${args.identifier}`
  const upgrade = args.upgradedFromContent ? ' (upgraded from content)' : ''
  return `Bound ${args.docId} ↔ ${args.identifier}${upgrade}`
}

export async function docBind(
  docRef: string | undefined,
  task: string | undefined
): Promise<number | void> {
  if (!docRef || !task) {
    console.error('Error: usage: lumo doc bind <doc> <task>')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  let docId = docRef
  if (!isLikelyCuid(docRef)) {
    const listRes = await fetch(`${trimTrailingSlash(apiUrl)}/api/documents`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (!listRes.ok) {
      console.error(`Error: ${listRes.status} ${listRes.statusText}`)
      return 1
    }
    const { documents } = (await listRes.json()) as {
      documents: { id: string; title: string }[]
    }
    const result = resolveDoc(docRef, documents)
    if (result.kind !== 'found') {
      if (result.kind === 'ambiguous') {
        console.error(`Error: title "${docRef}" matches ${result.candidates.length} docs:`)
        for (const c of result.candidates) console.error(`  ${c.id}  ${c.title}`)
        console.error('Re-run with the cuid.')
      } else {
        console.error(`Error: Document not found: ${docRef}`)
      }
      return 1
    }
    docId = result.doc.id
  }

  const url = `${trimTrailingSlash(apiUrl)}/api/documents/${docId}/mentions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ taskIdentifier: task }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }
  const { mention } = (await res.json()) as {
    mention: {
      taskIdentifier: string
      alreadyBound: boolean
      upgradedFromContent: boolean
    }
  }
  console.log(
    formatBindOutput({
      docId,
      identifier: mention.taskIdentifier,
      alreadyBound: mention.alreadyBound,
      upgradedFromContent: mention.upgradedFromContent,
    })
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/cli/doc-bind-format.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/doc-bind.ts __tests__/cli/doc-bind-format.test.ts
git commit -m "feat: lumo doc bind [LUM-66]"
```

---

## Task 18: CLI — `doc unbind`

**Files:**
- Create: `cli/src/commands/doc-unbind.ts`

- [ ] **Step 1: Implement**

Create `cli/src/commands/doc-unbind.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveDoc, isLikelyCuid } from '../lib/resolve-doc'

export async function docUnbind(
  docRef: string | undefined,
  task: string | undefined
): Promise<number | void> {
  if (!docRef || !task) {
    console.error('Error: usage: lumo doc unbind <doc> <task>')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  let docId = docRef
  if (!isLikelyCuid(docRef)) {
    const listRes = await fetch(`${trimTrailingSlash(apiUrl)}/api/documents`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (!listRes.ok) {
      console.error(`Error: ${listRes.status} ${listRes.statusText}`)
      return 1
    }
    const { documents } = (await listRes.json()) as {
      documents: { id: string; title: string }[]
    }
    const result = resolveDoc(docRef, documents)
    if (result.kind !== 'found') {
      if (result.kind === 'ambiguous') {
        console.error(`Error: title "${docRef}" matches ${result.candidates.length} docs:`)
        for (const c of result.candidates) console.error(`  ${c.id}  ${c.title}`)
        console.error('Re-run with the cuid.')
      } else {
        console.error(`Error: Document not found: ${docRef}`)
      }
      return 1
    }
    docId = result.doc.id
  }

  // Resolve task identifier → cuid on server side. We pass the identifier as the URL segment;
  // the route handler maps LUM-N to a cuid via documentService.resolveTask.
  const url = `${trimTrailingSlash(apiUrl)}/api/documents/${docId}/mentions/${encodeURIComponent(task)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 409) {
    const { error } = (await res.json()) as { error: string }
    console.error(`Error: ${error}`)
    return 1
  }
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }
  const data = (await res.json()) as { removed: number; taskIdentifier: string }
  if (data.removed === 0) {
    console.log(`Already unbound ${docId} ↔ ${data.taskIdentifier}`)
  } else {
    console.log(`Unbound ${docId} ↔ ${data.taskIdentifier}`)
  }
}
```

> The DELETE route accepts a `taskId` URL segment. The CLI passes the user's input verbatim (cuid OR LUM-N). On the server, the route hands the value to `documentService.removeExplicitMention` whose `resolveTask` accepts either form. Make sure Task 9 wired the server side accordingly — adjust if you changed the route signature.

- [ ] **Step 2: Commit**

```bash
git add cli/src/commands/doc-unbind.ts
git commit -m "feat: lumo doc unbind [LUM-66]"
```

---

## Task 19: Register `lumo doc …` subcommands

**Files:**
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Edit index.ts**

Add imports at top with the other command imports:

```typescript
import { docCreate } from './commands/doc-create'
import { docUpdate } from './commands/doc-update'
import { docShow } from './commands/doc-show'
import { docList } from './commands/doc-list'
import { docDelete } from './commands/doc-delete'
import { docBind } from './commands/doc-bind'
import { docUnbind } from './commands/doc-unbind'
```

After the existing `milestone` command group registration, add:

```typescript
const doc = program.command('doc').description('Manage Lumo documents')

doc
  .command('create [title]')
  .description('Create a new document')
  .option('--content <text>', 'Inline markdown content')
  .option('--file <path>', 'Read markdown content from file')
  .option('--scope <scope>', 'personal | workspace (default: personal)')
  .option('--project <ref>', 'Project name or slug to file under')
  .option('--task <LUM-N>', 'Bind to this task after creation')
  .action(wrap(docCreate))

doc
  .command('update <doc>')
  .description('Update an existing document (doc = title or cuid)')
  .option('--title <text>', 'New title')
  .option('--content <text>', 'Replace content (inline)')
  .option('--file <path>', 'Replace content from file')
  .option('--scope <scope>', 'personal | workspace')
  .option('--project <ref>', 'Project name/slug; pass "" to clear')
  .action(wrap(docUpdate))

doc
  .command('show <doc>')
  .description('Show document header and body (doc = title or cuid)')
  .action(wrap(docShow))

doc
  .command('list')
  .description('List documents visible to the current user')
  .option('--scope <scope>', 'personal | workspace | all (default: all)')
  .option('--project <ref>', 'Filter by project name/slug')
  .option('--task <LUM-N>', 'Only docs bound to this task')
  .option('--limit <n>', 'Cap output to first N rows')
  .action(wrap(docList))

doc
  .command('delete <doc>')
  .description('Delete a document (requires --yes)')
  .option('--yes', 'Confirm deletion')
  .action(wrap(docDelete))

doc
  .command('bind <doc> <task>')
  .description('Bind a document to a task')
  .action(wrap(docBind))

doc
  .command('unbind <doc> <task>')
  .description('Unbind a document from a task (explicit mentions only)')
  .action(wrap(docUnbind))
```

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
cd cli && npm run build && cd ..
```

Expected: pass.

- [ ] **Step 3: Smoke-test `--help`**

```bash
./cli/dist/index.js doc --help
./cli/dist/index.js doc create --help
```

Expected: usage strings list the new subcommands and flags.

- [ ] **Step 4: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat: register doc subcommands [LUM-66]"
```

---

## Task 20: Update `SKILL.md`

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: Update frontmatter triggers**

Edit `.claude/skills/lumo/SKILL.md`. In the frontmatter `description:` field, append these trigger phrases (preserve YAML single-quote escaping):

- `create doc`, `new doc`, `new document`, `write doc`, `写文档`, `新建文档`
- `update doc`, `edit doc`, `修改文档`, `更新文档`
- `list docs`, `my docs`, `我的文档`
- `show doc`, `view doc`, `查看文档`
- `delete doc`, `删除文档`
- `bind doc`, `attach doc`, `把文档关联到任务`, `文档绑定到任务`
- `unbind doc`, `解绑文档`
- `personal doc`, `workspace doc`, `个人文档`, `workspace 文档`, `doc scope`

- [ ] **Step 2: Add the `## Document Management` section**

Append after the existing `## Task Management` section (and after the milestone section if present). The section structure must mirror the task section. Skeleton:

```markdown
## Document Management

### `lumo doc create [title] [flags]` — create a new document

Title is positional and optional (server default is empty / "Untitled").

| Flag | Type | Notes |
|---|---|---|
| `--content <text>` | string | Inline markdown body. |
| `--file <path>` | string | Read markdown body from file. |
| (stdin) | — | Pipe markdown; treated as content when stdin is not a TTY. |
| `--scope <scope>` | enum | `personal` (default) or `workspace`. Maps to PRIVATE / WORKSPACE. |
| `--project <ref>` | string | Project name or slug to file under. Default null. |
| `--task <LUM-N>` | string | Bind to this task immediately after create. |

The three content channels (`--content`, `--file`, stdin) are mutually exclusive.

Example:
\`\`\`bash
lumo doc create "RFC: doc CLI" --scope workspace --file scratch/rfc.md --task LUM-66
\`\`\`

Success output:
\`\`\`
Created cmd_xxx "RFC: doc CLI"  https://www.uselumo.ai/workspace/lumo/documents/cmd_xxx
\`\`\`

### When to suggest `doc create`

- User says "write a doc", "起一篇 RFC", "新建文档", or describes a deliverable that should live as a document.
- After a discussion that needs a write-up, offer to create the doc with a title and the right scope.

### `lumo doc update <doc> [flags]` — update a document

`<doc>` accepts a cuid or a case-insensitive title. Ambiguous titles fail with a candidate list.

| Flag | Type | Notes |
|---|---|---|
| `--title <text>` | string | New title (non-empty). |
| `--content <text>` | string | Replace content (inline). |
| `--file <path>` | string | Replace content from file. |
| (stdin) | — | Pipe to replace content. |
| `--scope <scope>` | enum | personal | workspace. |
| `--project <ref>` | string | Project name/slug. `--project ""` clears. |

(... continue with show / list / delete / bind / unbind sections, each with a flag table, example, success line, and "When to suggest" guidance.)

#### Out of scope (mention in section)

- SHARED visibility — Web UI only.
- Doc tree (parent / sortOrder) operations — defer.
- Tags — defer.
- `--from-editor` — defer.
- Lossless markdown round-trip — `doc show > tmp.md && doc update --file tmp.md` is NOT promised to be a no-op.
```

Fill in the remaining subsections (show / list / delete / bind / unbind) following the same shape and tone as `## Task Management`. Refer to the spec for content channel rules and the `(upgraded from content)` annotation on bind.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: sync SKILL.md with doc CLI commands [LUM-66]"
```

---

## Task 21: Bump CLI version + final verification

**Files:**
- Modify: `cli/package.json`

- [ ] **Step 1: Bump version**

Edit `cli/package.json` — bump `version` from `0.1.0` (or whatever current) to `0.2.0` (minor — new command surface).

- [ ] **Step 2: Build + npm link locally**

```bash
cd cli && npm run build && npm link && cd ..
lumo --version
lumo doc --help
```

Expected: version reads `0.2.0`; help lists all 7 doc subcommands.

- [ ] **Step 3: Manual verification run**

```bash
# Scratch markdown file
mkdir -p scratch
cat > scratch/rfc.md <<'EOF'
# RFC: CLI doc commands

## Background
...

## Decision
We're shipping it.
EOF

# Create, bind, list, show, update, unbind, delete
lumo doc create "RFC: doc CLI smoke test" --scope workspace --file scratch/rfc.md --task LUM-66
lumo doc list
lumo doc list --task LUM-66
lumo doc show "RFC: doc CLI smoke test"
lumo doc update "RFC: doc CLI smoke test" --scope personal
lumo doc bind "RFC: doc CLI smoke test" LUM-65
lumo doc unbind "RFC: doc CLI smoke test" LUM-65
lumo doc delete "RFC: doc CLI smoke test" --yes
```

For each command, verify the printed output matches the format defined in the spec. Errors (e.g., ambiguous title, content > 500k, missing --yes) should each be exercised at least once.

- [ ] **Step 4: Full test suite + type-check**

```bash
npx tsc --noEmit
npm test
```

Expected: green.

- [ ] **Step 5: Commit version bump**

```bash
git add cli/package.json
git commit -m "chore: bump cli to 0.2.0 [LUM-66]"
```

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin lumo/LUM-66-cli-doc-commands
gh pr create --title "feat: CLI doc commands (create/update/show/list/delete/bind/unbind) [LUM-66]" --body "$(cat <<'EOF'
## Summary
- New CLI subcommands under `lumo doc` for full doc lifecycle from the terminal.
- Server-side: extended `POST/PATCH /api/documents` to accept `contentMarkdown`; new explicit `POST/DELETE /api/documents/<id>/mentions` routes.
- Schema: added `DocMentionSource` enum + `source` column on `DocumentMention` to separate CLI-managed bindings from content-derived ones.
- New dep: `markdown-it` (server-only, for markdown → Tiptap JSON conversion).
- SKILL.md updated with new triggers and a `## Document Management` section.

## Migration
Requires `migrate deploy` on next deploy. Adds enum + nullable-default column — zero-downtime.

## Test plan
- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] Manual run of every subcommand (see plan Task 21 Step 3)
- [ ] `lumo doc --help` lists all 7 subcommands

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Confirm it opens in the browser to verify the body rendered correctly.

---

## Self-Review Notes

- **Spec coverage:** Every requirement in [the spec](../specs/2026-05-22-cli-doc-commands-design.md) is covered by a task: CLI surface (Tasks 12–18), server-side mention endpoints (Tasks 8–9), markdown converter (Task 2), schema (Tasks 1, 5), source-aware sync (Tasks 3–4), error handling (per-command tests + manual run), SKILL.md (Task 20), migration (Task 1).
- **`projectRef` vs `projectId` server resolution:** Tasks 6, 12, 13, 15 call out the need to mirror the `task create` `projectRef → projectId` pattern. If the existing schema already accepts only `projectId`, add a small server resolver in `app/api/documents/route.ts` analogous to the task one before the CLI commands depend on it. Surface this when the task is in progress; do **not** ship a CLI flag that the server can't honor.
- **`GET /api/documents/[id]` response shape:** Task 14 assumes the GET handler returns `project: { name }` and `mentions: [{ task: { identifier } }]`. Verify before relying on those fields; extend the route's prisma `include` if missing. If you add the include, do it in Task 14 as a `Step 0` before writing the format test.
