# LUM-226 文档选区锚定评论 — Plan #3（核心 UI 闭环：创建 + 侧栏阅读）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接通文档评论的核心用户闭环：划词 → BubbleMenu「评论」→ 锚定选区的 composer 弹窗 → 提交 → 评论入库 + 正文出现高亮锚点 → 右栏「评论」tab 看到聚合线程。

**Architecture:** `DescriptionEditor` 通过新增 `onEditorReady` 暴露 Tiptap `editor` 给宿主 `DocumentEditorPage`。宿主消费已存在的 `onRequestComment(from,to,quotedText)` 回调打开 `NewCommentPopover`；提交时：生成 id → `editor.chain().setTextSelection({from,to}).setComment(id)` 落 mark → `editor.getHTML()` → 经 `useDocumentComments` 的 create mutation POST `{id,body,from,to,quotedText,content}`（服务端守卫校验后特权落 content，VIEWER 也能评论）。数据用 React Query（镜像 `useWebLinks` 乐观模式）。右栏加「评论」tab 渲染 `DocumentCommentsSidebar`。

**Tech Stack:** React, TanStack Query, Tiptap/ProseMirror, TypeScript strict, Jest (jsdom).

**前置（已在 main）:** Plan #1 后端（`documentCommentsApi`、`/api/documents/[id]/comments`、服务端守卫）、Plan #2 编辑器（`CommentMark` + `setComment/unsetComment` 命令 + BubbleMenu `onRequestComment`）。

**Out of scope（后续 plan）:**

- 回复线程 UI + resolve/reopen UI + 孤儿「原文已删除」展示 → **Plan #4**。
- decoration 插件（active/hover 强调、scroll-to-flash、正文↔侧栏双向联动）→ **Plan #4**。
- Pusher 实时订阅（多端同步）→ **Plan #4**（`usePusherEvent(\`document-${id}\`, 'document-update', …)` 已就绪）。
- @提及通知（需后端 `DOCUMENT_COMMENT_MENTIONED` + service 接线，Plan #1 已显式延后）→ **Plan #5（后端）**。
- i18n 全量 16 locale → **Plan #6**（本计划只加 en/zh-CN 占位 key，PR 注明欠账）。

---

## 关键约定

- 测试 cwd 在仓库内：`cd /Users/chaoli/Desktop/lumo/lumo && npx jest <path>`。
- 分支 `lumo/LUM-226-doc-comments-ui`（已建，off origin/main）。验证 `git branch --show-current`；NEVER checkout/switch/reset/stash；只 add/commit 本任务文件。
- TS strict：可选字段 `field?: T | undefined`；下标先取值再判空。
- RQ 乐观测试用 `waitFor`（LUM-202）；jsdom 不能真开 Radix popover（LUM-190），弹窗逻辑测 props/回调层而非真开。
- 改完测试通过才 commit；msg `type: desc [LUM-226]` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

## 文件结构

**新建：**

- `app/workspace/[workspaceUrl]/hooks/useDocumentComments.ts` — RQ hook（list + create 乐观）。
- `app/workspace/[workspaceUrl]/components/document/comments/NewCommentPopover.tsx` — 锚定选区的 composer。
- `app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar.tsx` — 右栏线程列表。
- `app/workspace/[workspaceUrl]/components/document/comments/useCreateDocComment.ts` — 创建编排（生成 id + 落 mark + getHTML + 调 mutation）。
- 测试：`__tests__/hooks/useDocumentComments.test.tsx`、`__tests__/components/DocumentCommentsSidebar.test.tsx`、`__tests__/components/useCreateDocComment.test.tsx`。

**修改：**

- `lib/validation/schemas.ts` — 放宽 `createDocumentCommentSchema.id` 校验（接受客户端生成 id）。
- `__tests__/lib/validation/documentComment.schema.test.ts` — 更新 id 用例。
- `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx` — 新增 `onEditorReady`。
- `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` — 持有 editor、消费 onRequestComment、挂 popover + 右栏「评论」tab。
- `lib/query/keys.ts` — 加 `documentComments` key。
- `types/`（或就近）— `ApiDocumentComment` 类型。
- `lib/i18n/en.json` + `lib/i18n/zh-CN.json` — 新增评论 UI key。

