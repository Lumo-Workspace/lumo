# LUM-226 文档选区锚定评论 — Plan #1（后端：锚定 + CRUD + resolve）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为文档实现"选区锚定评论"的后端：`DocumentComment` 数据模型 + 防篡改的服务端 content-patch（把评论 mark 写进文档 content）+ CRUD + resolve/reopen + 孤儿标记，提供一套可独立测试的 REST API。

**Architecture:** 镜像现有任务评论栈（repository → service → API route → api-client）。锚点用混合策略：评论 mark（`<span data-comment-id>`）写进文档 HTML content 做自动跟随，讨论/线程/resolve 存独立 `DocumentComment` 表，`quotedText` 做孤儿兜底。写 content 时走**服务端特权补丁**（VIEWER 也能评论），用 `node-html-parser` 做 **strip-comment-spans-and-compare** 防篡改守卫。

**Tech Stack:** Next.js 14 App Router, TypeScript (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess), Prisma + Neon Postgres, Zod, node-html-parser, Pusher, Jest (SWC).

**Out of scope（后续 plan）:** 编辑器 CommentMark 扩展 + bubble + decoration（Plan #2）；侧栏/线程/composer UI + React Query hook + 实时订阅（Plan #3）；@提及通知 + activity 事件（Plan #4）；i18n（Plan #5）。本计划只产出后端 + 服务端 Pusher 广播调用。

---

## 关键约定（每个 Task 都要遵守）

- **测试 cwd 必须在工作目录内**：`cd /Users/chaoli/Desktop/lumo/lumo && npx jest <path>`（worktree 场景同理 `cd <worktree>`），否则会命中 cli/package.json 的 haste 冲突跑到旧测试。
- **可选字段类型写 `field?: T | undefined`**（exactOptionalPropertyTypes）。
- **数组下标先取值再判空**（noUncheckedIndexedAccess）：`const x = arr[i]; if (!x) ...`。
- **Service 抛错**：`throw Object.assign(new Error(msg), { status })`。
- **Repository 不含业务/权限**；**API route 薄、不含 Prisma**；**Service 不直接 import 第三方 SDK**（用 `@/lib/` 包装）。
- 改完代码、跑测试通过后**才** commit；commit message：`type: desc [LUM-226]`，结尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 当前分支应为 `lumo/LUM-226-doc-selection-comments`（已创建，off origin/main）。

---

## 文件结构（本计划新建/修改）

**新建：**

- `lib/editor/comment-mark-html.ts` — 纯函数：strip/检测文档 HTML 里的 comment-span（服务端 & 客户端共用，无 React/DOM 依赖，用 node-html-parser）。
- `lib/repositories/documentComment.repository.ts` — DocumentComment 数据访问。
- `lib/services/documentComment.service.ts` — 业务编排（权限、content-patch、CRUD、resolve、孤儿）。
- `app/api/documents/[id]/comments/route.ts` — GET 列表 / POST 创建。
- `app/api/documents/[id]/comments/[commentId]/route.ts` — PATCH（改 body 或 resolve）/ DELETE。
- `__tests__/lib/editor/comment-mark-html.test.ts`
- `__tests__/lib/repositories/documentComment.repository.test.ts`
- `__tests__/lib/services/documentComment.service.test.ts`
- `__tests__/lib/validation/documentComment.schema.test.ts`

**修改：**

- `prisma/schema.prisma` — 新增 `DocumentComment` model + `DocumentCommentStatus` enum + `Document`/`Actor` 反向关系。
- `lib/validation/schemas.ts` — 新增 3 个 Zod schema。
- `lib/integrations/pusher/server.ts` — 新增 `pushDocumentEvent` helper。
- `lib/api-client/documents.ts` — 新增评论相关 client 函数（若文件不存在则新建）。
- `app/workspace/[workspaceUrl]/constants.ts` — 新增 API 路由常量。
- `lib/repositories/index.ts` / `lib/services/index.ts` — 导出新 repo/service（按现有 barrel 风格）。

---

## Task 1: comment-mark HTML 工具 + 防篡改守卫（含 spike）

证明"strip 所有 comment-span 后两份 HTML 必须完全相同"这个守卫可行——这是 content-patch 的核心，等价于设计文档里要 spike 的 #1 风险点。

**Files:**

