# LUM-223 Backlinks Documents 区增量增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在任务详情页 Context tab 的 Documents 区，区分「正文提及（CONTENT）」与「手动绑定（EXPLICIT）」两类文档反链。

**Architecture:** 后端在 `GET /api/tasks/[id]/documents` 透传已有的 `source` 字段；前端 `DocumentsSection` 按 source 排序（CONTENT 置顶）并渲染来源 badge，detach 按钮仅对 EXPLICIT 行显示；空态文案改为反链语义；16 个 locale 同步。不动 schema、不动迁移、不碰文档查看器。

**Tech Stack:** Next.js 14 App Router · TypeScript（strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess）· React · react-intl · Jest（SWC, jsdom + node envs）

**工作目录：** 所有命令在 worktree 内执行：`/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223`。jest **必须** `cd` 进该 worktree 再运行（否则触发 main checkout 的 haste 冲突，跑错测试）。

---

## File Structure

- **Modify** `app/api/tasks/[id]/documents/route.ts` — GET handler 把 `m.source` 透传进每个 document（约第 62 行一处）。
- **Modify** `lib/api-client/task-documents.ts` — `TaskDocumentResource` 增 `source: 'CONTENT' | 'EXPLICIT'`。
- **Modify** `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx` — 排序 + badge + detach 收敛 + 空态文案。
- **Modify** `__tests__/api/tasks-documents.test.ts` — 新增「透传 source」断言。
- **Create** `__tests__/components/DocumentsSection.test.tsx` — 组件渲染测试。
- **Modify** `lib/i18n/*.json` ×16 — 新增 2 个 key + 更新 1 个 key。

---

## Task 1: 后端透传 `source`

**Files:**
- Modify: `app/api/tasks/[id]/documents/route.ts:62`
- Test: `__tests__/api/tasks-documents.test.ts`

- [ ] **Step 1: 在现有 GET 测试套件里加一个失败测试**

打开 `__tests__/api/tasks-documents.test.ts`，在 `describe('GET /api/tasks/[id]/documents', ...)` 内、最后一个 `it(...)` 之后插入：

```ts
  it('passes through the mention source on each document', async () => {
    const cuid = 'cld7z3k2m0000abc12345678x'
    miscRepository.findDocumentMentionsByTask.mockResolvedValueOnce([
      {
        source: 'CONTENT',
        document: {
          id: 'doc1',
          slug: 'sprint-notes',
          title: 'Sprint notes',
          emoji: null,
          updatedAt: new Date('2026-06-01').toISOString(),
        },
      },
      {
        source: 'EXPLICIT',
        document: {
          id: 'doc2',
          slug: 'spec',
          title: 'Spec',
          emoji: '📄',
          updatedAt: new Date('2026-06-02').toISOString(),
        },
      },
    ])

    const res = await GET(mkGetReq(cuid), {
      params: Promise.resolve({ id: cuid }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.documents).toHaveLength(2)
    expect(json.documents[0]).toMatchObject({ id: 'doc1', source: 'CONTENT' })
    expect(json.documents[1]).toMatchObject({ id: 'doc2', source: 'EXPLICIT' })
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223 && npx jest __tests__/api/tasks-documents.test.ts -t "passes through the mention source"`
Expected: FAIL — `json.documents[0]` 缺少 `source`（`toMatchObject` 报 source undefined）。

- [ ] **Step 3: 改 route 透传 source**

在 `app/api/tasks/[id]/documents/route.ts`，把：

```ts
  const documents = mentions.map(m => m.document)
```

改为：

```ts
  const documents = mentions.map(m => ({ ...m.document, source: m.source }))
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223 && npx jest __tests__/api/tasks-documents.test.ts`
Expected: PASS（新测试 + 原有 GET/POST 测试全绿；原有断言只查 `.id`，不受影响）。

- [ ] **Step 5: 提交**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223
git add app/api/tasks/\[id\]/documents/route.ts __tests__/api/tasks-documents.test.ts
git commit -m "feat: pass through doc mention source on task documents API [LUM-223]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: API Client 类型加 `source`

**Files:**
- Modify: `lib/api-client/task-documents.ts:3-9`