---

## Task 1: 放宽 `createDocumentCommentSchema.id` 校验

客户端用 `crypto.randomUUID()` 生成 id（仓库现有客户端 id 模式，无新依赖）；`crypto.randomUUID()` 是 UUID，不是 cuid，会被 `z.string().cuid()` 拒。改成接受通用安全 id。

**Files:** Modify `lib/validation/schemas.ts`; Modify `__tests__/lib/validation/documentComment.schema.test.ts`

- [ ] **Step 1: 改测试**（把 id 用例从 cuid 改成 uuid，并加一条拒空/超长）

在 `documentComment.schema.test.ts` 把现有 `id: 'ckxc0000000000000000000a'` 等替换为 `id: '550e8400-e29b-41d4-a716-446655440000'`，并新增：

```typescript
it('accepts a client-generated uuid as id', () => {
  const r = createDocumentCommentSchema.safeParse({
    id: '550e8400-e29b-41d4-a716-446655440000',
    body: 'hi',
  })
  expect(r.success).toBe(true)
})
it('rejects an empty id', () => {
  expect(
    createDocumentCommentSchema.safeParse({ id: '', body: 'x' }).success
  ).toBe(false)
})
```

> 注意：`parentId` 仍是引用已存在评论的服务端 id（cuid），保持 `.cuid()` 不变——只放宽**新建评论自己的** `id`。但客户端回复也会用 `crypto.randomUUID()` 生成新回复 id…… 因此 `parentId` 指向的可能是一个 uuid（之前某条评论的 id）。结论：`parentId` 也放宽成与 `id` 同样的校验（通用 id），不要保留 `.cuid()`，否则回复会校验失败。

- [ ] **Step 2: 跑测试确认失败**
      `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/validation/documentComment.schema.test.ts`

- [ ] **Step 3: 改 schema** in `lib/validation/schemas.ts`

```typescript
// a client- or server-generated id; accept uuid (client) or cuid (server)
const docCommentId = z.string().min(8).max(64)

export const createDocumentCommentSchema = z
  .object({
    id: docCommentId,
    body: z.string().min(1, 'Comment cannot be empty').max(5000),
    parentId: docCommentId.optional(),
    from: z.number().int().min(0).optional(),
    to: z.number().int().min(0).optional(),
    quotedText: z.string().max(10000).optional(),
    content: z.string().max(500000).optional(),
  })
  .refine(v => v.from === undefined || v.to === undefined || v.to >= v.from, {
    message: 'to must be >= from',
    path: ['to'],
  })
```

（`updateDocumentCommentSchema`/`resolveDocumentCommentSchema` 不变。）

- [ ] **Step 4: 跑测试 + tsc**
      `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/validation/documentComment.schema.test.ts` → PASS。
      `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit 2>&1 | grep -i schemas || echo clean`。

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add lib/validation/schemas.ts __tests__/lib/validation/documentComment.schema.test.ts
git commit -m "refactor: accept client-generated id for doc comments [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `DescriptionEditor` 暴露 editor 实例（`onEditorReady`）

宿主需要 editor 实例才能在创建评论后落 mark。

**Files:** Modify `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`; Test `__tests__/components/DescriptionEditorOnReady.test.tsx`（轻量）

- [ ] **Step 1: 读现状**
      确认 `useEditor(...)`（≈line 202）、内部 `editorRef`（≈line 132）、以及把 `editorRef.current` 同步的 `useEffect`（≈line 306）。`DescriptionEditorProps`（≈line 48-99）。

- [ ] **Step 2: 实现**

1. props 接口加：`onEditorReady?: (editor: Editor) => void`（`Editor` 从 `@tiptap/core` 或 `@tiptap/react` import，与文件现有 import 对齐）。
2. 在 editor 创建后、保持 `editorRef` 同步的 `useEffect` 里调用一次（editor 存在且变化时）：

```tsx
useEffect(() => {
  if (editor) onEditorReady?.(editor)
}, [editor, onEditorReady])
```

不破坏任何现有调用方（onEditorReady 可选）。

