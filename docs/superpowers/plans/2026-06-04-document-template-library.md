# Document Template Library Implementation Plan [LUM-225]

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating a document, the user picks a template (PRD / RFC / Meeting Notes / Weekly Report) that pre-fills a structured HTML skeleton; the meeting-notes skeleton ships an Action Items task-list that the existing extraction pipeline can turn into Lumo tasks.

**Architecture:** New `DocumentTemplate` Prisma table holds built-in skeletons (seeded from version-controlled TS constants via idempotent upsert). A thin repository → service exposes them; `documentService.createDocument` gains an optional `templateId` that injects the template's HTML as the new doc's body. A `GET /api/document-templates` route feeds a `DocumentTemplatePicker` dialog that intercepts every "new document" entry point. Template names/descriptions are react-intl strings; the skeleton body is single-language (Chinese) HTML.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Prisma 7 (config in `prisma.config.ts`, unpooled URL), Zod, React Query, react-intl, shadcn/ui (Radix Dialog), Jest (SWC, Prisma mocked).

**Spec:** `docs/superpowers/specs/2026-06-04-document-template-library-design.md`

---

## File Structure

**Create:**

- `lib/editor/templates/prd.ts` — PRD skeleton constant
- `lib/editor/templates/rfc.ts` — RFC skeleton constant
- `lib/editor/templates/meeting-notes.ts` — Meeting Notes skeleton (with Action Items task-list)
- `lib/editor/templates/weekly-report.ts` — Weekly Report skeleton
- `lib/editor/templates/index.ts` — `SYSTEM_TEMPLATES` barrel + `SystemTemplateSeed` type
- `prisma/seed.ts` — idempotent upsert of `SYSTEM_TEMPLATES`
- `lib/repositories/document-template.repository.ts` — data access
- `lib/services/document-template.service.ts` — list + getForCreation
- `app/api/document-templates/route.ts` — `GET` list endpoint
- `lib/api-client/document-templates.ts` — frontend client
- `app/workspace/[workspaceUrl]/components/document/DocumentTemplatePicker.tsx` — picker dialog
- `__tests__/document-template.repository.test.ts`
- `__tests__/services/document-template.service.test.ts`
- `__tests__/api/document-templates.test.ts`
- `__tests__/components/DocumentTemplatePicker.test.tsx`

**Modify:**

- `prisma/schema.prisma` — add `DocumentTemplate` model + `Workspace.documentTemplates` back-relation
- `prisma.config.ts` — wire the seed command
- `package.json` — add `db:seed` script
- `lib/services/document.service.ts` — `CreateDocumentInput.templateId` + injection logic
- `lib/validation/schemas.ts` — `createDocumentSchema.templateId`
- `app/api/documents/route.ts` — pass `templateId` through to the service
- `app/workspace/[workspaceUrl]/constants.ts` — `API.documentTemplates.list`
- `lib/api-client/index.ts` — export `documentTemplatesClient`
- `app/workspace/[workspaceUrl]/hooks/useWorkspaceDocumentHandlers.ts` — `handleTreeCreateChild` accepts an optional template
- `app/workspace/[workspaceUrl]/components/WorkspacePageRouter.tsx` — picker state + wiring
- `__tests__/document.service.test.ts` (or the nearest existing createDocument test) — templateId cases
- `lib/i18n/*.json` (all 16 locale files)

---

## Task 1: DocumentTemplate Prisma model + migration

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model + back-relation**

In `prisma/schema.prisma`, add the new model (place it near the `Document` model):

```prisma
model DocumentTemplate {
  id          String     @id @default(cuid())
  key         String     @unique
  emoji       String?
  content     String     @db.Text
  sortOrder   Float
  isSystem    Boolean    @default(true)
  workspaceId String?
  workspace   Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@index([workspaceId])
}
```

Then add the back-relation field inside the existing `model Workspace { … }` block (alongside the other relation lists):

```prisma
  documentTemplates DocumentTemplate[]
```

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name add_document_template`
Expected: a new folder `prisma/migrations/<timestamp>_add_document_template/migration.sql` containing `CREATE TABLE "DocumentTemplate"`, plus `prisma generate` runs automatically.

If `migrate dev` rejects with P3008/P3012 (checksum drift on a prior migration), use the documented workaround (hand-write the SQL, `npx prisma db execute --file …`, `npx prisma migrate resolve --applied …`, `npx prisma generate`). **Never** `migrate reset`.

- [ ] **Step 3: Verify the client type exists**

Run: `npx prisma generate && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i documenttemplate || echo "no DocumentTemplate type errors"`
Expected: `no DocumentTemplate type errors` (the generated client now exports `DocumentTemplate`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add DocumentTemplate model + migration [LUM-225]"
```

---

## Task 2: Template skeleton constants

**Files:**

- Create: `lib/editor/templates/index.ts`
- Create: `lib/editor/templates/prd.ts`
- Create: `lib/editor/templates/rfc.ts`
- Create: `lib/editor/templates/meeting-notes.ts`
- Create: `lib/editor/templates/weekly-report.ts`
- Test: `__tests__/editor/templates.test.ts`

The body HTML must be valid for `getBaseExtensions()` (headings `<h1>`–`<h4>`, `<p>`, `<ul>`/`<ol>`, `<blockquote>`, and the taskList shape `<ul data-type="taskList"><li data-type="taskItem" data-checked="false">…</li></ul>`).

- [ ] **Step 1: Write the failing test**

Create `__tests__/editor/templates.test.ts`:

```typescript
import { SYSTEM_TEMPLATES } from '@/lib/editor/templates'

describe('SYSTEM_TEMPLATES', () => {
  it('ships exactly the four v1 templates with unique keys', () => {
    const keys = SYSTEM_TEMPLATES.map(t => t.key)
    expect(keys).toEqual(['prd', 'rfc', 'meeting-notes', 'weekly-report'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every template has non-empty HTML content and an emoji', () => {
    for (const t of SYSTEM_TEMPLATES) {
      expect(t.content.length).toBeGreaterThan(0)
      expect(t.content).toContain('<h1>')
      expect(typeof t.emoji).toBe('string')
      expect(t.emoji.length).toBeGreaterThan(0)
    }
  })

  it('meeting-notes carries an extractable Action Items task-list', () => {
    const meeting = SYSTEM_TEMPLATES.find(t => t.key === 'meeting-notes')
    expect(meeting).toBeDefined()
    expect(meeting!.content).toContain('data-type="taskList"')
    expect(meeting!.content).toContain('data-type="taskItem"')
    expect(meeting!.content).toContain('data-checked="false"')
  })

  it('assigns ascending sortOrder', () => {
    const orders = SYSTEM_TEMPLATES.map(t => t.sortOrder)
    const sorted = [...orders].sort((a, b) => a - b)
    expect(orders).toEqual(sorted)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/editor/templates.test.ts`