> 类型改动，无独立单测；由 Task 1 的 route 测试 + Task 3 的组件测试共同覆盖，并在 Task 6 `tsc` 验证。

- [ ] **Step 1: 给 `TaskDocumentResource` 加 source**

在 `lib/api-client/task-documents.ts`，把：

```ts
export interface TaskDocumentResource {
  id: string
  slug: string
  title: string
  emoji: string | null
  updatedAt: string
}
```

改为：

```ts
/** Whether the backlink came from a `@task` mention in the document body
 * (`CONTENT`, auto-synced on save) or an explicit manual bind (`EXPLICIT`). */
export type TaskDocumentSource = 'CONTENT' | 'EXPLICIT'

export interface TaskDocumentResource {
  id: string
  slug: string
  title: string
  emoji: string | null
  updatedAt: string
  source: TaskDocumentSource
}
```

- [ ] **Step 2: 提交**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223
git add lib/api-client/task-documents.ts
git commit -m "feat: expose source on TaskDocumentResource [LUM-223]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: DocumentsSection — 组件测试（test-first）

**Files:**
- Create: `__tests__/components/DocumentsSection.test.tsx`

> 先写组件测试（此时仍指向未改的组件，部分断言会失败），Task 4 改实现使其通过。组件依赖通过 mock 隔离，不依赖真实 locale 文件 / Radix / 网络。

- [ ] **Step 1: 写组件测试文件**

创建 `__tests__/components/DocumentsSection.test.tsx`：

```tsx
/** @jest-environment jsdom */

const en: Record<string, string> = {
  'task.context.section.documents': 'Documents',
  'taskArtifact.docsRefOnly': 'Reference only',
  'task.context.documents.empty': 'No documents mention this task',
  'task.context.documents.source.content': 'In body',
  'task.context.documents.source.explicit': 'Linked',
  'task.contextLink.doc.detachAction': 'Remove document',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

jest.mock('@/lib/api-client/base', () => ({
  ApiClientError: class ApiClientError extends Error {
    code?: string
  },
}))

jest.mock('@/lib/api-client/task-documents', () => ({
  taskDocumentsClient: {
    search: jest.fn(),
    attach: jest.fn(),
    detach: jest.fn().mockResolvedValue({ removed: 1 }),
  },
}))

// Isolate from Radix Accordion: render label/count/children flatly.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextSection',
  () => ({
    ContextSection: ({
      label,
      count,
      children,
    }: {
      label: string
      count: number
      children: React.ReactNode
    }) => (
      <section>
        <span>{label}</span>
        <span data-testid='count'>{count}</span>
        {children}
      </section>
    ),
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/LinkDocPopover',
  () => ({ LinkDocPopover: () => <button type='button'>add</button> })
)

import { render, screen, within } from '@testing-library/react'
import { DocumentsSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection'
import type { TaskDocumentResource } from '@/lib/api-client/task-documents'

function doc(o: Partial<TaskDocumentResource> & { id: string }): TaskDocumentResource {
  return {
    slug: o.id,
    title: o.id,
    emoji: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    source: 'CONTENT',
    ...o,
  }
}

function renderSection(documents: TaskDocumentResource[]) {
  return render(
    <DocumentsSection
      documents={documents}
      workspaceUrl='ws'
      taskId='tsk1'
      onAttached={jest.fn()}
    />
  )
}

describe('DocumentsSection', () => {
  it('renders source badges for each document', () => {
    renderSection([
      doc({ id: 'a', title: 'Doc A', source: 'CONTENT' }),
      doc({ id: 'b', title: 'Doc B', source: 'EXPLICIT' }),
    ])
    expect(screen.getByText('In body')).toBeInTheDocument()
    expect(screen.getByText('Linked')).toBeInTheDocument()
  })

  it('sorts CONTENT backlinks before EXPLICIT binds', () => {
    renderSection([
      doc({ id: 'x', title: 'Explicit doc', source: 'EXPLICIT' }),
      doc({ id: 'y', title: 'Content doc', source: 'CONTENT' }),
    ])
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]!).getByText('Content doc')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Explicit doc')).toBeInTheDocument()
  })

  it('shows a detach button only for EXPLICIT documents', () => {
    renderSection([
      doc({ id: 'a', title: 'Doc A', source: 'CONTENT' }),
      doc({ id: 'b', title: 'Doc B', source: 'EXPLICIT' }),
    ])
    // Only one row exposes the "Remove document" action.
    expect(screen.getAllByRole('button', { name: 'Remove document' })).toHaveLength(1)
  })

  it('renders the backlink empty-state copy when there are no documents', () => {
    renderSection([])
    expect(
      screen.getByText('No documents mention this task')
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223 && npx jest __tests__/components/DocumentsSection.test.tsx`
Expected: FAIL — 当前组件没有 badge、不排序、detach 按钮两行都有、空态文案是旧的。