- Create: `lib/editor/comment-mark-html.ts`
- Test: `__tests__/lib/editor/comment-mark-html.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// __tests__/lib/editor/comment-mark-html.test.ts
import {
  stripCommentSpans,
  extractCommentIds,
  removeCommentSpan,
  assertOnlyCommentMarksChanged,
} from '@/lib/editor/comment-mark-html'

describe('stripCommentSpans', () => {
  it('unwraps a comment span, keeping inner text', () => {
    const html = '<p>Hello <span data-comment-id="c1">brave</span> world</p>'
    expect(stripCommentSpans(html)).toBe('<p>Hello brave world</p>')
  })

  it('unwraps nested/overlapping comment spans', () => {
    const html =
      '<p><span data-comment-id="c1">a <span data-comment-id="c2">b</span></span></p>'
    expect(stripCommentSpans(html)).toBe('<p>a b</p>')
  })

  it('leaves non-comment spans (e.g. mentions) untouched', () => {
    const html = '<p><span data-type="mention" data-id="u1">@x</span></p>'
    expect(stripCommentSpans(html)).toBe(html)
  })
})

describe('extractCommentIds', () => {
  it('returns the set of comment ids present', () => {
    const html =
      '<p><span data-comment-id="c1">a</span><span data-comment-id="c2">b</span></p>'
    expect(extractCommentIds(html).sort()).toEqual(['c1', 'c2'])
  })

  it('dedupes a comment id that spans multiple ranges', () => {
    const html =
      '<p><span data-comment-id="c1">a</span> x <span data-comment-id="c1">b</span></p>'
    expect(extractCommentIds(html)).toEqual(['c1'])
  })
})

describe('removeCommentSpan', () => {
  it('unwraps only the targeted comment id', () => {
    const html =
      '<p><span data-comment-id="c1">a</span><span data-comment-id="c2">b</span></p>'
    expect(removeCommentSpan(html, 'c1')).toBe(
      '<p>a<span data-comment-id="c2">b</span></p>'
    )
  })
})

describe('assertOnlyCommentMarksChanged', () => {
  it('passes when new html only adds a comment span', () => {
    const oldHtml = '<p>Hello brave world</p>'
    const newHtml = '<p>Hello <span data-comment-id="c1">brave</span> world</p>'
    expect(() => assertOnlyCommentMarksChanged(oldHtml, newHtml)).not.toThrow()
  })

  it('throws 400 when body text changed', () => {
    const oldHtml = '<p>Hello world</p>'
    const newHtml = '<p>Hello <span data-comment-id="c1">CRUEL</span> world</p>'
    try {
      assertOnlyCommentMarksChanged(oldHtml, newHtml)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { status?: number }).status).toBe(400)
    }
  })

  it('throws 400 when a non-comment attribute changed (e.g. link href)', () => {
    const oldHtml = '<p><a href="/a">x</a></p>'
    const newHtml = '<p><a href="/evil">x</a></p>'
    expect(() => assertOnlyCommentMarksChanged(oldHtml, newHtml)).toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/editor/comment-mark-html.test.ts`
Expected: FAIL — `Cannot find module '@/lib/editor/comment-mark-html'`.

- [ ] **Step 3: 实现**

```typescript
// lib/editor/comment-mark-html.ts
import { parse, HTMLElement } from 'node-html-parser'

const COMMENT_SPAN_SELECTOR = 'span[data-comment-id]'

/** Unwrap ALL comment spans (keep inner content), return serialized HTML. */
export function stripCommentSpans(html: string): string {
  if (!html) return html
  const root = parse(html)
  // Repeatedly unwrap until none remain (handles nesting).
  let spans = root.querySelectorAll(COMMENT_SPAN_SELECTOR)
  while (spans.length > 0) {
    for (const span of spans) {
      span.replaceWith(span.innerHTML)
    }
    spans = root.querySelectorAll(COMMENT_SPAN_SELECTOR)
  }
  return root.toString()
}

/** Unwrap only the comment span(s) carrying the given comment id. */
export function removeCommentSpan(html: string, commentId: string): string {
  if (!html) return html
  const root = parse(html)
  const spans = root
    .querySelectorAll(COMMENT_SPAN_SELECTOR)
    .filter((s: HTMLElement) => s.getAttribute('data-comment-id') === commentId)
  for (const span of spans) {
    span.replaceWith(span.innerHTML)
  }
  return root.toString()
}

/** Distinct comment ids present in the html. */
export function extractCommentIds(html: string): string[] {
  if (!html) return []
  const root = parse(html)
  const ids = new Set<string>()
  for (const span of root.querySelectorAll(COMMENT_SPAN_SELECTOR)) {
    const id = span.getAttribute('data-comment-id')
    if (id) ids.add(id)
  }
  return [...ids]
}

/**
 * Anti-tampering guard for the privileged content-patch: after stripping every
 * comment span from both versions, the HTML must be byte-identical. This allows
 * adding/removing comment marks while rejecting ANY other content change
 * (text, formatting marks, link hrefs, structure).
 * Throws Error with status 400 on mismatch.
 */
export function assertOnlyCommentMarksChanged(
  oldHtml: string,
  newHtml: string
): void {
  const a = stripCommentSpans(oldHtml ?? '')
  const b = stripCommentSpans(newHtml ?? '')
  if (a !== b) {
    throw Object.assign(
      new Error('Content change rejected: only comment marks may be added'),
      { status: 400 }
    )
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/editor/comment-mark-html.test.ts`
Expected: PASS（全部用例）。若 `node-html-parser` 的 `toString()` 对属性/空白做了归一化导致 `assertOnlyCommentMarksChanged` 误判，需在守卫里对两侧都先 `parse().toString()` 归一化后再比较——调整实现使 strip 路径与 baseline 路径走同样的 parse→toString 归一，确保只比较结构性差异。

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add lib/editor/comment-mark-html.ts __tests__/lib/editor/comment-mark-html.test.ts
git commit -m "feat: comment-mark HTML utils + content-patch guard [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Prisma 模型 `DocumentComment` + 迁移

**Files:**

- Modify: `prisma/schema.prisma`（在现有 `Comment` model 之后、`Document` 相关区域附近新增）

- [ ] **Step 1: 加 model + enum**

在 `prisma/schema.prisma` 新增（紧跟 `enum DocShareRole` 区域风格）：