Expected: FAIL — `Cannot find module '@/lib/editor/templates'`.

- [ ] **Step 3: Write the skeleton constants**

Create `lib/editor/templates/prd.ts`:

```typescript
import type { SystemTemplateSeed } from './index'

export const prdTemplate: SystemTemplateSeed = {
  key: 'prd',
  emoji: '📋',
  sortOrder: 1,
  content: [
    '<h1>PRD：标题</h1>',
    '<h2>背景</h2><p>为什么要做这件事？当前的问题或机会。</p>',
    '<h2>目标</h2><ul><li>目标一</li><li>目标二</li></ul>',
    '<h2>非目标</h2><ul><li>本次明确不做的范围</li></ul>',
    '<h2>用户故事</h2><p>作为「角色」，我希望「能力」，以便「价值」。</p>',
    '<h2>方案</h2><p>方案概述与关键设计点。</p>',
    '<h2>里程碑</h2><ul><li>M1：</li><li>M2：</li></ul>',
    '<h2>风险</h2><ul><li>风险与缓解措施</li></ul>',
  ].join(''),
}
```

Create `lib/editor/templates/rfc.ts`:

```typescript
import type { SystemTemplateSeed } from './index'

export const rfcTemplate: SystemTemplateSeed = {
  key: 'rfc',
  emoji: '📐',
  sortOrder: 2,
  content: [
    '<h1>RFC：标题</h1>',
    '<h2>摘要</h2><p>一段话说明本提案要解决什么。</p>',
    '<h2>动机</h2><p>为什么现在需要这个改动。</p>',
    '<h2>详细设计</h2><p>接口、数据模型、流程与关键决策。</p>',
    '<h2>备选方案</h2><ul><li>方案 A —— 取舍</li><li>方案 B —— 取舍</li></ul>',
    '<h2>影响面</h2><p>对现有系统、迁移、兼容性的影响。</p>',
    '<h2>未决问题</h2><ul><li>待讨论的开放问题</li></ul>',
  ].join(''),
}
```

Create `lib/editor/templates/meeting-notes.ts` (note the taskList — it must match the extraction selector exactly):

```typescript
import type { SystemTemplateSeed } from './index'

export const meetingNotesTemplate: SystemTemplateSeed = {
  key: 'meeting-notes',
  emoji: '📝',
  sortOrder: 3,
  content: [
    '<h1>会议纪要：主题</h1>',
    '<p><strong>时间：</strong>　<strong>地点：</strong>　<strong>参会人：</strong></p>',
    '<h2>议程</h2><ol><li>议题一</li><li>议题二</li></ol>',
    '<h2>讨论记录</h2><p>关键讨论与结论。</p>',
    '<h2>Action Items</h2>',
    '<ul data-type="taskList">',
    '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>负责人 —— 待办事项</p></div></li>',
    '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>负责人 —— 待办事项</p></div></li>',
    '</ul>',
    '<h2>下次会议</h2><p>时间与议题。</p>',
  ].join(''),
}
```

Create `lib/editor/templates/weekly-report.ts`:

```typescript
import type { SystemTemplateSeed } from './index'

export const weeklyReportTemplate: SystemTemplateSeed = {
  key: 'weekly-report',
  emoji: '📊',
  sortOrder: 4,
  content: [
    '<h1>周报：YYYY-WW</h1>',
    '<h2>本周完成</h2><ul><li>已完成事项</li></ul>',
    '<h2>进行中</h2><ul><li>进行中事项</li></ul>',
    '<h2>下周计划</h2><ul><li>计划事项</li></ul>',
    '<h2>阻塞</h2><ul><li>当前阻塞与需要的支持</li></ul>',
    '<h2>指标</h2><p>关键数据与进展。</p>',
  ].join(''),
}
```

Create `lib/editor/templates/index.ts`:

```typescript
import { prdTemplate } from './prd'
import { rfcTemplate } from './rfc'
import { meetingNotesTemplate } from './meeting-notes'
import { weeklyReportTemplate } from './weekly-report'

/** Shape of a built-in template skeleton (seeded into DocumentTemplate). */
export interface SystemTemplateSeed {
  key: string
  emoji: string
  /** Body HTML, in the same format as Document.content. */
  content: string
  sortOrder: number
}

/** Built-in system templates, ordered for display. */
export const SYSTEM_TEMPLATES: SystemTemplateSeed[] = [
  prdTemplate,
  rfcTemplate,
  meetingNotesTemplate,
  weeklyReportTemplate,
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/editor/templates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/templates __tests__/editor/templates.test.ts
git commit -m "feat: add built-in document template skeletons [LUM-225]"
```

---

## Task 3: Seed script + wiring

**Files:**

- Create: `prisma/seed.ts`
- Modify: `prisma.config.ts`
- Modify: `package.json`
- Test: `__tests__/prisma-seed.test.ts`

The seed extracts a pure `buildTemplateUpserts()` helper (testable without a DB) plus a `main()` that runs the upserts.

- [ ] **Step 1: Write the failing test**

Create `__tests__/prisma-seed.test.ts`:

```typescript
import { buildTemplateUpserts } from '@/prisma/seed'
import { SYSTEM_TEMPLATES } from '@/lib/editor/templates'

describe('buildTemplateUpserts', () => {
  it('produces one idempotent upsert arg per system template, keyed by key', () => {
    const upserts = buildTemplateUpserts()
    expect(upserts).toHaveLength(SYSTEM_TEMPLATES.length)

    const first = upserts[0]
    expect(first).toBeDefined()
    expect(first!.where).toEqual({ key: 'prd' })
    // create + update carry the same content/emoji/sortOrder so re-runs converge
    expect(first!.update.content).toBe(first!.create.content)
    expect(first!.create.workspaceId).toBeNull()
    expect(first!.create.isSystem).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/prisma-seed.test.ts`
Expected: FAIL — `Cannot find module '@/prisma/seed'`.

- [ ] **Step 3: Write the seed**

Create `prisma/seed.ts`:

```typescript
import { PrismaClient, type Prisma } from '@prisma/client'
import { SYSTEM_TEMPLATES } from '../lib/editor/templates'

/**
 * Build idempotent upsert args for every built-in template. System templates
 * have `workspaceId: null`; re-running converges because create and update
 * carry identical field values, matched on the unique `key`.
 */
export function buildTemplateUpserts(): Prisma.DocumentTemplateUpsertArgs[] {
  return SYSTEM_TEMPLATES.map(t => {
    const fields = {
      emoji: t.emoji,
      content: t.content,
      sortOrder: t.sortOrder,
      isSystem: true,
      workspaceId: null,
    }
    return {
      where: { key: t.key },
      create: { key: t.key, ...fields },
      update: fields,
    }
  })
}

async function main() {
  const prisma = new PrismaClient()
  try {
    for (const args of buildTemplateUpserts()) {
      await prisma.documentTemplate.upsert(args)
    }
    // eslint-disable-next-line no-console
    console.log(`Seeded ${SYSTEM_TEMPLATES.length} system document templates`)
  } finally {
    await prisma.$disconnect()
  }
}

// Only run when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Wire the seed command**

In `package.json` `scripts`, add:

```json
    "db:seed": "tsx prisma/seed.ts",
```

In `prisma.config.ts`, add a `migrations.seed` entry so `prisma migrate`/`db seed` knows how to run it. The file becomes:

```typescript
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    // Use unpooled URL for migrations (pooled connections don't support DDL)
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/prisma-seed.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the seed against the dev DB and verify idempotency**

Run: `npm run db:seed && npm run db:seed`
Expected: prints `Seeded 4 system document templates` twice, no errors.

Verify no duplicates:
Run: `npx prisma db execute --stdin <<< 'SELECT key, count(*) FROM "DocumentTemplate" GROUP BY key;'` (or open `npx prisma studio`)
Expected: each key appears exactly once.

- [ ] **Step 7: Commit**

```bash
git add prisma/seed.ts prisma.config.ts package.json __tests__/prisma-seed.test.ts
git commit -m "feat: seed built-in document templates [LUM-225]"
```

---

## Task 4: DocumentTemplate repository

**Files:**

- Create: `lib/repositories/document-template.repository.ts`
- Test: `__tests__/document-template.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/document-template.repository.test.ts`:

```typescript
import { documentTemplateRepository } from '@/lib/repositories/document-template.repository'

const mockFindMany = jest.fn()
const mockFindUnique = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    documentTemplate: {
      findMany: (...args: any[]) => mockFindMany(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
  },
}))

beforeEach(() => {
  mockFindMany.mockReset()
  mockFindUnique.mockReset()
})

describe('documentTemplateRepository.listVisible', () => {
  it('queries system templates OR templates owned by the workspace, ordered by sortOrder', async () => {
    mockFindMany.mockResolvedValue([])
    await documentTemplateRepository.listVisible('ws_1')

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { OR: [{ workspaceId: null }, { workspaceId: 'ws_1' }] },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        emoji: true,
        content: true,
        sortOrder: true,
      },
    })
  })
})

describe('documentTemplateRepository.findById', () => {
  it('looks up a single template by id', async () => {
    mockFindUnique.mockResolvedValue({ id: 't_1' })
    const result = await documentTemplateRepository.findById('t_1')

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 't_1' } })
    expect(result).toEqual({ id: 't_1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/document-template.repository.test.ts`
Expected: FAIL — `Cannot find module '@/lib/repositories/document-template.repository'`.

- [ ] **Step 3: Write the repository**

Create `lib/repositories/document-template.repository.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'

export const documentTemplateRepository = {
  /**
   * Templates visible to a workspace: global system templates
   * (workspaceId null) plus any owned by this workspace.
   */
  async listVisible(workspaceId: string) {
    return prisma.documentTemplate.findMany({
      where: { OR: [{ workspaceId: null }, { workspaceId }] },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        emoji: true,
        content: true,
        sortOrder: true,
      },
    })
  },

  /** Find a single template by id (no visibility filter — caller checks). */
  async findById(id: string) {
    return prisma.documentTemplate.findUnique({ where: { id } })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/document-template.repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/document-template.repository.ts __tests__/document-template.repository.test.ts
git commit -m "feat: add document-template repository [LUM-225]"
```

---

## Task 5: DocumentTemplate service

**Files:**

- Create: `lib/services/document-template.service.ts`
- Modify: `lib/services/index.ts` (export the service — confirm this barrel exists; if services are imported directly elsewhere, skip and import the singleton directly)
- Test: `__tests__/services/document-template.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/services/document-template.service.test.ts`:

```typescript
import { documentTemplateService } from '@/lib/services/document-template.service'

const mockListVisible = jest.fn()
const mockFindById = jest.fn()

jest.mock('@/lib/repositories/document-template.repository', () => ({
  documentTemplateRepository: {
    listVisible: (...args: any[]) => mockListVisible(...args),
    findById: (...args: any[]) => mockFindById(...args),
  },
}))

beforeEach(() => {
  mockListVisible.mockReset()
  mockFindById.mockReset()
})

describe('documentTemplateService.listTemplates', () => {
  it('delegates to the repository', async () => {
    mockListVisible.mockResolvedValue([{ id: 't_1', key: 'prd' }])
    const result = await documentTemplateService.listTemplates('ws_1')

    expect(mockListVisible).toHaveBeenCalledWith('ws_1')
    expect(result).toEqual([{ id: 't_1', key: 'prd' }])
  })
})

describe('documentTemplateService.getTemplateForCreation', () => {
  it('returns content + emoji for a system template', async () => {
    mockFindById.mockResolvedValue({
      id: 't_1',
      content: '<h1>PRD</h1>',
      emoji: '📋',
      workspaceId: null,
    })

    const result = await documentTemplateService.getTemplateForCreation(
      'ws_1',
      't_1'
    )
    expect(result).toEqual({ content: '<h1>PRD</h1>', emoji: '📋' })
  })

  it('returns content + emoji for a template owned by the same workspace', async () => {
    mockFindById.mockResolvedValue({
      id: 't_2',
      content: '<h1>X</h1>',
      emoji: null,
      workspaceId: 'ws_1',
    })

    const result = await documentTemplateService.getTemplateForCreation(
      'ws_1',
      't_2'
    )
    expect(result).toEqual({ content: '<h1>X</h1>', emoji: null })
  })

  it('throws 404 when the template does not exist', async () => {
    mockFindById.mockResolvedValue(null)
    await expect(
      documentTemplateService.getTemplateForCreation('ws_1', 'missing')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 when the template belongs to another workspace', async () => {
    mockFindById.mockResolvedValue({
      id: 't_3',
      content: '<h1>Y</h1>',
      emoji: null,
      workspaceId: 'ws_OTHER',
    })
    await expect(
      documentTemplateService.getTemplateForCreation('ws_1', 't_3')
    ).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/services/document-template.service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/document-template.service'`.

- [ ] **Step 3: Write the service**

Create `lib/services/document-template.service.ts`:

```typescript
import { documentTemplateRepository } from '@/lib/repositories/document-template.repository'

export const documentTemplateService = {
  /** List templates visible to a workspace (system + workspace-owned). */
  async listTemplates(workspaceId: string) {
    return documentTemplateRepository.listVisible(workspaceId)
  },

  /**
   * Resolve a template's body for use as a new document's content.
   * Visible iff it's a system template (workspaceId null) or owned by the
   * caller's workspace; otherwise 404 (don't leak other workspaces' ids).
   */
  async getTemplateForCreation(
    workspaceId: string,
    templateId: string
  ): Promise<{ content: string; emoji: string | null }> {
    const template = await documentTemplateRepository.findById(templateId)
    const visible =
      template &&
      (template.workspaceId === null || template.workspaceId === workspaceId)
    if (!template || !visible) {
      throw Object.assign(new Error('Template not found'), { status: 404 })
    }
    return { content: template.content, emoji: template.emoji }
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/services/document-template.service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/document-template.service.ts __tests__/services/document-template.service.test.ts
git commit -m "feat: add document-template service [LUM-225]"
```

---

## Task 6: Inject template content in createDocument

**Files:**

- Modify: `lib/services/document.service.ts:22-34` (CreateDocumentInput) and `:323-394` (createDocument)
- Test: `__tests__/services/document.service.createDocument.template.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/services/document.service.createDocument.template.test.ts`. This mirrors how the existing document.service tests mock collaborators; we stub the repository, the template service, clerk, and tag repo.

```typescript
import { documentService } from '@/lib/services/document.service'

const mockGetMaxSortOrder = jest.fn()
const mockCreate = jest.fn()
const mockSyncMentions = jest.fn()
const mockGetTemplateForCreation = jest.fn()

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    getMaxSortOrder: (...a: any[]) => mockGetMaxSortOrder(...a),
    create: (...a: any[]) => mockCreate(...a),
  },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { syncDocumentTags: jest.fn(), findByDocument: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {},
}))
jest.mock('@/lib/services/document-template.service', () => ({
  documentTemplateService: {
    getTemplateForCreation: (...a: any[]) => mockGetTemplateForCreation(...a),
  },
}))
jest.mock('@/lib/services/content-summary.service', () => ({
  contentSummaryService: {},
}))
jest.mock('@vercel/functions', () => ({ waitUntil: (p: any) => p }))
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: { getUserList: async () => ({ data: [] }) },
  }),
}))

beforeEach(() => {
  mockGetMaxSortOrder.mockResolvedValue(0)
  mockSyncMentions.mockResolvedValue(undefined)
  mockGetTemplateForCreation.mockReset()
  mockCreate.mockReset()
  mockCreate.mockResolvedValue({
    id: 'doc_1',
    slug: '1-untitled',
    createdBy: { id: 'm_1', clerkId: 'clerk_1' },
  })
  // Stub the mention-sync side effect so create resolves without a DB.
  jest
    .spyOn(documentService, 'syncDocumentMentions')
    .mockImplementation(mockSyncMentions)
})

afterEach(() => jest.restoreAllMocks())

describe('createDocument with templateId', () => {
  it('uses the template HTML as the new document content', async () => {
    mockGetTemplateForCreation.mockResolvedValue({
      content: '<h1>PRD</h1>',
      emoji: '📋',
    })

    await documentService.createDocument('ws_1', 'm_1', {
      title: '',
      visibility: 'PRIVATE',
      templateId: 't_1',
    })

    expect(mockGetTemplateForCreation).toHaveBeenCalledWith('ws_1', 't_1')
    const createArg = mockCreate.mock.calls[0][0]
    expect(createArg.content).toBe('<h1>PRD</h1>')
    expect(createArg.emoji).toBe('📋')
  })

  it('does not consult the template service when no templateId is given', async () => {
    await documentService.createDocument('ws_1', 'm_1', {
      title: '',
      visibility: 'PRIVATE',
    })
    expect(mockGetTemplateForCreation).not.toHaveBeenCalled()
  })

  it('prefers explicit contentMarkdown over templateId', async () => {
    await documentService.createDocument('ws_1', 'm_1', {
      title: '',
      visibility: 'PRIVATE',
      templateId: 't_1',
      contentMarkdown: '# Explicit',
    })
    expect(mockGetTemplateForCreation).not.toHaveBeenCalled()
    const createArg = mockCreate.mock.calls[0][0]
    // markdownToHtml('# Explicit') → an <h1>
    expect(createArg.content).toContain('Explicit')
  })

  it('keeps the caller emoji over the template emoji when both are present', async () => {
    mockGetTemplateForCreation.mockResolvedValue({
      content: '<h1>PRD</h1>',
      emoji: '📋',
    })
    await documentService.createDocument('ws_1', 'm_1', {
      title: '',
      visibility: 'PRIVATE',
      templateId: 't_1',
      emoji: '🚀',
    })
    const createArg = mockCreate.mock.calls[0][0]
    expect(createArg.emoji).toBe('🚀')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/services/document.service.createDocument.template.test.ts`
Expected: FAIL — `templateId` is not accepted / `getTemplateForCreation` never called (assertion failure).

- [ ] **Step 3: Add `templateId` to the input type**

In `lib/services/document.service.ts`, add to `CreateDocumentInput` (after `contentMarkdown?`). Declare with `| undefined` to satisfy `exactOptionalPropertyTypes`:

```typescript
  contentMarkdown?: string
  templateId?: string | undefined
```

- [ ] **Step 4: Add the import**

Near the other service imports at the top of `lib/services/document.service.ts`:

```typescript
import { documentTemplateService } from '@/lib/services/document-template.service'
```

- [ ] **Step 5: Inject the template content**

In `createDocument`, replace the existing content-resolution block (currently lines ~339-342):

```typescript
const content =
  data.contentMarkdown !== undefined
    ? markdownToHtml(data.contentMarkdown)
    : undefined
```

with:

```typescript
// Body resolution precedence: explicit contentMarkdown > template > none.
// Template content is already HTML (same format as Document.content), so
// it bypasses the markdown→HTML conversion. A template emoji only applies
// when the caller didn't specify one.
let content: string | undefined
let templateEmoji: string | null | undefined
if (data.contentMarkdown !== undefined) {
  content = markdownToHtml(data.contentMarkdown)
} else if (data.templateId !== undefined) {
  const template = await documentTemplateService.getTemplateForCreation(
    workspaceId,
    data.templateId
  )
  content = template.content
  templateEmoji = template.emoji
}
```

Then update the `emoji` field in the `documentRepository.create({ … })` call (currently `emoji: data.emoji ?? null,`) to fall back to the template emoji:

```typescript
      emoji: data.emoji ?? templateEmoji ?? null,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest __tests__/services/document.service.createDocument.template.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the existing document.service suite for regressions**

Run: `npx jest __tests__/services/document` `__tests__/document.service.test.ts`
Expected: PASS (no regressions).

- [ ] **Step 8: Commit**

```bash
git add lib/services/document.service.ts __tests__/services/document.service.createDocument.template.test.ts
git commit -m "feat: inject template content into createDocument [LUM-225]"
```

---

## Task 7: Validation schema + API routes

**Files:**

- Modify: `lib/validation/schemas.ts:301-320` (createDocumentSchema)
- Modify: `app/api/documents/route.ts:42-85` (POST passthrough)
- Create: `app/api/document-templates/route.ts`
- Test: `__tests__/api/document-templates.test.ts`

- [ ] **Step 1: Add `templateId` to the create schema**

In `lib/validation/schemas.ts`, inside `createDocumentSchema`, add after `contentMarkdown`:

```typescript
  contentMarkdown: z.string().max(500000).optional(),
  templateId: z.string().cuid().optional(),
```

- [ ] **Step 2: Pass `templateId` through the POST route**

In `app/api/documents/route.ts`, add `templateId` to the destructure (after `tagIds`):

```typescript
    contentMarkdown,
    tagIds,
    templateId,
  } = parsed.data
```

and to the `createDocument` call's object (after the `tagIds` spread):

```typescript
      ...(tagIds !== undefined ? { tagIds } : {}),
      ...(templateId !== undefined ? { templateId } : {}),
```

- [ ] **Step 3: Write the failing route test**

Create `__tests__/api/document-templates.test.ts`:

```typescript
import { GET } from '@/app/api/document-templates/route'
import { NextRequest } from 'next/server'

const mockRequireIdentity = jest.fn()
const mockListTemplates = jest.fn()

jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: any[]) => mockRequireIdentity(...a),
}))
jest.mock('@/lib/services/document-template.service', () => ({
  documentTemplateService: {
    listTemplates: (...a: any[]) => mockListTemplates(...a),
  },
}))

beforeEach(() => {
  mockRequireIdentity.mockReset()
  mockListTemplates.mockReset()
})

function req() {
  return new NextRequest('http://localhost/api/document-templates')
}

describe('GET /api/document-templates', () => {
  it('returns the workspace-visible templates', async () => {
    mockRequireIdentity.mockResolvedValue({
      workspaceId: 'ws_1',
      memberId: 'm_1',
    })
    mockListTemplates.mockResolvedValue([{ id: 't_1', key: 'prd' }])

    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ templates: [{ id: 't_1', key: 'prd' }] })
    expect(mockListTemplates).toHaveBeenCalledWith('ws_1')
  })

  it('propagates the auth guard response', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireIdentity.mockResolvedValue(
      NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    )

    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockListTemplates).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest __tests__/api/document-templates.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/document-templates/route'`.

- [ ] **Step 5: Write the route**

Create `app/api/document-templates/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { documentTemplateService } from '@/lib/services/document-template.service'

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const templates = await documentTemplateService.listTemplates(
    identity.workspaceId
  )
  return NextResponse.json({ templates })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest __tests__/api/document-templates.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/validation/schemas.ts app/api/documents/route.ts app/api/document-templates/route.ts __tests__/api/document-templates.test.ts
git commit -m "feat: document-templates GET route + createDocument templateId [LUM-225]"
```

---

## Task 8: API constants + client

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts:61-69`
- Create: `lib/api-client/document-templates.ts`
- Modify: `lib/api-client/index.ts`

- [ ] **Step 1: Add the endpoint constant**

In `app/workspace/[workspaceUrl]/constants.ts`, add a sibling to the `documents` block (inside the same `API` object):

```typescript
  documentTemplates: {
    list: '/api/document-templates',
  },