- [ ] **Step 3: 提交（仅测试，红灯）**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223
git add __tests__/components/DocumentsSection.test.tsx
git commit -m "test: DocumentsSection source badges + sorting + detach gating [LUM-223]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: DocumentsSection — 实现增强

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx`

- [ ] **Step 1: 改实现（排序 + badge + detach 收敛 + 空态文案）**

把 `DocumentsSection.tsx` 整体替换为：

```tsx
'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import { FileText, X } from 'lucide-react'
import { toast } from 'sonner'
import { ApiClientError } from '@/lib/api-client/base'
import {
  taskDocumentsClient,
  type TaskDocumentResource,
} from '@/lib/api-client/task-documents'
import { ContextSection } from '../ContextSection'
import { LinkDocPopover } from '../../LinkDocPopover'

interface Props {
  documents: TaskDocumentResource[]
  workspaceUrl: string
  taskId: string
  // Refresh callback fired after either an attach or a detach completes.
  // Kept named `onAttached` to avoid churn in ContextTab; functionally it's
  // a "documents changed, please refetch" signal regardless of direction.
  onAttached: () => void | Promise<void>
}

// CONTENT backlinks (mentioned in a doc body) lead; EXPLICIT manual binds
// follow. Array.prototype.sort is stable, so same-source order is preserved.
const SOURCE_ORDER: Record<TaskDocumentResource['source'], number> = {
  CONTENT: 0,
  EXPLICIT: 1,
}