- [ ] **Step 3: 测试（轻量，jsdom）**
      由于 `DescriptionEditor` 实例化真实 Tiptap 在 jsdom 较重，最小验证：渲染 `DescriptionEditor`（value=''、必要 props），断言 `onEditorReady` 被调用且回参带 `.chain` 方法。若实例化在 jsdom 失败（已知编辑器测试不实例化完整 editor），则**改为**：把"editor→onEditorReady"这段抽成不依赖渲染的断言不现实——退而求其次，跳过该单测，仅靠 tsc + Task 4 的集成测试覆盖；并在报告里说明。优先尝试渲染测试：

```tsx
/** @jest-environment jsdom */
// mock 重型子依赖同 BubbleMenuBar 测试；渲染后 waitFor(() => expect(onReady).toHaveBeenCalled())
```

> 若渲染测试不可行，这是可接受的（编辑器实例化在本仓库测试里普遍回避）——记为 DONE_WITH_CONCERNS 并依赖 tsc + 后续集成。

- [ ] **Step 4: tsc + commit**
      `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit 2>&1 | grep -i DescriptionEditor || echo clean`

```bash
git add "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx" __tests__/components/DescriptionEditorOnReady.test.tsx
git commit -m "feat: DescriptionEditor exposes editor via onEditorReady [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `useDocumentComments` hook + query key + 类型

**Files:** Create `app/workspace/[workspaceUrl]/hooks/useDocumentComments.ts`; Modify `lib/query/keys.ts`; add `ApiDocumentComment` type; Test `__tests__/hooks/useDocumentComments.test.tsx`

- [ ] **Step 1: query key**
      `lib/query/keys.ts` 的 `documents` 附近加：

```typescript
documentComments: (docId: string) => ['document-comments', docId] as const,
```

- [ ] **Step 2: 类型**（就近放，如 `types/` 或 hook 文件内 export）

```typescript
export interface ApiDocumentComment {
  id: string
  documentId: string
  authorActorId: string | null
  body: string
  parentId: string | null
  quotedText: string | null
  anchorStart: number | null
  anchorEnd: number | null
  status: 'OPEN' | 'RESOLVED'
  isOrphaned: boolean
  type: 'USER' | 'AGENT'
  createdAt: string
  author?: {
    id: string
    type: string
    member?: { id: string; clerkId: string } | null
    agent?: { id: string; name: string; avatarColor: string } | null
  } | null
  replies?: ApiDocumentComment[]
}
```

> 字段须与 Plan #1 repo 的 `findByDocumentId` include（`AUTHOR_SELECT` = id/type/member{id,clerkId}/agent{id,name,avatarColor}）一致；执行时对照 `lib/repositories/documentComment.repository.ts` 校正。

- [ ] **Step 3: 写失败测试**（镜像 `useWebLinks.test.tsx`：QueryClientProvider + waitFor + mock api-client）

```tsx
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDocumentComments } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { documentCommentsApi } from '@/lib/api-client/documents'

jest.mock('@/lib/api-client/documents', () => ({
  documentCommentsApi: {
    list: jest.fn(),
    create: jest.fn(),
  },
}))
const api = documentCommentsApi as jest.Mocked<typeof documentCommentsApi>

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

beforeEach(() => jest.clearAllMocks())

it('lists comments', async () => {
  api.list.mockResolvedValue({ comments: [{ id: 'c1', body: 'hi' }] } as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: wrapper(),
  })
  await waitFor(() => expect(result.current.comments).toHaveLength(1))
})