```

- [ ] **Step 2: Write the client**

Create `lib/api-client/document-templates.ts`:

```typescript
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const documentTemplatesClient = {
  list<T>() {
    return apiFetch<T>(API.documentTemplates.list)
  },
}
```

- [ ] **Step 3: Export it from the barrel**

In `lib/api-client/index.ts`, add (matching the existing export style):

```typescript
export { documentTemplatesClient } from './document-templates'
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit 2>&1 | grep -i "document-templates\|documentTemplates" || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/constants.ts lib/api-client/document-templates.ts lib/api-client/index.ts
git commit -m "feat: document-templates api client [LUM-225]"
```

---

## Task 9: i18n keys (all 16 locales)

**Files:**

- Modify: every file in `lib/i18n/*.json` (de, en, en-AU, en-GB, es-419, es, fr, hi, id, ja, ko, ms, ru, vi, zh-CN, zh-TW)

Per CLAUDE.md: update **every** locale file with a proper translation — never English as a fallback for non-English locales.

Keys to add (flat keys, placed near the other `documents.*` keys):

```
documents.selectTemplate
documents.templateBlank
documents.templateBlankDesc
documents.template.prd
documents.template.prdDesc
documents.template.rfc
documents.template.rfcDesc
documents.template.meetingNotes
documents.template.meetingNotesDesc
documents.template.weeklyReport
documents.template.weeklyReportDesc
```

- [ ] **Step 1: Add English (en, en-AU, en-GB) values**

Example for `lib/i18n/en.json` (place after `documents.newDocument`):

```json
  "documents.selectTemplate": "Choose a template",
  "documents.templateBlank": "Blank document",
  "documents.templateBlankDesc": "Start from scratch",
  "documents.template.prd": "PRD",
  "documents.template.prdDesc": "Product requirements: goals, scope, milestones",
  "documents.template.rfc": "RFC",
  "documents.template.rfcDesc": "Design proposal: motivation, detailed design, alternatives",
  "documents.template.meetingNotes": "Meeting notes",
  "documents.template.meetingNotesDesc": "Agenda, discussion, and action items",
  "documents.template.weeklyReport": "Weekly report",
  "documents.template.weeklyReportDesc": "Done, in progress, plans, and blockers",
```

en-AU / en-GB use the same English strings.

- [ ] **Step 2: Add zh-CN values**

`lib/i18n/zh-CN.json`:

```json
  "documents.selectTemplate": "选择模板",
  "documents.templateBlank": "空白文档",
  "documents.templateBlankDesc": "从空白开始",
  "documents.template.prd": "PRD",
  "documents.template.prdDesc": "产品需求：目标、范围、里程碑",
  "documents.template.rfc": "RFC",
  "documents.template.rfcDesc": "设计提案：动机、详细设计、备选方案",
  "documents.template.meetingNotes": "会议纪要",
  "documents.template.meetingNotesDesc": "议程、讨论记录与待办事项",
  "documents.template.weeklyReport": "周报",
  "documents.template.weeklyReportDesc": "完成、进行中、计划与阻塞",
```

- [ ] **Step 3: Add zh-TW values**

`lib/i18n/zh-TW.json`:

```json
  "documents.selectTemplate": "選擇範本",
  "documents.templateBlank": "空白文件",
  "documents.templateBlankDesc": "從空白開始",
  "documents.template.prd": "PRD",
  "documents.template.prdDesc": "產品需求：目標、範圍、里程碑",
  "documents.template.rfc": "RFC",
  "documents.template.rfcDesc": "設計提案：動機、詳細設計、備選方案",
  "documents.template.meetingNotes": "會議紀要",
  "documents.template.meetingNotesDesc": "議程、討論記錄與待辦事項",
  "documents.template.weeklyReport": "週報",
  "documents.template.weeklyReportDesc": "完成、進行中、計劃與阻塞",
```

- [ ] **Step 4: Add the remaining locales**

Provide proper translations for `de`, `es-419`, `es`, `fr`, `hi`, `id`, `ja`, `ko`, `ms`, `ru`, `vi`. Each gets all 11 keys translated into that language (do NOT paste English). Reference values:

- **de** (German): "Vorlage auswählen" / "Leeres Dokument" / "Ganz neu beginnen" / PRD / "Produktanforderungen: Ziele, Umfang, Meilensteine" / RFC / "Designvorschlag: Motivation, Detaildesign, Alternativen" / "Besprechungsnotizen" / "Agenda, Diskussion und Aufgaben" / "Wochenbericht" / "Erledigt, in Arbeit, Pläne und Blocker"
- **es / es-419** (Spanish): "Elegir una plantilla" / "Documento en blanco" / "Empezar desde cero" / PRD / "Requisitos del producto: objetivos, alcance, hitos" / RFC / "Propuesta de diseño: motivación, diseño detallado, alternativas" / "Notas de reunión" / "Agenda, discusión y tareas" / "Informe semanal" / "Hecho, en progreso, planes y bloqueos"
- **fr** (French): "Choisir un modèle" / "Document vierge" / "Partir de zéro" / PRD / "Exigences produit : objectifs, périmètre, jalons" / RFC / "Proposition de conception : motivation, conception détaillée, alternatives" / "Compte-rendu de réunion" / "Ordre du jour, discussion et actions" / "Rapport hebdomadaire" / "Terminé, en cours, plans et blocages"
- **hi** (Hindi): "टेम्पलेट चुनें" / "रिक्त दस्ताव़ेज़" / "शुरुआत से शुरू करें" / PRD / "उत्पाद आवश्यकताएँ: लक्ष्य, दायरा, मील के पत्थर" / RFC / "डिज़ाइन प्रस्ताव: प्रेरणा, विस्तृत डिज़ाइन, विकल्प" / "मीटिंग नोट्स" / "एजेंडा, चर्चा और कार्य-आइटम" / "साप्ताहिक रिपोर्ट" / "पूर्ण, प्रगति पर, योजनाएँ और अवरोध"
- **id** (Indonesian): "Pilih templat" / "Dokumen kosong" / "Mulai dari awal" / PRD / "Persyaratan produk: tujuan, lingkup, tonggak" / RFC / "Proposal desain: motivasi, desain rinci, alternatif" / "Catatan rapat" / "Agenda, diskusi, dan item tindakan" / "Laporan mingguan" / "Selesai, sedang berjalan, rencana, dan kendala"
- **ja** (Japanese): "テンプレートを選択" / "空のドキュメント" / "最初から作成" / PRD / "製品要件：目標、範囲、マイルストーン" / RFC / "設計提案：動機、詳細設計、代替案" / "議事録" / "アジェンダ、議論、アクションアイテム" / "週報" / "完了、進行中、計画、ブロッカー"
- **ko** (Korean): "템플릿 선택" / "빈 문서" / "처음부터 시작" / PRD / "제품 요구사항: 목표, 범위, 마일스톤" / RFC / "설계 제안: 동기, 상세 설계, 대안" / "회의록" / "안건, 논의, 실행 항목" / "주간 보고서" / "완료, 진행 중, 계획, 차단 요소"
- **ms** (Malay): "Pilih templat" / "Dokumen kosong" / "Mula dari awal" / PRD / "Keperluan produk: matlamat, skop, pencapaian" / RFC / "Cadangan reka bentuk: motivasi, reka bentuk terperinci, alternatif" / "Nota mesyuarat" / "Agenda, perbincangan dan item tindakan" / "Laporan mingguan" / "Selesai, dalam proses, rancangan dan halangan"
- **ru** (Russian): "Выбрать шаблон" / "Пустой документ" / "Начать с нуля" / PRD / "Требования к продукту: цели, объём, вехи" / RFC / "Проектное предложение: мотивация, детальный дизайн, альтернативы" / "Заметки о встрече" / "Повестка, обсуждение и задачи" / "Еженедельный отчёт" / "Сделано, в работе, планы и блокеры"
- **vi** (Vietnamese): "Chọn mẫu" / "Tài liệu trống" / "Bắt đầu từ đầu" / PRD / "Yêu cầu sản phẩm: mục tiêu, phạm vi, cột mốc" / RFC / "Đề xuất thiết kế: động lực, thiết kế chi tiết, phương án thay thế" / "Biên bản họp" / "Chương trình, thảo luận và hạng mục hành động" / "Báo cáo tuần" / "Hoàn thành, đang tiến hành, kế hoạch và vướng mắc"

(`documents.template.prd` and `.rfc` stay `"PRD"` / `"RFC"` in every locale — they're acronyms.)

- [ ] **Step 5: Verify all locales have all keys**

Run:

```bash
for f in lib/i18n/*.json; do
  for k in selectTemplate templateBlank templateBlankDesc template.prd template.prdDesc template.rfc template.rfcDesc template.meetingNotes template.meetingNotesDesc template.weeklyReport template.weeklyReportDesc; do
    grep -q "\"documents.$k\"" "$f" || echo "MISSING documents.$k in $f"
  done
done; echo "done"
```

Expected: only `done` (no `MISSING` lines).

- [ ] **Step 6: Verify every locale is valid JSON**

Run: `for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BAD $f"; done; echo ok`
Expected: `ok` with no `BAD` lines.

- [ ] **Step 7: Commit**

```bash
git add lib/i18n
git commit -m "i18n: document template picker strings (all locales) [LUM-225]"
```

---

## Task 10: DocumentTemplatePicker component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/document/DocumentTemplatePicker.tsx`
- Test: `__tests__/components/DocumentTemplatePicker.test.tsx`

The component is a controlled Radix Dialog showing a grid of cards: a fixed "Blank document" card plus one card per fetched template (name/description from react-intl by `key`). Selecting a card calls `onSelect`. Per project memory, Radix Dialog can't truly open in jsdom — the test asserts behavior at the props/callback level (render the card list directly, click a card, assert `onSelect` args), not by simulating the open transition.

**Picker contract:**

```typescript
export interface PickerTemplate {
  id: string
  key: string
  emoji: string | null
  content: string
}

interface DocumentTemplatePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: PickerTemplate[]
  loading: boolean
  /** null = blank document; otherwise the chosen template. */
  onSelect: (template: PickerTemplate | null) => void
}
```

The i18n label/description lookup is by `key`: `documents.template.${camelKey}` where `meeting-notes`→`meetingNotes`, `weekly-report`→`weeklyReport`, `prd`→`prd`, `rfc`→`rfc`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/DocumentTemplatePicker.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import en from '@/lib/i18n/en.json'
import {
  DocumentTemplatePicker,
  type PickerTemplate,
} from '@/app/workspace/[workspaceUrl]/components/document/DocumentTemplatePicker'

const templates: PickerTemplate[] = [
  { id: 't_prd', key: 'prd', emoji: '📋', content: '<h1>PRD</h1>' },
  {
    id: 't_meet',
    key: 'meeting-notes',
    emoji: '📝',
    content: '<h1>会议纪要</h1>',
  },
]

function renderPicker(onSelect = jest.fn()) {
  render(
    <IntlProvider locale='en' messages={en as Record<string, string>}>
      <DocumentTemplatePicker
        open
        onOpenChange={() => {}}
        templates={templates}
        loading={false}
        onSelect={onSelect}
      />
    </IntlProvider>
  )
  return onSelect
}

describe('DocumentTemplatePicker', () => {
  it('renders a blank card plus one card per template', () => {
    renderPicker()
    expect(screen.getByText('Blank document')).toBeInTheDocument()
    expect(screen.getByText('PRD')).toBeInTheDocument()
    expect(screen.getByText('Meeting notes')).toBeInTheDocument()
  })

  it('calls onSelect(null) when the blank card is clicked', () => {
    const onSelect = renderPicker()
    fireEvent.click(screen.getByText('Blank document'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('calls onSelect(template) when a template card is clicked', () => {
    const onSelect = renderPicker()
    fireEvent.click(screen.getByText('PRD'))
    expect(onSelect).toHaveBeenCalledWith(templates[0])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/DocumentTemplatePicker.test.tsx`