```prisma
enum DocumentCommentStatus {
  OPEN
  RESOLVED
}

model DocumentComment {
  id         String @id @default(cuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  authorActorId String?
  author        Actor?  @relation("DocumentCommentAuthor", fields: [authorActorId], references: [id], onDelete: SetNull)

  body String @db.Text

  parentId String?
  parent   DocumentComment?  @relation("DocCommentReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies  DocumentComment[] @relation("DocCommentReplies")

  // —— top-level (anchor) fields; null on replies ——
  quotedText  String? @db.Text
  anchorStart Int?
  anchorEnd   Int?
  status      DocumentCommentStatus @default(OPEN)
  isOrphaned  Boolean               @default(false)

  resolvedByActorId String?
  resolvedBy        Actor?  @relation("DocumentCommentResolver", fields: [resolvedByActorId], references: [id], onDelete: SetNull)
  resolvedAt        DateTime?

  type CommentType @default(USER)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([documentId, deletedAt])
  @@index([parentId])
}
```

- [ ] **Step 2: 加反向关系**

在 `model Document { ... }` 内的 relations 区追加：

```prisma
  documentComments DocumentComment[]
```

在 `model Actor { ... }` 内追加（名称与上面的 relation name 对应）：

```prisma
  documentComments         DocumentComment[] @relation("DocumentCommentAuthor")
  resolvedDocumentComments DocumentComment[] @relation("DocumentCommentResolver")
```

> 注意：`CommentType` 枚举已存在（USER/AGENT），直接复用，不要重复定义。

- [ ] **Step 3: 生成迁移**

Run:

```bash
cd /Users/chaoli/Desktop/lumo/lumo
npx prisma migrate dev --name add_document_comment
```

Expected: 新建 `prisma/migrations/<ts>_add_document_comment/migration.sql`，且 `prisma generate` 成功。

> 若遇到 drift（P3008/P3012）：按 CLAUDE.md 的 workaround 手写 SQL → `prisma db execute --file` → `migrate resolve --applied` → `prisma generate`。**不要** `migrate reset` 或直接改 `_prisma_migrations`。

- [ ] **Step 4: 校验类型生成**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx prisma generate && npx tsc --noEmit`
Expected: 无 `DocumentComment` 相关类型错误（仅可能因后续 Task 未实现而报"模块缺失"，那是预期的）。

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: DocumentComment model + migration [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Zod 校验 schema

**Files:**

- Modify: `lib/validation/schemas.ts`（紧跟现有 `updateCommentSchema` 之后）
- Test: `__tests__/lib/validation/documentComment.schema.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// __tests__/lib/validation/documentComment.schema.test.ts
import {
  createDocumentCommentSchema,
  updateDocumentCommentSchema,
  resolveDocumentCommentSchema,
} from '@/lib/validation/schemas'