it('optimistically adds a created comment then reconciles', async () => {
  api.list.mockResolvedValue({ comments: [] } as never)
  api.create.mockResolvedValue({
    comment: { id: 'real', body: 'new' },
  } as never)
  const { result } = renderHook(() => useDocumentComments('d1'), {
    wrapper: wrapper(),
  })
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  await act(async () => {
    await result.current.create({
      id: 'tmp-1',
      body: 'new',
      from: 1,
      to: 3,
      quotedText: 'hi',
      content: '<p>x</p>',
    })
  })
  await waitFor(() =>
    expect(result.current.comments.some(c => c.id === 'real')).toBe(true)
  )
})
```

- [ ] **Step 4: 实现** `useDocumentComments.ts`（镜像 useWebLinks 的 onMutate/onError/setQueryData）

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { documentCommentsApi } from '@/lib/api-client/documents'
import type { ApiDocumentComment } from '...' // 上面的类型位置

export interface CreateDocCommentArgs {
  id: string
  body: string
  parentId?: string | undefined
  from?: number | undefined
  to?: number | undefined
  quotedText?: string | undefined
  content?: string | undefined
}

export function useDocumentComments(documentId: string, enabled = true) {
  const queryClient = useQueryClient()
  const key = queryKeys.documentComments(documentId)

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await documentCommentsApi.list<{
        comments: ApiDocumentComment[]
      }>(documentId)
      return res.comments
    },
    enabled: enabled && !!documentId,
  })

  const createMutation = useMutation<
    ApiDocumentComment,
    Error,
    CreateDocCommentArgs,
    { previous: ApiDocumentComment[] | undefined }
  >({
    mutationFn: async args => {
      const res = await documentCommentsApi.create<{
        comment: ApiDocumentComment
      }>(documentId, args)
      return res.comment
    },
    onMutate: async args => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ApiDocumentComment[]>(key)
      const optimistic = {
        id: args.id,
        documentId,
        authorActorId: null,
        body: args.body,
        parentId: args.parentId ?? null,
        quotedText: args.quotedText ?? null,
        anchorStart: args.from ?? null,
        anchorEnd: args.to ?? null,
        status: 'OPEN',
        isOrphaned: false,
        type: 'USER',
        createdAt: new Date().toISOString(),
        replies: [],
      } as ApiDocumentComment
      queryClient.setQueryData<ApiDocumentComment[]>(key, old =>
        args.parentId
          ? (old ?? []).map(t =>
              t.id === args.parentId
                ? { ...t, replies: [...(t.replies ?? []), optimistic] }
                : t
            )
          : [...(old ?? []), optimistic]
      )
      return { previous }
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
    },
    onSuccess: (real, args) => {
      queryClient.setQueryData<ApiDocumentComment[]>(key, old => {
        const list = old ?? []
        if (args.parentId) {
          return list.map(t =>
            t.id === args.parentId
              ? {
                  ...t,
                  replies: (t.replies ?? []).map(r =>
                    r.id === args.id ? real : r
                  ),
                }
              : t
          )
        }
        return list.map(t => (t.id === args.id ? real : t))
      })
    },
  })

  return {
    comments: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    create: createMutation.mutateAsync,
    refetch: query.refetch,
  }
}
```

> `new Date().toISOString()` 出现在事件回调（onMutate），不在 render，符合纯度规则。

- [ ] **Step 5: 跑测试 + tsc**
      `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/hooks/useDocumentComments.test.tsx` → PASS（乐观断言用 waitFor）。
      `npx tsc --noEmit 2>&1 | grep -i "useDocumentComments\|keys.ts" || echo clean`。

- [ ] **Step 6: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useDocumentComments.ts lib/query/keys.ts __tests__/hooks/useDocumentComments.test.tsx <type 文件>
git commit -m "feat: useDocumentComments query+optimistic-create hook [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 创建编排 `useCreateDocComment` + `NewCommentPopover`

把"选区 → composer → 生成 id → 落 mark → getHTML → create mutation"串起来。

**Files:** Create `app/workspace/[workspaceUrl]/components/document/comments/useCreateDocComment.ts`; Create `.../NewCommentPopover.tsx`; Test `__tests__/components/useCreateDocComment.test.tsx`

- [ ] **Step 1: 写失败测试（测编排逻辑，不真开弹窗）**

```tsx
import { buildCreateCommentPayload } from '@/app/workspace/[workspaceUrl]/components/document/comments/useCreateDocComment'

describe('buildCreateCommentPayload', () => {
  it('applies the mark over the captured range and returns payload with content', () => {
    const chain = {
      setTextSelection: jest.fn().mockReturnThis(),
      setComment: jest.fn().mockReturnThis(),
      run: jest.fn().mockReturnValue(true),
    }
    const editor = {
      chain: () => chain,
      getHTML: () => '<p><span data-comment-id="ID">hi</span></p>',
    } as never
    const payload = buildCreateCommentPayload(editor, {
      id: 'ID',
      body: 'nice',
      from: 1,
      to: 3,
      quotedText: 'hi',
    })
    expect(chain.setTextSelection).toHaveBeenCalledWith({ from: 1, to: 3 })
    expect(chain.setComment).toHaveBeenCalledWith('ID')
    expect(chain.run).toHaveBeenCalled()
    expect(payload).toEqual({
      id: 'ID',
      body: 'nice',
      from: 1,
      to: 3,
      quotedText: 'hi',
      content: '<p><span data-comment-id="ID">hi</span></p>',
    })
  })
})
```