Expected: FAIL — `Cannot find module '.../DocumentTemplatePicker'`.

- [ ] **Step 3: Write the component**

Create `app/workspace/[workspaceUrl]/components/document/DocumentTemplatePicker.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface PickerTemplate {
  id: string
  key: string
  emoji: string | null
  content: string
}

interface DocumentTemplatePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: PickerTemplate[]
  loading: boolean
  /** null = blank document; otherwise the chosen template. */
  onSelect: (template: PickerTemplate | null) => void
}

/** Map a kebab-case template key to its camelCase i18n suffix. */
function intlKey(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function DocumentTemplatePicker({
  open,
  onOpenChange,
  templates,
  loading,
  onSelect,
}: DocumentTemplatePickerProps) {
  const intl = useIntl()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'documents.selectTemplate' })}
          </DialogTitle>
        </DialogHeader>

        <div className='grid grid-cols-2 gap-3'>
          <button
            type='button'
            onClick={() => onSelect(null)}
            className='flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent'
          >
            <span className='text-2xl'>📄</span>
            <span className='font-medium text-foreground'>
              {intl.formatMessage({ id: 'documents.templateBlank' })}
            </span>
            <span className='text-sm text-muted-foreground'>
              {intl.formatMessage({ id: 'documents.templateBlankDesc' })}
            </span>
          </button>

          {!loading &&
            templates.map(t => {
              const k = intlKey(t.key)
              return (
                <button
                  key={t.id}
                  type='button'
                  onClick={() => onSelect(t)}
                  className='flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent'
                >
                  <span className='text-2xl'>{t.emoji ?? '📄'}</span>
                  <span className='font-medium text-foreground'>
                    {intl.formatMessage({ id: `documents.template.${k}` })}
                  </span>
                  <span className='text-sm text-muted-foreground'>
                    {intl.formatMessage({ id: `documents.template.${k}Desc` })}
                  </span>
                </button>
              )
            })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/DocumentTemplatePicker.test.tsx`
Expected: PASS (3 tests).

> If the Radix `Dialog` portal prevents the cards from rendering under jsdom (cards not found), render the card grid through a small presentational `TemplateCards` subcomponent and test that directly — the dialog chrome is not what we're verifying. Only do this if Step 4 fails on portal/`open` issues.

- [ ] **Step 5: Run token lint (semantic tokens only — no raw zinc/gray)**

Run: `npm run lint:tokens`
Expected: PASS (the component uses `border-border`, `bg-card`, `bg-accent`, `text-foreground`, `text-muted-foreground` — all semantic).