describe('createDocumentCommentSchema', () => {
  it('accepts a valid top-level anchored comment', () => {
    const r = createDocumentCommentSchema.safeParse({
      id: 'ckxc0000000000000000000a',
      body: 'hi',
      from: 1,
      to: 5,
      quotedText: 'brave',
      content: '<p><span data-comment-id="x">brave</span></p>',
    })
    expect(r.success).toBe(true)
  })

  it('accepts a reply (parentId, no anchor)', () => {
    const r = createDocumentCommentSchema.safeParse({
      id: 'ckxc0000000000000000000a',
      body: 'reply',
      parentId: 'ckxc0000000000000000000b',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty body', () => {
    const r = createDocumentCommentSchema.safeParse({
      id: 'ckxc0000000000000000000a',
      body: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects to < from', () => {
    const r = createDocumentCommentSchema.safeParse({
      id: 'ckxc0000000000000000000a',
      body: 'x',
      from: 5,
      to: 1,
    })
    expect(r.success).toBe(false)
  })
})

describe('resolveDocumentCommentSchema', () => {
  it('accepts OPEN/RESOLVED', () => {
    expect(
      resolveDocumentCommentSchema.safeParse({ status: 'RESOLVED' }).success
    ).toBe(true)
  })
  it('rejects junk status', () => {
    expect(
      resolveDocumentCommentSchema.safeParse({ status: 'NOPE' }).success
    ).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/validation/documentComment.schema.test.ts`
Expected: FAIL — 导出不存在。

- [ ] **Step 3: 实现**

在 `lib/validation/schemas.ts` 追加（沿用文件现有 `z` import）：

```typescript
export const createDocumentCommentSchema = z
  .object({
    /** Client-generated cuid; matches the data-comment-id written into content. */
    id: z.string().cuid(),
    body: z.string().min(1, 'Comment cannot be empty').max(5000),
    /** Present when posting a reply; references a top-level comment. */
    parentId: z.string().cuid().optional(),
    /** ProseMirror anchor positions (top-level only). */
    from: z.number().int().min(0).optional(),
    to: z.number().int().min(0).optional(),
    /** Snapshot of the selected text (top-level only). */
    quotedText: z.string().max(10000).optional(),
    /**
     * Full document HTML with the new comment mark applied client-side.
     * Required for top-level (anchored) comments; omitted for replies.
     */
    content: z.string().max(500000).optional(),
  })
  .refine(v => v.from === undefined || v.to === undefined || v.to >= v.from, {
    message: 'to must be >= from',
    path: ['to'],
  })

export const updateDocumentCommentSchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000),
})

export const resolveDocumentCommentSchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']),
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/validation/documentComment.schema.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add lib/validation/schemas.ts __tests__/lib/validation/documentComment.schema.test.ts
git commit -m "feat: document comment validation schemas [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Repository `documentComment.repository.ts`

**Files:**

- Create: `lib/repositories/documentComment.repository.ts`
- Modify: `lib/repositories/index.ts`（barrel 导出）
- Test: `__tests__/lib/repositories/documentComment.repository.test.ts`

- [ ] **Step 1: 写失败测试**（mock prisma，验证 where/data 形状与软删）

```typescript
// __tests__/lib/repositories/documentComment.repository.test.ts
import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    documentComment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}))

const m = prisma as unknown as {
  documentComment: Record<string, jest.Mock>
}

beforeEach(() => jest.clearAllMocks())

describe('documentCommentRepository', () => {
  it('findByDocumentId filters top-level non-deleted + nests replies', async () => {
    m.documentComment.findMany.mockResolvedValue([])
    await documentCommentRepository.findByDocumentId('d1')
    const arg = m.documentComment.findMany.mock.calls[0][0]
    expect(arg.where).toMatchObject({
      documentId: 'd1',
      parentId: null,
      deletedAt: null,
    })
    expect(arg.include.replies.where).toMatchObject({ deletedAt: null })
  })

  it('delete is a soft-delete (sets deletedAt)', async () => {
    m.documentComment.update.mockResolvedValue({})
    await documentCommentRepository.softDelete('c1')
    const arg = m.documentComment.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'c1' })
    expect(arg.data.deletedAt).toBeInstanceOf(Date)
  })

  it('setStatus writes status + resolver + resolvedAt when RESOLVED', async () => {
    m.documentComment.update.mockResolvedValue({})
    await documentCommentRepository.setStatus('c1', 'RESOLVED', 'a1')
    const arg = m.documentComment.update.mock.calls[0][0]
    expect(arg.data.status).toBe('RESOLVED')
    expect(arg.data.resolvedByActorId).toBe('a1')
    expect(arg.data.resolvedAt).toBeInstanceOf(Date)
  })

  it('setStatus clears resolver when reopening (OPEN)', async () => {
    m.documentComment.update.mockResolvedValue({})
    await documentCommentRepository.setStatus('c1', 'OPEN', 'a1')
    const arg = m.documentComment.update.mock.calls[0][0]
    expect(arg.data.status).toBe('OPEN')
    expect(arg.data.resolvedByActorId).toBeNull()
    expect(arg.data.resolvedAt).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/repositories/documentComment.repository.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

```typescript
// lib/repositories/documentComment.repository.ts
import { prisma } from '@/lib/db/prisma'
import type { DocumentCommentStatus } from '@prisma/client'

export interface CreateDocumentCommentData {
  id: string
  documentId: string
  authorActorId: string | null
  body: string
  parentId?: string | null
  quotedText?: string | null
  anchorStart?: number | null
  anchorEnd?: number | null
}

const AUTHOR_SELECT = {
  author: { select: { id: true, displayName: true, avatarUrl: true } },
} as const

export const documentCommentRepository = {
  async findByDocumentId(documentId: string) {
    return prisma.documentComment.findMany({
      where: { documentId, parentId: null, deletedAt: null },
      include: {
        ...AUTHOR_SELECT,
        replies: {
          where: { deletedAt: null },
          include: AUTHOR_SELECT,
          orderBy: { createdAt: 'asc' as const },
        },
      },
      orderBy: { createdAt: 'asc' as const },
    })
  },

  async findById(id: string) {
    return prisma.documentComment.findUnique({
      where: { id },
      include: AUTHOR_SELECT,
    })
  },

  async create(data: CreateDocumentCommentData) {
    return prisma.documentComment.create({
      data: {
        id: data.id,
        documentId: data.documentId,
        authorActorId: data.authorActorId,
        body: data.body,
        parentId: data.parentId ?? null,
        quotedText: data.quotedText ?? null,
        anchorStart: data.anchorStart ?? null,
        anchorEnd: data.anchorEnd ?? null,
      },
      include: AUTHOR_SELECT,
    })
  },

  async update(id: string, data: { body: string }) {
    return prisma.documentComment.update({
      where: { id },
      data: { body: data.body },
      include: AUTHOR_SELECT,
    })
  },

  async softDelete(id: string) {
    return prisma.documentComment.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  },

  async setStatus(
    id: string,
    status: DocumentCommentStatus,
    actorId: string | null
  ) {
    const resolving = status === 'RESOLVED'
    return prisma.documentComment.update({
      where: { id },
      data: {
        status,
        resolvedByActorId: resolving ? actorId : null,
        resolvedAt: resolving ? new Date() : null,
      },
      include: AUTHOR_SELECT,
    })
  },

  /** Mark the given top-level comment ids as orphaned (anchor mark missing). */
  async setOrphaned(ids: string[], isOrphaned: boolean) {
    if (ids.length === 0) return { count: 0 }
    return prisma.documentComment.updateMany({
      where: { id: { in: ids } },
      data: { isOrphaned },
    })
  },
}
```

> `author` 的 `select` 字段（displayName/avatarUrl）需与 `Actor` 模型实际字段一致；执行时若 tsc 报字段不存在，改成 Actor 上的真实字段名（参考 `comment.repository.ts` 的 author include）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/repositories/documentComment.repository.test.ts`
Expected: PASS。

- [ ] **Step 5: barrel 导出**

在 `lib/repositories/index.ts` 追加（沿用现有导出风格）：

```typescript
export { documentCommentRepository } from './documentComment.repository'
```

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add lib/repositories/documentComment.repository.ts lib/repositories/index.ts __tests__/lib/repositories/documentComment.repository.test.ts
git commit -m "feat: documentComment repository [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Pusher `pushDocumentEvent` helper

**Files:**

- Modify: `lib/integrations/pusher/server.ts`

- [ ] **Step 1: 实现（镜像 `pushTaskEvent`）**

在 `lib/integrations/pusher/server.ts` 追加（频道命名沿用 `task-${id}` 风格 → `document-${id}`）：

```typescript
export type DocumentEvent =
  | { type: 'doc-comment:created'; commentId: string }
  | { type: 'doc-comment:updated'; commentId: string }
  | { type: 'doc-comment:deleted'; commentId: string }
  | {
      type: 'doc-comment:status'
      commentId: string
      status: 'OPEN' | 'RESOLVED'
    }

export async function pushDocumentEvent(
  documentId: string,
  event: DocumentEvent
): Promise<void> {
  try {
    await getPusher().trigger(
      `document-${documentId}`,
      'document-update',
      event
    )
  } catch (err) {
    console.error('[pusher] Failed to push document event:', err)
  }
}
```

> 若该文件已有 `DocumentEvent`/`document-update` 定义则复用，不要重复声明。`getPusher` 已在文件内定义（见参考）。

- [ ] **Step 2: 校验编译**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit`
Expected: 无新错误（service/route 尚未引用，单独编译应通过）。

- [ ] **Step 3: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add lib/integrations/pusher/server.ts
git commit -m "feat: pushDocumentEvent pusher helper [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Service `documentComment.service.ts`

业务核心：权限（VIEWER 可评论）、content-patch（写/删 mark + 守卫）、CRUD、resolve、孤儿检测。副作用（Pusher）用 `waitUntil` 包裹。**@提及通知与 activity 事件不在本计划**（Plan #4）。

**Files:**

- Create: `lib/services/documentComment.service.ts`
- Modify: `lib/services/index.ts`（barrel）
- Test: `__tests__/lib/services/documentComment.service.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// __tests__/lib/services/documentComment.service.test.ts
import { documentCommentService } from '@/lib/services/documentComment.service'
import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { documentRepository } from '@/lib/repositories/document.repository'

jest.mock('@/lib/repositories/documentComment.repository')
jest.mock('@/lib/repositories/document.repository')
jest.mock('@/lib/integrations/pusher/server', () => ({
  pushDocumentEvent: jest.fn().mockResolvedValue(undefined),
}))

const repo = documentCommentRepository as jest.Mocked<
  typeof documentCommentRepository
>
const docRepo = documentRepository as jest.Mocked<typeof documentRepository>

const noop = (_p: Promise<unknown>) => {}

const DOC = {
  id: 'd1',
  content: '<p>Hello brave world</p>',
  createdById: 'm-owner',
  shares: [{ memberId: 'm-viewer', role: 'VIEWER' }],
}

beforeEach(() => {
  jest.clearAllMocks()
  docRepo.findWithPermission.mockResolvedValue(DOC as never)
  docRepo.update.mockResolvedValue({} as never)
  repo.create.mockResolvedValue({ id: 'c1' } as never)
})

describe('createTopLevelComment', () => {
  it('VIEWER can comment: persists content patch + creates row', async () => {
    await documentCommentService.createCommentWithSideEffects({
      documentId: 'd1',
      memberId: 'm-viewer',
      workspaceId: 'w1',
      authorActorId: 'a-viewer',
      input: {
        id: 'c1',
        body: 'nice',
        from: 7,
        to: 12,
        quotedText: 'brave',
        content: '<p>Hello <span data-comment-id="c1">brave</span> world</p>',
      },
      waitUntil: noop,
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c1',
        documentId: 'd1',
        quotedText: 'brave',
      })
    )
    expect(docRepo.update).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        content: '<p>Hello <span data-comment-id="c1">brave</span> world</p>',
      })
    )
  })

  it('rejects tampered content (text changed) with 400, no writes', async () => {
    await expect(
      documentCommentService.createCommentWithSideEffects({
        documentId: 'd1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        authorActorId: 'a-viewer',
        input: {
          id: 'c1',
          body: 'x',
          from: 7,
          to: 12,
          quotedText: 'brave',
          content: '<p>Hello <span data-comment-id="c1">EVIL</span></p>',
        },
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.create).not.toHaveBeenCalled()
    expect(docRepo.update).not.toHaveBeenCalled()
  })

  it('denies a member with no access (403)', async () => {
    docRepo.findWithPermission.mockResolvedValue(null as never)
    await expect(
      documentCommentService.createCommentWithSideEffects({
        documentId: 'd1',
        memberId: 'm-stranger',
        workspaceId: 'w1',
        authorActorId: 'a-x',
        input: {
          id: 'c1',
          body: 'x',
          from: 1,
          to: 2,
          quotedText: 'H',
          content: '<p><span data-comment-id="c1">H</span>ello brave world</p>',
        },
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('createReply', () => {
  it('does not patch content for a reply', async () => {
    await documentCommentService.createCommentWithSideEffects({
      documentId: 'd1',
      memberId: 'm-viewer',
      workspaceId: 'w1',
      authorActorId: 'a-viewer',
      input: { id: 'c2', body: 'reply', parentId: 'c1' },
      waitUntil: noop,
    })
    expect(docRepo.update).not.toHaveBeenCalled()
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c2', parentId: 'c1' })
    )
  })
})

describe('deleteComment removes its anchor mark from content', () => {
  it('strips the comment span on top-level delete', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
    } as never)
    docRepo.findWithPermission.mockResolvedValue({
      ...DOC,
      content: '<p>Hello <span data-comment-id="c1">brave</span> world</p>',
    } as never)
    repo.softDelete.mockResolvedValue({} as never)

    await documentCommentService.deleteCommentWithSideEffects({
      commentId: 'c1',
      memberId: 'm-viewer',
      workspaceId: 'w1',
      waitUntil: noop,
    })
    expect(docRepo.update).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ content: '<p>Hello brave world</p>' })
    )
    expect(repo.softDelete).toHaveBeenCalledWith('c1')
  })
})

describe('detectOrphans', () => {
  it('marks DB comments whose ids are absent from content', async () => {
    repo.findByDocumentId.mockResolvedValue([
      { id: 'c1', status: 'OPEN', isOrphaned: false },
      { id: 'c2', status: 'OPEN', isOrphaned: false },
    ] as never)
    repo.setOrphaned.mockResolvedValue({ count: 1 } as never)

    await documentCommentService.detectAndFlagOrphans(
      'd1',
      '<p><span data-comment-id="c1">x</span></p>'
    )
    // c2 has no mark → orphaned
    expect(repo.setOrphaned).toHaveBeenCalledWith(['c2'], true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/services/documentComment.service.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

```typescript
// lib/services/documentComment.service.ts
import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { pushDocumentEvent } from '@/lib/integrations/pusher/server'
import {
  assertOnlyCommentMarksChanged,
  extractCommentIds,
  removeCommentSpan,
} from '@/lib/editor/comment-mark-html'
import type { DocumentCommentStatus } from '@prisma/client'

type WaitUntil = (p: Promise<unknown>) => void

export interface CreateDocCommentInput {
  id: string
  body: string
  parentId?: string | undefined
  from?: number | undefined
  to?: number | undefined
  quotedText?: string | undefined
  content?: string | undefined
}

export interface CreateDocCommentArgs {
  documentId: string
  memberId: string
  workspaceId: string
  authorActorId: string | null
  input: CreateDocCommentInput
  waitUntil: WaitUntil
}

function notFound(): never {
  throw Object.assign(new Error('Document not found'), { status: 404 })
}

export const documentCommentService = {
  async getComments(documentId: string, memberId: string, workspaceId: string) {
    const doc = await documentRepository.findWithPermission(
      documentId,
      memberId,
      workspaceId
    )
    if (!doc) notFound()
    return documentCommentRepository.findByDocumentId(documentId)
  },

  async createCommentWithSideEffects(args: CreateDocCommentArgs) {
    const {
      documentId,
      memberId,
      workspaceId,
      authorActorId,
      input,
      waitUntil,
    } = args

    // VIEWER+ access is enough to comment.
    const doc = await documentRepository.findWithPermission(
      documentId,
      memberId,
      workspaceId
    )
    if (!doc) notFound()

    const isReply = !!input.parentId

    // For a top-level (anchored) comment, persist the content patch first
    // (privileged: bypasses normal edit-permission, guarded against tampering).
    if (!isReply) {
      if (!input.content) {
        throw Object.assign(
          new Error('content is required for an anchored comment'),
          { status: 400 }
        )
      }
      assertOnlyCommentMarksChanged(doc.content ?? '', input.content)
      // Ensure the new comment id actually got anchored.
      if (!extractCommentIds(input.content).includes(input.id)) {
        throw Object.assign(
          new Error('content does not contain the new comment mark'),
          { status: 400 }
        )
      }
      await documentRepository.update(documentId, { content: input.content })
    }

    const comment = await documentCommentRepository.create({
      id: input.id,
      documentId,
      authorActorId,
      body: input.body,
      parentId: input.parentId ?? null,
      quotedText: isReply ? null : (input.quotedText ?? null),
      anchorStart: isReply ? null : (input.from ?? null),
      anchorEnd: isReply ? null : (input.to ?? null),
    })

    waitUntil(
      pushDocumentEvent(documentId, {
        type: 'doc-comment:created',
        commentId: comment.id,
      })
    )
    return comment
  },

  async updateCommentWithSideEffects(args: {
    commentId: string
    memberId: string
    workspaceId: string
    body: string
    waitUntil: WaitUntil
  }) {
    const existing = await documentCommentRepository.findById(args.commentId)
    if (!existing) {
      throw Object.assign(new Error('Comment not found'), { status: 404 })
    }
    const doc = await documentRepository.findWithPermission(
      existing.documentId,
      args.memberId,
      args.workspaceId
    )
    if (!doc) notFound()

    const updated = await documentCommentRepository.update(args.commentId, {
      body: args.body,
    })
    args.waitUntil(
      pushDocumentEvent(existing.documentId, {
        type: 'doc-comment:updated',
        commentId: args.commentId,
      })
    )
    return updated
  },

  async deleteCommentWithSideEffects(args: {
    commentId: string
    memberId: string
    workspaceId: string
    waitUntil: WaitUntil
  }) {
    const existing = await documentCommentRepository.findById(args.commentId)
    if (!existing) {
      throw Object.assign(new Error('Comment not found'), { status: 404 })
    }
    const doc = await documentRepository.findWithPermission(
      existing.documentId,
      args.memberId,
      args.workspaceId
    )
    if (!doc) notFound()

    // Top-level delete also removes its anchor mark from content.
    if (!existing.parentId && doc.content) {
      const stripped = removeCommentSpan(doc.content, args.commentId)
      if (stripped !== doc.content) {
        await documentRepository.update(existing.documentId, {
          content: stripped,
        })
      }
    }

    await documentCommentRepository.softDelete(args.commentId)
    args.waitUntil(
      pushDocumentEvent(existing.documentId, {
        type: 'doc-comment:deleted',
        commentId: args.commentId,
      })
    )
    return { ok: true }
  },

  async setStatusWithSideEffects(args: {
    commentId: string
    status: DocumentCommentStatus
    memberId: string
    workspaceId: string
    actorId: string | null
    waitUntil: WaitUntil
  }) {
    const existing = await documentCommentRepository.findById(args.commentId)
    if (!existing) {
      throw Object.assign(new Error('Comment not found'), { status: 404 })
    }
    const doc = await documentRepository.findWithPermission(
      existing.documentId,
      args.memberId,
      args.workspaceId
    )
    if (!doc) notFound()

    const updated = await documentCommentRepository.setStatus(
      args.commentId,
      args.status,
      args.actorId
    )
    args.waitUntil(
      pushDocumentEvent(existing.documentId, {
        type: 'doc-comment:status',
        commentId: args.commentId,
        status: args.status,
      })
    )
    return updated
  },

  /**
   * Compare DB top-level comments against comment ids present in the content;
   * flag the missing ones as orphaned (and clear the flag if they reappear).
   */
  async detectAndFlagOrphans(documentId: string, content: string | null) {
    const present = new Set(extractCommentIds(content ?? ''))
    const threads = await documentCommentRepository.findByDocumentId(documentId)
    const orphanIds: string[] = []
    const healedIds: string[] = []
    for (const t of threads) {
      if (!present.has(t.id) && !t.isOrphaned) orphanIds.push(t.id)
      if (present.has(t.id) && t.isOrphaned) healedIds.push(t.id)
    }
    if (orphanIds.length)
      await documentCommentRepository.setOrphaned(orphanIds, true)
    if (healedIds.length)
      await documentCommentRepository.setOrphaned(healedIds, false)
    return { orphanIds, healedIds }
  },
}
```

> 关键点：`findWithPermission`（见参考 document.repository.ts:174）对 VIEWER 也返回文档，正好满足"VIEWER 可评论"；EDITOR 专用的 `findEditable` **不要**用在评论路径。`document.content` 字段为可空 HTML。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/services/documentComment.service.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: barrel 导出**

`lib/services/index.ts` 追加：

```typescript
export { documentCommentService } from './documentComment.service'
```

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add lib/services/documentComment.service.ts lib/services/index.ts __tests__/lib/services/documentComment.service.test.ts
git commit -m "feat: documentComment service with guarded content-patch [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: API 路由

**Files:**

- Create: `app/api/documents/[id]/comments/route.ts`
- Create: `app/api/documents/[id]/comments/[commentId]/route.ts`

- [ ] **Step 1: 列表 + 创建路由**

```typescript
// app/api/documents/[id]/comments/route.ts
import { waitUntil } from '@vercel/functions'
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { createDocumentCommentSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'
import { documentCommentService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

function errorResponse(error: unknown) {
  if (error instanceof Error && 'status' in error) {
    return NextResponse.json(
      { error: error.message },
      { status: (error as Error & { status: number }).status }
    )
  }
  console.error('[doc-comments] unexpected error:', error)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params
    const comments = await documentCommentService.getComments(
      id,
      identity.memberId,
      identity.workspaceId
    )
    return NextResponse.json({ comments })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const body = await request.json()
    const parsed = createDocumentCommentSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const authorActorId = await getHumanActorId(identity.memberId)

    const comment = await documentCommentService.createCommentWithSideEffects({
      documentId: id,
      memberId: identity.memberId,
      workspaceId: identity.workspaceId,
      authorActorId,
      input: parsed.data,
      waitUntil,
    })
    return NextResponse.json({ comment }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
```

- [ ] **Step 2: 单条（PATCH/DELETE）路由**

```typescript
// app/api/documents/[id]/comments/[commentId]/route.ts
import { waitUntil } from '@vercel/functions'
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import {
  updateDocumentCommentSchema,
  resolveDocumentCommentSchema,
} from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'
import { documentCommentService } from '@/lib/services'

type Params = { params: Promise<{ id: string; commentId: string }> }

function errorResponse(error: unknown) {
  if (error instanceof Error && 'status' in error) {
    return NextResponse.json(
      { error: error.message },
      { status: (error as Error & { status: number }).status }
    )
  }
  console.error('[doc-comments] unexpected error:', error)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { commentId } = await params
    const body = await request.json()

    // Status change (resolve/reopen) takes precedence if `status` present.
    if (body && typeof body === 'object' && 'status' in body) {
      const parsed = resolveDocumentCommentSchema.safeParse(body)
      if (!parsed.success) return zodError(parsed)
      const actorId = await getHumanActorId(identity.memberId)
      const comment = await documentCommentService.setStatusWithSideEffects({
        commentId,
        status: parsed.data.status,
        memberId: identity.memberId,
        workspaceId: identity.workspaceId,
        actorId,
        waitUntil,
      })
      return NextResponse.json({ comment })
    }

    const parsed = updateDocumentCommentSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)
    const comment = await documentCommentService.updateCommentWithSideEffects({
      commentId,
      memberId: identity.memberId,
      workspaceId: identity.workspaceId,
      body: parsed.data.body,
      waitUntil,
    })
    return NextResponse.json({ comment })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { commentId } = await params
    await documentCommentService.deleteCommentWithSideEffects({
      commentId,
      memberId: identity.memberId,
      workspaceId: identity.workspaceId,
      waitUntil,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
```

> 校验 import 名是否与现有一致：`requireIdentity` 来自 `@/lib/auth`，`getHumanActorId` 来自 `@/lib/actor`，`zodError` 来自 `@/lib/api/helpers`（均见参考的任务评论路由）。若 `requireIdentity` 返回类型不是 `NextResponse` union 而是抛错风格，按现有任务路由的真实用法对齐（参考给出的是 `identity instanceof NextResponse` 风格）。

- [ ] **Step 3: 编译校验**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/api/documents/[id]/comments
git commit -m "feat: document comments API routes [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: API client + 路由常量

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts`（API 常量）
- Modify/Create: `lib/api-client/documents.ts`

- [ ] **Step 1: 路由常量**

在 `constants.ts` 的 API map 里，`documents` 区段追加（沿用 `tasks.comments` 风格）：

```typescript
// inside API.documents = { ... }
documentComments: (docId: string) => `/api/documents/${docId}/comments`,
documentComment: (docId: string, commentId: string) =>
  `/api/documents/${docId}/comments/${commentId}`,
```

> 若 `API.documents` 命名空间不存在，按 `API.tasks` 的结构新建一个 `documents` 子对象。

- [ ] **Step 2: client 函数**

在 `lib/api-client/documents.ts`（不存在则新建，沿用 `tasks.ts` 的 `apiFetch` 模式）追加：

```typescript
import { apiFetch } from '@/lib/api-client/base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const documentCommentsApi = {
  list<T>(docId: string) {
    return apiFetch<T>(API.documentComments(docId))
  },
  create<T>(docId: string, data: unknown) {
    return apiFetch<T>(API.documentComments(docId), {
      method: 'POST',
      body: data,
    })
  },
  update<T>(docId: string, commentId: string, data: unknown) {
    return apiFetch<T>(API.documentComment(docId, commentId), {
      method: 'PATCH',
      body: data,
    })
  },
  setStatus<T>(docId: string, commentId: string, status: 'OPEN' | 'RESOLVED') {
    return apiFetch<T>(API.documentComment(docId, commentId), {
      method: 'PATCH',
      body: { status },
    })
  },
  remove(docId: string, commentId: string) {
    return apiFetch<void>(API.documentComment(docId, commentId), {
      method: 'DELETE',
    })
  },
}
```

> 注意 `API` 的实际导出位置/命名以 `constants.ts` 为准（参考里 task 用的是 `API.tasks.comments`，可能是嵌套 `API.documents.documentComments`——按真实结构改 import 与调用）。

- [ ] **Step 3: 编译校验**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/workspace/[workspaceUrl]/constants.ts lib/api-client/documents.ts
git commit -m "feat: document comments api-client [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾验证（全部 Task 完成后）

- [ ] **全量类型检查**：`cd /Users/chaoli/Desktop/lumo/lumo && npx prisma generate && npx tsc --noEmit` → 0 error。
- [ ] **全量后端测试**：`cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/editor/comment-mark-html.test.ts __tests__/lib/validation/documentComment.schema.test.ts __tests__/lib/repositories/documentComment.repository.test.ts __tests__/lib/services/documentComment.service.test.ts` → 全绿。
- [ ] **token lint**（如有新 className，本计划应无）：跳过。
- [ ] **无 `console.log`**（路由里用的是 `console.error`，符合"proper logging"语义，可保留或替换为项目 logger——与现有任务路由保持一致）。
- [ ] **PR 描述**：注明①新增迁移 `add_document_comment`，prod 需 `prisma migrate deploy`；②无新增 npm 包（`node-html-parser`/`@vercel/functions`/`zod` 均已在用——执行时确认 `node-html-parser` 已在 deps，若否，按"Never install new npm packages without noting it in PR description"补记）。

---

## 自查（spec coverage）

| Spec 要求                                             | 本计划覆盖                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| DocumentComment 模型（含锚点/状态/孤儿/软删/回复）    | Task 2                                                                    |
| 混合锚点：mark 写进 content                           | Task 1（工具）+ Task 6（service 写入）                                    |
| VIEWER 可评论 + 服务端特权 content-patch + 防篡改守卫 | Task 1 + Task 6（`findWithPermission` + `assertOnlyCommentMarksChanged`） |
| CRUD + resolve/reopen                                 | Task 4/6/7                                                                |
| 孤儿检测（mark 缺失→标记）                            | Task 6 `detectAndFlagOrphans`（客户端加载后调用的 API 在 Plan #3 接入）   |
| 删除顶层评论移除其 mark                               | Task 6 `deleteCommentWithSideEffects`                                     |
| 实时广播                                              | Task 5 + service 内 `pushDocumentEvent`                                   |
| Zod 校验                                              | Task 3                                                                    |
| 五层（repo/service/route/client）                     | Task 4/6/7/8                                                              |
| **@提及通知 + activity 事件**                         | ❌ 不在本计划 → **Plan #4**                                               |
| **编辑器 CommentMark/bubble/decoration**              | ❌ → **Plan #2**                                                          |
| **侧栏/线程/composer + hook + 订阅**                  | ❌ → **Plan #3**                                                          |
| **i18n（16 locale）**                                 | ❌ → **Plan #5**                                                          |

> `detectAndFlagOrphans` 已实现于 service，但触发它的入口（文档加载/保存后调用）属于 UI/集成，放 Plan #3 接入；本计划保证逻辑有单测覆盖。