- [ ] **Step 2: 实现 `useCreateDocComment.ts`**

```typescript
import type { Editor } from '@tiptap/core'
import type { CreateDocCommentArgs } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

export interface PendingComment {
  id: string
  body: string
  from: number
  to: number
  quotedText: string
}

/** Apply the comment mark over the captured range and produce the POST payload. */
export function buildCreateCommentPayload(
  editor: Editor,
  p: PendingComment
): CreateDocCommentArgs {
  editor
    .chain()
    .setTextSelection({ from: p.from, to: p.to })
    .setComment(p.id)
    .run()
  return {
    id: p.id,
    body: p.body,
    from: p.from,
    to: p.to,
    quotedText: p.quotedText,
    content: editor.getHTML(),
  }
}

/** Generate a client-side id (no cuid dep; schema accepts it). */
export function newCommentId(): string {
  return crypto.randomUUID()
}
```

- [ ] **Step 3: `NewCommentPopover.tsx`**（复用 `CommentEditor`；Radix Popover 锚到选区坐标或一个虚拟 ref）

```tsx
'use client'
import { useRef } from 'react'
import { useIntl } from 'react-intl'
import { CommentEditor } from '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor'
import { Button } from '@/components/ui/button'
import type { WorkspaceMemberInfo } from '...'

export interface NewCommentPopoverProps {
  open: boolean
  quotedText: string
  members?: WorkspaceMemberInfo[]
  onCancel: () => void
  onSubmit: (body: string) => void
  // 位置：由宿主用 Radix Popover/anchor 控制；本组件只管内容+提交
}

export function NewCommentPopover(props: NewCommentPopoverProps) {
  const intl = useIntl()
  const bodyRef = useRef<string | null>(null)
  const clearRef = useRef<(() => void) | null>(null)
  if (!props.open) return null
  return (
    <div
      className='rounded-md border bg-popover p-2 shadow-md w-80'
      role='dialog'
    >
      <div className='mb-1 text-xs text-muted-foreground line-clamp-2'>
        “{props.quotedText}”
      </div>
      <CommentEditor
        onCommit={html => (bodyRef.current = html)}
        onSubmit={() => {
          const body = bodyRef.current?.trim()
          if (body) props.onSubmit(body)
        }}
        clearRef={clearRef}
        members={props.members}
      />
      <div className='mt-2 flex justify-end gap-2'>
        <Button variant='ghost' size='sm' onClick={props.onCancel}>
          {intl.formatMessage({ id: 'common.cancel' })}
        </Button>
        <Button
          size='sm'
          onClick={() => {
            const body = bodyRef.current?.trim()
            if (body) props.onSubmit(body)
          }}
        >
          {intl.formatMessage({ id: 'editor.comment' })}
        </Button>
      </div>
    </div>
  )
}
```

> 用现有 `common.cancel`（确认 key 存在，否则加到 en/zh-CN）。Radix Popover 真开在 jsdom 测不了（LUM-190），所以本组件不依赖 Popover 容器——宿主负责定位（可用 BubbleMenu 已有的 tippy/portal 或一个绝对定位层）；组件本身可被直接渲染测试（open=true 时渲染、点击「评论」调 onSubmit）。

- [ ] **Step 4: 测试通过 + tsc**
      `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/components/useCreateDocComment.test.tsx` → PASS。tsc clean。

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/document/comments/useCreateDocComment.ts \
        app/workspace/[workspaceUrl]/components/document/comments/NewCommentPopover.tsx \
        __tests__/components/useCreateDocComment.test.tsx
git commit -m "feat: doc comment create orchestration + composer popover [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 侧栏 `DocumentCommentsSidebar` + 宿主接线

把 hook + popover + 侧栏接进 `DocumentEditorPage`：右栏「大纲/评论」tab，消费 `onRequestComment` 打开 popover，提交走编排→mutation。