- [ ] **Step 6: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/document/DocumentTemplatePicker.tsx __tests__/components/DocumentTemplatePicker.test.tsx
git commit -m "feat: DocumentTemplatePicker dialog [LUM-225]"
```

---

## Task 11: Wire the picker into the new-document entry points

**Files:**

- Modify: `app/workspace/[workspaceUrl]/hooks/useWorkspaceDocumentHandlers.ts:69-166`
- Modify: `app/workspace/[workspaceUrl]/components/WorkspacePageRouter.tsx` (the two `onAddChild`/`onNewDocument` sites + render the picker once)

The optimistic create flow stays intact; we extend it to accept an optional template so the editor shows the skeleton instantly and the background `create` call carries `templateId`.

- [ ] **Step 1: Extend `handleTreeCreateChild` to accept a template**

In `app/workspace/[workspaceUrl]/hooks/useWorkspaceDocumentHandlers.ts`, change the `handleTreeCreateChild` signature and body. Add a second optional param `template?: { id: string; content: string; emoji: string | null }`:

```typescript
  const handleTreeCreateChild = useCallback(
    (
      parentId: string | null,
      template?: { id: string; content: string; emoji: string | null }
    ) => {
      const tempId = `temp-${crypto.randomUUID()}`
      const node: TreeNode = {
        id: tempId,
        slug: null,
        title: '',
        emoji: template?.emoji ?? null,
        parentId,
        sortOrder: Date.now(),
        childCount: 0,
      }
      docTree.addNode(parentId, node)
      setSelectedDocumentId(tempId)
      setCurrentPage('document-editor')
      window.history.pushState(
        null,
        '',
        `/workspace/${workspaceUrl}/documents/${tempId}`
      )
      // Write optimistic cache for DocumentEditorPage
      writeCache(CACHE_KEY.documentDetail(tempId), {
        id: tempId,
        number: 0,
        slug: tempId,
        title: '',
        emoji: template?.emoji ?? null,
        parentId,
        content: template?.content ?? null,
        children: [],
        shares: [],
        ancestors: [],
        visibility: 'PRIVATE',
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectId: null,
        project: null,
        workspaceId: '',
        createdById: '',
        createdBy: {
          id: '',
          name: currentUser?.displayName ?? '',
          imageUrl: currentUser?.imageUrl ?? null,
        },
      })
      // Background sync — carry templateId so the server injects the skeleton.
      documentsClient
        .create<{ document: ApiDocument; ancestors?: unknown[] }>(
          template
            ? { parentId, templateId: template.id }
            : { parentId }
        )
        .then(data => {
```

(The `.then(…)` body and the rest of the callback are unchanged.)

- [ ] **Step 2: Verify the hook still type-checks**

Run: `npx tsc --noEmit 2>&1 | grep -i "useWorkspaceDocumentHandlers" || echo clean`
Expected: `clean`.

- [ ] **Step 3: Add picker state + render in WorkspacePageRouter**

In `app/workspace/[workspaceUrl]/components/WorkspacePageRouter.tsx`:

Add imports near the top:

```typescript
import { useQuery } from '@tanstack/react-query'
import { documentTemplatesClient } from '@/lib/api-client'
import {
  DocumentTemplatePicker,
  type PickerTemplate,
} from './document/DocumentTemplatePicker'
```

Add state + data + an "open picker" callback inside the component body (near the other `useState` hooks):

```typescript
const [templatePickerParentId, setTemplatePickerParentId] = useState<
  string | null
>(null)
const [templatePickerOpen, setTemplatePickerOpen] = useState(false)

const { data: templateData, isLoading: templatesLoading } = useQuery({
  queryKey: ['document-templates'],
  queryFn: () =>
    documentTemplatesClient.list<{ templates: PickerTemplate[] }>(),
})

const openTemplatePicker = useCallback((parentId: string | null) => {
  setTemplatePickerParentId(parentId)
  setTemplatePickerOpen(true)
}, [])

const handleTemplateSelected = useCallback(
  (template: PickerTemplate | null) => {
    setTemplatePickerOpen(false)
    documentHandlers.handleTreeCreateChild(
      templatePickerParentId,
      template
        ? { id: template.id, content: template.content, emoji: template.emoji }
        : undefined
    )
  },
  [documentHandlers, templatePickerParentId]
)
```

(Ensure `useState` and `useCallback` are imported — they almost certainly already are.)

- [ ] **Step 4: Repoint the entry points at the picker**

Replace **every** `onAddChild={documentHandlers.handleTreeCreateChild}` in this file with:

```typescript
onAddChild = { openTemplatePicker }
```

and the DocumentsPage `onNewDocument={documentHandlers.handleNewDocument}` with:

```typescript
            onNewDocument={() => openTemplatePicker(null)}
```

- [ ] **Step 5: Render the picker once**

Add the picker near the root of the component's returned JSX (e.g. just before the closing fragment/wrapper that the `switch` is rendered inside — it must always be mounted so it can open from any page):

```tsx
<DocumentTemplatePicker
  open={templatePickerOpen}
  onOpenChange={setTemplatePickerOpen}
  templates={templateData?.templates ?? []}
  loading={templatesLoading}
  onSelect={handleTemplateSelected}
/>
```

- [ ] **Step 6: Type-check the whole app**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useWorkspaceDocumentHandlers.ts app/workspace/[workspaceUrl]/components/WorkspacePageRouter.tsx
git commit -m "feat: open template picker from new-document entry points [LUM-225]"
```

---

## Task 12: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Regenerate the Prisma client (clears stale-client type errors)**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Watch for `exactOptionalPropertyTypes` issues on `templateId` and `noUncheckedIndexedAccess` on any array indexing — fix with `| undefined` / guards if they surface.)

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all suites pass, including the new template, repository, service, route, and component tests.

- [ ] **Step 4: Lint (incl. token lint)**

Run: `npm run lint`
Expected: no errors. No `console.log` in production code (the seed's `console.log`/`console.error` are a CLI script, acceptable; if lint flags them, add a scoped `// eslint-disable-next-line no-console`, already included).

- [ ] **Step 5: Confirm no migration deletions snuck in**

Run: `git diff --stat origin/main -- prisma/migrations | grep -i "delete\|=> 0" || echo "no migration deletions"`
Expected: `no migration deletions` (only the new migration folder added).

- [ ] **Step 6: Final commit if any fixes were made**

```bash
git add -A
git commit -m "chore: verification fixes for document template library [LUM-225]"
```

---

## PR notes (for whoever opens the PR)

- **Title:** `feat: document template library (PRD/RFC/meeting notes/weekly report) [LUM-225]`
- **Migration:** adds table `DocumentTemplate` (additive, **no data deletion**). Requires `prisma migrate deploy` on the next production deploy.
- **Seed required:** built-in templates are loaded by `npm run db:seed` / `prisma db seed`. **Production must run the seed after deploy**, or the picker shows only "Blank document". Call this out explicitly and confirm the deploy pipeline runs it.
- **No new npm packages.**
- After deploy: verify with `prisma migrate status` against the prod URL and confirm the 4 templates exist.

---

## Self-Review notes

- **Spec coverage:** §3 data model → Task 1; seed → Tasks 2–3; §4 repository/service/createDocument/route/client → Tasks 4–8; §5 UI picker + entry points → Tasks 10–11; §6 i18n → Task 9; §7 template content → Task 2; §8 tests → embedded per task; §9 migration/deploy → Task 1 + PR notes; §10 risks (empty-picker on missing seed, taskItem selector coupling) → PR notes + Task 2 meeting-notes test asserts the selector.
- **Type consistency:** `templateId?: string | undefined` used consistently (schema optional, service input, route passthrough). `getTemplateForCreation(workspaceId, templateId)` signature matches all call sites. `handleTreeCreateChild(parentId, template?)` template shape `{ id, content, emoji }` matches what `handleTemplateSelected` passes and what the picker's `PickerTemplate` exposes. `documentTemplateRepository.listVisible/findById` names match service usage.
- **Extraction reuse:** the meeting-notes `data-type="taskItem" data-checked="false"` shape matches `document-task-extraction.service`'s `all_unchecked` selector (no new extraction code), per spec decision.