export function DocumentsSection({
  documents,
  workspaceUrl,
  taskId,
  onAttached,
}: Props): React.ReactElement {
  const intl = useIntl()

  const sorted = useMemo(
    () =>
      [...documents].sort(
        (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]
      ),
    [documents]
  )

  const handleSearch = useCallback(async (q: string) => {
    const { documents: hits } = await taskDocumentsClient.search(q)
    return hits
  }, [])

  const handleAttach = useCallback(
    async (payload: { identifier: string } | { documentId: string }) => {
      await taskDocumentsClient.attach(taskId, payload)
      await onAttached()
    },
    [taskId, onAttached]
  )

  const handleDetach = useCallback(
    async (documentId: string) => {
      try {
        await taskDocumentsClient.detach(taskId, documentId)
        await onAttached()
      } catch (err) {
        if (
          err instanceof ApiClientError &&
          err.code === 'CONTENT_MENTION_ONLY'
        ) {
          toast.error(
            intl.formatMessage({
              id: 'task.contextLink.doc.errors.contentMentionOnly',
              defaultMessage:
                'This document is mentioned in the task body. Edit the task description to remove it.',
            })
          )
          return
        }
        toast.error(
          intl.formatMessage({
            id: 'task.contextLink.common.errors.network',
            defaultMessage: 'Something went wrong. Please try again.',
          })
        )
      }
    },
    [taskId, onAttached, intl]
  )

  const addSlot = (
    <LinkDocPopover onSearch={handleSearch} onAttach={handleAttach} />
  )

  return (
    <ContextSection
      value='documents'
      label={intl.formatMessage({
        id: 'task.context.section.documents',
        defaultMessage: 'Documents',
      })}
      icon={<FileText size={14} className='text-zinc-500 dark:text-zinc-400' />}
      count={documents.length}
      addSlot={addSlot}
    >
      <p className='mb-2 text-[11px] text-muted-foreground'>
        {intl.formatMessage({ id: 'taskArtifact.docsRefOnly' })}
      </p>
      {sorted.length === 0 ? (
        <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
          {intl.formatMessage({
            id: 'task.context.documents.empty',
            defaultMessage: 'No documents mention this task',
          })}
        </div>
      ) : (
        <ul className='space-y-1.5'>
          {sorted.map(doc => (
            <li key={doc.id} className='group flex items-center gap-2 text-xs'>
              {doc.emoji ? (
                <span>{doc.emoji}</span>
              ) : (
                <FileText size={12} className='text-zinc-400' />
              )}
              <Link
                href={`/workspace/${workspaceUrl}/documents/${doc.slug}`}
                className='flex-1 text-zinc-700 dark:text-zinc-300 hover:underline truncate'
              >
                {doc.title}
              </Link>
              <span className='shrink-0 rounded px-1 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted'>
                {doc.source === 'CONTENT'
                  ? intl.formatMessage({
                      id: 'task.context.documents.source.content',
                      defaultMessage: 'In body',
                    })
                  : intl.formatMessage({
                      id: 'task.context.documents.source.explicit',
                      defaultMessage: 'Linked',
                    })}
              </span>
              {doc.source === 'EXPLICIT' && (
                <button
                  type='button'
                  onClick={() => {
                    void handleDetach(doc.id)
                  }}
                  aria-label={intl.formatMessage({
                    id: 'task.contextLink.doc.detachAction',
                    defaultMessage: 'Remove document',
                  })}
                  title={intl.formatMessage({
                    id: 'task.contextLink.doc.detachAction',
                    defaultMessage: 'Remove document',
                  })}
                  className='p-0.5 rounded text-zinc-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-opacity'
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </ContextSection>
  )
}
```

- [ ] **Step 2: 运行组件测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223 && npx jest __tests__/components/DocumentsSection.test.tsx`
Expected: PASS（4 个测试全绿）。

- [ ] **Step 3: 提交**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223
git add app/workspace/\[workspaceUrl\]/components/TaskDetailTimeline/sections/DocumentsSection.tsx
git commit -m "feat: source badges + CONTENT-first sort + detach gating in DocumentsSection [LUM-223]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: i18n — 16 locale 同步

**Files:**
- Modify: `lib/i18n/de.json`, `en.json`, `en-AU.json`, `en-GB.json`, `es.json`, `es-419.json`, `fr.json`, `hi.json`, `id.json`, `ja.json`, `ko.json`, `ms.json`, `ru.json`, `vi.json`, `zh-CN.json`, `zh-TW.json`

新增 2 个 key（`task.context.documents.source.content`、`task.context.documents.source.explicit`），并把已存在的 `task.context.documents.empty` 值更新为反链语义。每个文件就近放在现有 `task.context.documents.empty` 一行附近，保持 JSON 合法（注意末尾逗号）。

- [ ] **Step 1: 按下表为每个 locale 写入/更新三条 key**

| locale | `...source.content` | `...source.explicit` | `...documents.empty`（更新） |
| --- | --- | --- | --- |
| de | `Im Text` | `Verknüpft` | `Kein Dokument erwähnt diese Aufgabe` |
| en | `In body` | `Linked` | `No documents mention this task` |
| en-AU | `In body` | `Linked` | `No documents mention this task` |
| en-GB | `In body` | `Linked` | `No documents mention this task` |
| es | `En el cuerpo` | `Vinculado` | `Ningún documento menciona esta tarea` |
| es-419 | `En el cuerpo` | `Vinculado` | `Ningún documento menciona esta tarea` |
| fr | `Dans le corps` | `Lié` | `Aucun document ne mentionne cette tâche` |
| hi | `मुख्य भाग में` | `लिंक किया गया` | `किसी दस्तावेज़ में इस कार्य का उल्लेख नहीं है` |
| id | `Di badan` | `Ditautkan` | `Tidak ada dokumen yang menyebut tugas ini` |
| ja | `本文中` | `リンク済み` | `このタスクに言及しているドキュメントはありません` |
| ko | `본문에` | `연결됨` | `이 작업을 언급한 문서가 없습니다` |
| ms | `Dalam badan` | `Dipaut` | `Tiada dokumen menyebut tugas ini` |
| ru | `В тексте` | `Связано` | `Ни один документ не упоминает эту задачу` |
| vi | `Trong nội dung` | `Đã liên kết` | `Không có tài liệu nào đề cập đến nhiệm vụ này` |
| zh-CN | `正文提及` | `手动绑定` | `还没有文档提到此任务` |
| zh-TW | `正文提及` | `手動綁定` | `還沒有文件提到此任務` |

> 每个文件中插入两行（content/explicit），并就地修改 empty 那一行的值。示例（en.json，键名按字母序就近放置，确保逗号正确）：
>
> ```json
>   "task.context.documents.empty": "No documents mention this task",
>   "task.context.documents.source.content": "In body",
>   "task.context.documents.source.explicit": "Linked",
> ```

- [ ] **Step 2: 校验所有 locale JSON 合法 + 三 key 齐全**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223
for f in lib/i18n/*.json; do node -e "const o=require('./$f'); if(!o['task.context.documents.source.content']||!o['task.context.documents.source.explicit']||!o['task.context.documents.empty']){console.error('MISSING in $f');process.exit(1)}" || exit 1; done && echo "ALL 16 OK"
```
Expected: 打印 `ALL 16 OK`，无 `MISSING`。

- [ ] **Step 3: 提交**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223
git add lib/i18n/*.json
git commit -m "i18n: doc backlink source labels + backlink empty-state copy [LUM-223]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 全量验证

**Files:** 无（验证关卡）

- [ ] **Step 1: 类型检查（先 prisma generate，避免 stale client 误报）**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223 && npx prisma generate && npx tsc --noEmit`
Expected: 无错误。重点关注 `exactOptionalPropertyTypes`（`source` 为必填非可选，不受影响）、`noUncheckedIndexedAccess`（测试里 `items[0]!` 已加非空断言）。

- [ ] **Step 2: 跑相关测试**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223 && npx jest __tests__/api/tasks-documents.test.ts __tests__/components/DocumentsSection.test.tsx`
Expected: 全绿。

- [ ] **Step 3: token-lint（badge 用了语义 token，应通过；若触发 baseline 报错说明误用了裸 palette 类）**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223 && npm run lint:tokens`
Expected: 通过。badge 用的是 `text-muted-foreground` / `bg-muted` 语义 token；其余 `text-zinc-*` 类是从原组件原样保留（既有代码，不在本次 lint 增量内）。

- [ ] **Step 4: 确认无 console.log**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-223 && git diff origin/main --stat && ! git diff origin/main | grep -n "console\.log"`
Expected: 无 `console.log` 命中（命令以非零退出表示有命中）。

---

## 收尾（执行完所有 Task 后，单独确认再做）

- 合并最新 `origin/main`，确认 diff 无 `prisma/migrations/` 误删（stale-branch 陷阱）。
- 开 PR：标题 `feat: distinguish content vs explicit doc backlinks on task detail [LUM-223]`；描述写明「无 schema 变更 / 无迁移 / 无新增 npm 依赖 / 新增 i18n key 已覆盖全部 16 locale」。
- `lumo task update LUM-223 --status in_review`（PR 开启期间）；落 origin/main 后才 `done`。

---

## Self-Review

**Spec coverage:**
- 后端透传 source → Task 1 ✓
- client 类型加 source → Task 2 ✓
- 排序 CONTENT-first → Task 4（`SOURCE_ORDER` + stable sort）✓
- 来源 badge → Task 4 ✓
- detach 仅 EXPLICIT → Task 4 ✓
- 计数保留 / 空态文案反链化 → Task 4（count 不变）+ Task 5（empty 文案）✓
- 16 locale 同步 → Task 5 ✓
- route 透传测试 + 组件测试 → Task 1 + Task 3 ✓
- 验证关卡（tsc/jest/lint/console）→ Task 6 ✓
- 非目标「跳转到提及位置」→ 计划内未实现，符合 spec ✓

**Placeholder scan:** 无 TBD/TODO；所有代码步骤含完整代码；i18n 给出全部 16 locale 实际译文。

**Type consistency:** `TaskDocumentSource` / `source: 'CONTENT'|'EXPLICIT'`（Task 2）与组件 `SOURCE_ORDER`、测试 `doc({source})`、route mock `source` 字段一致；i18n key 名 `task.context.documents.source.content|explicit` 在组件、测试 `en` 字典、Task 5 表三处一致。