**Files:** Create `.../comments/DocumentCommentsSidebar.tsx`; Modify `DocumentEditorPage.tsx`; Test `__tests__/components/DocumentCommentsSidebar.test.tsx`; i18n en/zh-CN

- [ ] **Step 1: 写失败测试（侧栏渲染线程列表）**

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { DocumentCommentsSidebar } from '@/app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar'

const msgs = {
  'document.comments': 'Comments',
  'document.noComments': 'No comments yet',
}
function r(ui: React.ReactNode) {
  return render(
    <IntlProvider locale='en' messages={msgs}>
      {ui}
    </IntlProvider>
  )
}

it('renders an empty state', () => {
  r(
    <DocumentCommentsSidebar
      comments={[]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
    />
  )
  expect(screen.getByText('No comments yet')).toBeInTheDocument()
})

it('renders a thread with its quoted text and body', () => {
  r(
    <DocumentCommentsSidebar
      comments={[
        {
          id: 'c1',
          documentId: 'd1',
          authorActorId: null,
          body: '<p>looks good</p>',
          parentId: null,
          quotedText: 'the intro',
          anchorStart: 1,
          anchorEnd: 5,
          status: 'OPEN',
          isOrphaned: false,
          type: 'USER',
          createdAt: '2026-06-04T00:00:00Z',
          replies: [],
        } as never,
      ]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
    />
  )
  expect(screen.getByText(/the intro/)).toBeInTheDocument()
  expect(screen.getByText(/looks good/)).toBeInTheDocument()
})
```

- [ ] **Step 2: 实现 `DocumentCommentsSidebar.tsx`**（纯展示；线程 = 顶层评论 + 引文 + body；复用 `CommentAvatar`/`resolveCommentAuthor`；回复/resolve 留 Plan #4，本期只渲染顶层 body + 回复计数）

```tsx
'use client'
import { useIntl } from 'react-intl'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { CommentAvatar } from '@/app/workspace/[workspaceUrl]/components/CommentAvatar'
import { resolveCommentAuthor } from '@/app/workspace/[workspaceUrl]/components/comment-utils'
import type { WorkspaceMemberInfo } from '...'

export interface DocumentCommentsSidebarProps {
  comments: ApiDocumentComment[]
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  currentActorId: string | null | undefined
  onSelectThread?: (commentId: string) => void
}

export function DocumentCommentsSidebar(props: DocumentCommentsSidebarProps) {
  const intl = useIntl()
  if (props.comments.length === 0) {
    return (
      <div className='p-3 text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'document.noComments' })}
      </div>
    )
  }
  return (
    <div className='flex flex-col gap-2 p-2'>
      {props.comments.map(c => {
        const author = resolveCommentAuthor(c, props.members, props.agentActors)
        return (
          <button
            key={c.id}
            type='button'
            onClick={() => props.onSelectThread?.(c.id)}
            className='rounded-md border p-2 text-left hover:bg-muted'
          >
            {c.quotedText && (
              <div className='mb-1 border-l-2 border-primary/50 pl-2 text-xs text-muted-foreground line-clamp-2'>
                {c.quotedText}
              </div>
            )}
            <div className='flex items-center gap-2'>
              <CommentAvatar
                isAgent={author.isAgent}
                imageUrl={author.imageUrl}
                initials={author.initials}
                size='sm'
              />
              <div
                className='prose-sm text-sm'
                dangerouslySetInnerHTML={{ __html: c.body }}
              />
            </div>
            {(c.replies?.length ?? 0) > 0 && (
              <div className='mt-1 text-xs text-muted-foreground'>
                {c.replies!.length}{' '}
                {intl.formatMessage({ id: 'document.replies' })}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

> `dangerouslySetInnerHTML` 渲染评论 body：与现有 CommentItem 一致（body 是受信的内部 HTML），但执行时确认现有评论渲染是否走 sanitizer；若有 `sanitizeHtml` util 则套用，保持一致。

- [ ] **Step 3: 接线 `DocumentEditorPage.tsx`**

1. 持有 editor：`const editorRef = useRef<Editor | null>(null)`，给 `<DescriptionEditor onEditorReady={e => (editorRef.current = e)} ... />`。
2. `const { comments, create } = useDocumentComments(doc.id)`。
3. `const [pending, setPending] = useState<{from:number;to:number;quotedText:string}|null>(null)`；给 `<DescriptionEditor onRequestComment={(from,to,quotedText)=>setPending({from,to,quotedText})} />`。
4. 渲染 `NewCommentPopover open={!!pending}`，onCancel `setPending(null)`，onSubmit:

```tsx
onSubmit={async body => {
  const editor = editorRef.current
  if (!editor || !pending) return
  const id = newCommentId()
  const payload = buildCreateCommentPayload(editor, { id, body, ...pending })
  setPending(null)
  try {
    await create(payload)
  } catch {
    editor.commands.unsetComment(id) // 回滚正文 mark
  }
}}
```

5. 右栏：把现有 TOC `<aside>` 改成「大纲 / 评论」两 tab（用现有 tab 原语或简单按钮切换 state `rightTab: 'toc'|'comments'`），评论 tab 渲染 `<DocumentCommentsSidebar comments={comments} members={...} agentActors={...} currentActorId={...} />`。保持 TOC 行为不变（tab 默认 'toc'）。

- [ ] **Step 4: i18n（en + zh-CN）**
      加 `document.comments`/`document.noComments`/`document.replies`（+ 若缺 `common.cancel` 也补）。en: "Comments"/"No comments yet"/"replies"；zh-CN: "评论"/"还没有评论"/"条回复"。其余 locale 留 Plan #6。

- [ ] **Step 5: 测试 + tsc**
      `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/components/DocumentCommentsSidebar.test.tsx` → PASS。
      `npx tsc --noEmit` → 0。

- [ ] **Step 6: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar.tsx \
        "app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx" \
        lib/i18n/en.json lib/i18n/zh-CN.json \
        __tests__/components/DocumentCommentsSidebar.test.tsx
git commit -m "feat: document comments sidebar + create wiring [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾验证

- [ ] `npx tsc --noEmit` → 0。
- [ ] `npx jest __tests__/lib/validation/documentComment.schema.test.ts __tests__/hooks/useDocumentComments.test.tsx __tests__/components/useCreateDocComment.test.tsx __tests__/components/DocumentCommentsSidebar.test.tsx` → 全绿。
- [ ] `npm run lint:tokens`（侧栏/popover 用了语义类，应无回归）。
- [ ] 手验思路（无法在此自动化）：文档里划词→「评论」→弹窗→提交→正文高亮 + 右栏「评论」tab 出现该线程。
- [ ] PR 描述：①无迁移；②i18n 仅 en/zh-CN，其余留 Plan #6；③放宽了 `createDocumentCommentSchema` 的 id 校验（接受客户端 uuid）；④回复/resolve/decoration 联动/实时/@通知仍在后续 plan；⑤无新 npm 包（用 `crypto.randomUUID`）。

## 自查（spec coverage）

| 设计要求                                   | 本计划                                             | 备注                                   |
| ------------------------------------------ | -------------------------------------------------- | -------------------------------------- |
| 划词→气泡→发评论                           | Task 4/5                                           | onRequestComment→popover→编排→mutation |
| 落 mark + 守卫 content-patch               | Task 4（setComment+getHTML+POST content）          | 服务端 Plan #1 守卫                    |
| VIEWER 可评论                              | 继承 Plan #1                                       | content 走评论端点特权补丁             |
| 正文高亮锚点                               | Plan #2 mark + 本期创建即可见                      |                                        |
| 侧栏聚合线程                               | Task 5                                             | 顶层 body + 引文 + 回复计数            |
| 乐观更新                                   | Task 3                                             | waitFor 测                             |
| 客户端 id                                  | Task 1（放宽 schema）+ Task 4（crypto.randomUUID） | 无新依赖                               |
| 回复 UI / resolve / 孤儿展示               | ❌ → Plan #4                                       |                                        |
| decoration（active/hover/scroll/双向联动） | ❌ → Plan #4                                       |                                        |
| 实时                                       | ❌ → Plan #4                                       | usePusherEvent 已就绪                  |
| @提及通知                                  | ❌ → Plan #5（后端）                               |                                        |
| i18n 全量                                  | ❌ → Plan #6                                       |                                        |
