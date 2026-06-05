# LUM-226 文档选区锚定评论 — Plan #5（双向联动 + 实时 + 孤儿触发）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让正文与侧栏评论真正"联动"且多端"同步"：① 点正文里的高亮 → 侧栏定位并高亮对应线程（反向联动），点侧栏线程 → 正文锚点滚动 + 闪烁（已有滚动，补 flash + active 高亮）；② Pusher 实时：他人增删改/resolve 评论时本端侧栏自动刷新；③ 触发已有的 `detectAndFlagOrphans`，让"原文已删除"的孤儿状态真正出现。

**Architecture（贴合仓库现状，避免过度工程）:**

- 仓库**无 ProseMirror decoration 插件先例**，团队惯例是直接操作渲染后的 DOM（scroll-flash 即 `querySelector + setTimeout` 改 class）。因此**不建 decoration 插件**：active 高亮 / flash 用直接给 `span[data-comment-id]` 加/去 `.comment-highlight--active` class 实现；正文点击检测用 `editorProps.handleClick` 闭包 ref（与现有 `handleKeyDown/handlePaste` 同模式）。
- 实时用现成 `usePusherEvent(channel,event,cb)`；孤儿在 `getComments` 服务端触发。

**Tech Stack:** React, TanStack Query, Tiptap/ProseMirror（仅 editorProps，不写自定义插件）, TS strict, Jest (jsdom).

**前置（全在 main）:** Plan #1–#4（service `detectAndFlagOrphans`、`pushDocumentEvent`、`useDocumentComments`、`DocumentCommentsSidebar`/`DocumentCommentThread`、`DocumentEditorPage` 接线、`onEditorReady`、`CommentMark` 渲染 `span[data-comment-id]`、`usePusherEvent`）。

**Out of scope（后续 plan）:** @提及通知后端（`DOCUMENT_COMMENT_MENTIONED`）→ **Plan #6**；i18n 全量 → **Plan #7**；服务端编辑/删除作者校验 → 取决于未决权限边界（设计 §13）。

---

## 关键约定

- 测试 cwd 在仓库内；分支须为本计划分支（`lumo/LUM-226-doc-comments-decoration`，off origin/main）；NEVER checkout/switch/reset/stash；只 add/commit 本任务文件。
- TS strict（`field?: T | undefined`；下标先取值再判空）；service 抛 `Object.assign(new Error,{status})`。
- 组件/纯函数测试优先；jsdom 可建 DOM 测 class 切换；`jest.mock('react-intl')`。
- 改完测试通过才 commit；msg `type: desc [LUM-226]` + Co-Authored-By。

## 文件结构

**新建：**

- `app/workspace/[workspaceUrl]/components/document/comments/anchor-dom.ts` — 纯/DOM 工具：`commentIdFromEventTarget(target)`、`flashEditorAnchor(editor, id)`、`setActiveEditorAnchor(editor, id|null)`、`docCommentEventNeedsRefetch(event)`。
- 测试：`__tests__/components/anchorDom.test.ts`。

**修改：**

- `lib/services/documentComment.service.ts` — `getComments` 内触发 `detectAndFlagOrphans`。
- `__tests__/lib/services/documentComment.service.test.ts` — 加 getComments-触发孤儿用例。
- `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx` — 新增 `onCommentClick?` + `editorProps.handleClick`。
- `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` — `activeCommentId` 状态、反向联动接线、实时订阅、点线程 flash。
- `app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar.tsx` + `DocumentCommentThread.tsx` — 接收 `activeCommentId` 高亮当前线程 + 滚动入视。
- `app/globals.css` — `.comment-highlight--active`。

---

## Task 1: 服务端 `getComments` 触发孤儿检测

**Files:** Modify `lib/services/documentComment.service.ts`; extend `__tests__/lib/services/documentComment.service.test.ts`

- [ ] **Step 1: 失败测试**（getComments 应在返回前按当前 content 刷新孤儿标记）

```typescript
describe('getComments triggers orphan detection', () => {
  it('flags comments whose id is absent from current doc content', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      ...DOC,
      content: '<p>Hello brave world</p>', // no comment span at all
    } as never)
    repo.findByDocumentId.mockResolvedValue([
      { id: 'c1', status: 'OPEN', isOrphaned: false },
    ] as never)
    repo.setOrphaned.mockResolvedValue({ count: 1 } as never)
    await documentCommentService.getComments('d1', 'm-viewer', 'w1')
    expect(repo.setOrphaned).toHaveBeenCalledWith(['c1'], true)
  })

  it('denies without doc access (404) and does not detect', async () => {
    docRepo.findWithPermission.mockResolvedValue(null as never)
    await expect(
      documentCommentService.getComments('d1', 'm-x', 'w1')
    ).rejects.toMatchObject({ status: 404 })
    expect(repo.setOrphaned).not.toHaveBeenCalled()
  })
})
```

> 注意：现有 `detectAndFlagOrphans` 内部会调用 `repo.findByDocumentId`；测试里 `repo.findByDocumentId` 已 mock，所以两次调用都返回同一桩，断言 `setOrphaned(['c1'], true)` 成立。

- [ ] **Step 2: 跑测试确认失败**
      `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/services/documentComment.service.test.ts`

- [ ] **Step 3: 实现** —— 改 `getComments`

```typescript
async getComments(documentId: string, memberId: string, workspaceId: string) {
  const doc = await documentRepository.findWithPermission(documentId, memberId, workspaceId)
  if (!doc) notFound()
  // Refresh orphan flags against the current document content before returning.
  await this.detectAndFlagOrphans(documentId, doc.content)
  return documentCommentRepository.findByDocumentId(documentId)
},
```

> `detectAndFlagOrphans` 已是本 service 方法（`this.`）。它会多跑一次 `findByDocumentId`（一次用于检测、一次用于返回），可接受（轻量、读多写少）；若执行时想省一次查询可内联，但优先保持简单。`doc.content` 可空，方法已处理。

- [ ] **Step 4: 测试 + tsc** → green / 0（service 相关）。
- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add lib/services/documentComment.service.ts __tests__/lib/services/documentComment.service.test.ts
git commit -m "feat: refresh comment orphan flags on getComments [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: anchor-dom 工具（纯 + DOM）

**Files:** Create `app/workspace/[workspaceUrl]/components/document/comments/anchor-dom.ts`; Test `__tests__/components/anchorDom.test.ts`

- [ ] **Step 1: 失败测试**

```ts
/** @jest-environment jsdom */
import {
  commentIdFromEventTarget,
  setActiveEditorAnchor,
  flashEditorAnchor,
  docCommentEventNeedsRefetch,
} from '@/app/workspace/[workspaceUrl]/components/document/comments/anchor-dom'

function makeEditor(html: string) {
  const dom = document.createElement('div')
  dom.innerHTML = html
  return { view: { dom } } as never
}

describe('commentIdFromEventTarget', () => {
  it('returns the comment id when clicking inside a comment span', () => {
    const dom = document.createElement('div')
    dom.innerHTML = '<span data-comment-id="c1">hi</span>'
    const inner = dom.querySelector('span')!.firstChild as Node
    expect(commentIdFromEventTarget(inner)).toBe('c1')
  })
  it('returns null outside any comment span', () => {
    const dom = document.createElement('div')
    dom.innerHTML = '<p>plain</p>'
    expect(commentIdFromEventTarget(dom.querySelector('p'))).toBeNull()
  })
})

describe('setActiveEditorAnchor', () => {
  it('adds active class to matching spans and clears others', () => {
    const editor = makeEditor(
      '<span data-comment-id="c1">a</span><span data-comment-id="c2">b</span>'
    )
    setActiveEditorAnchor(editor, 'c1')
    const dom = (editor as { view: { dom: HTMLElement } }).view.dom
    expect(
      dom
        .querySelector('[data-comment-id="c1"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(true)
    expect(
      dom
        .querySelector('[data-comment-id="c2"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(false)
    setActiveEditorAnchor(editor, null)
    expect(
      dom
        .querySelector('[data-comment-id="c1"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(false)
  })
})

describe('flashEditorAnchor', () => {
  it('adds the active class then removes it after the timeout', () => {
    jest.useFakeTimers()
    const editor = makeEditor('<span data-comment-id="c1">a</span>')
    const dom = (editor as { view: { dom: HTMLElement } }).view.dom
    flashEditorAnchor(editor, 'c1')
    expect(
      dom
        .querySelector('[data-comment-id="c1"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(true)
    jest.advanceTimersByTime(1500)
    expect(
      dom
        .querySelector('[data-comment-id="c1"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(false)
    jest.useRealTimers()
  })
})

describe('docCommentEventNeedsRefetch', () => {
  it('is true for doc-comment events, false otherwise', () => {
    expect(
      docCommentEventNeedsRefetch({
        type: 'doc-comment:created',
        commentId: 'x',
      })
    ).toBe(true)
    expect(
      docCommentEventNeedsRefetch({
        type: 'doc-comment:status',
        commentId: 'x',
        status: 'OPEN',
      })
    ).toBe(true)
    expect(
      docCommentEventNeedsRefetch({ type: 'something-else' } as never)
    ).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 `anchor-dom.ts`**

```typescript
import type { Editor } from '@tiptap/core'

const ACTIVE_CLASS = 'comment-highlight--active'
const SELECTOR = 'span[data-comment-id]'

/** Walk up from a clicked node/element to the enclosing comment span's id, or null. */
export function commentIdFromEventTarget(
  target: EventTarget | Node | null
): string | null {
  const el =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
  const span = el?.closest(SELECTOR) ?? null
  return span?.getAttribute('data-comment-id') ?? null
}

function editorDom(editor: Editor): HTMLElement | null {
  // editor.view.dom is the contenteditable root
  return (
    (editor as unknown as { view?: { dom?: HTMLElement } }).view?.dom ?? null
  )
}

/** Toggle the active emphasis class so only the given comment id's spans are active. */
export function setActiveEditorAnchor(
  editor: Editor,
  commentId: string | null
): void {
  const dom = editorDom(editor)
  if (!dom) return
  dom
    .querySelectorAll(`${SELECTOR}.${ACTIVE_CLASS}`)
    .forEach(s => s.classList.remove(ACTIVE_CLASS))
  if (commentId) {
    dom
      .querySelectorAll(`${SELECTOR}[data-comment-id="${commentId}"]`)
      .forEach(s => s.classList.add(ACTIVE_CLASS))
  }
}

/** Briefly flash the given comment's spans (mirrors the task-comment 1.5s flash). */
export function flashEditorAnchor(editor: Editor, commentId: string): void {
  const dom = editorDom(editor)
  if (!dom) return
  const spans = dom.querySelectorAll(
    `${SELECTOR}[data-comment-id="${commentId}"]`
  )
  spans.forEach(s => s.classList.add(ACTIVE_CLASS))
  setTimeout(() => spans.forEach(s => s.classList.remove(ACTIVE_CLASS)), 1500)
}

type DocEventish = { type?: string }
/** True when a pusher document event concerns comments and should refetch. */
export function docCommentEventNeedsRefetch(event: DocEventish): boolean {
  return (
    typeof event?.type === 'string' && event.type.startsWith('doc-comment:')
  )
}
```

> `setTimeout` 在事件处理路径里调用（非 render），符合纯度规则。`editor.view.dom` 在测试里用 `{ view: { dom } }` 桩即可。

- [ ] **Step 4: 测试 + tsc** → green / 0。
- [ ] **Step 5: `.comment-highlight--active` 样式**（`app/globals.css`，紧邻 `.comment-highlight`，语义 token）：

```css
.comment-highlight--active {
  background-color: hsl(var(--primary) / 0.3);
  transition: background-color 0.3s ease;
}
```

`npm run lint:tokens` 应无回归。

- [ ] **Step 6: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/document/comments/anchor-dom.ts" __tests__/components/anchorDom.test.ts app/globals.css
git commit -m "feat: comment anchor DOM utils (active/flash/click-id) + active style [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 反向联动 + 实时 + flash 接线

**Files:** Modify `DescriptionEditor.tsx`, `DocumentEditorPage.tsx`, `DocumentCommentsSidebar.tsx`, `DocumentCommentThread.tsx`; tests for sidebar active-highlight

- [ ] **Step 1: `DescriptionEditor` 加 `onCommentClick`**

1. props 加：`onCommentClick?: (commentId: string) => void`。
2. 存进 ref（仿 `openLinkInputRef` 模式）：`const onCommentClickRef = useRef(onCommentClick); useEffect(() => { onCommentClickRef.current = onCommentClick }, [onCommentClick])`。
3. 在 `useEditor` 的 `editorProps` 里加 `handleClick`（与 `handleKeyDown`/`handlePaste` 同块，闭包 ref）：

```ts
handleClick: (_view, _pos, event) => {
  const id = commentIdFromEventTarget(event.target as Node | null)
  if (id) { onCommentClickRef.current?.(id); return false }
  return false
},
```

import `commentIdFromEventTarget` from the anchor-dom util. 返回 `false` 不拦截默认行为。

> 测试：`handleClick` 难在 jsdom 真触发；本步靠 `commentIdFromEventTarget` 的单测（Task 2）+ tsc 覆盖。可选：抽一个不依赖渲染的 `makeCommentClickHandler(ref)` 纯函数并单测，但 YAGNI——优先 tsc。

- [ ] **Step 2: 侧栏 + 线程接收 `activeCommentId`**
- `DocumentCommentsSidebar` 加 prop `activeCommentId?: string | null`，透传给每个 `DocumentCommentThread`；并对 active 的线程容器加 `ref` + 在 `activeCommentId` 变化时 `scrollIntoView({block:'nearest'})`（用一个 effect + 该线程的 ref；只滚 active 的）。
- `DocumentCommentThread` 加 prop `active?: boolean`，active 时容器加高亮类（如 `ring-1 ring-primary`）。给容器加 `data-comment-thread={thread.id}`，方便侧栏用 `querySelector` 找到并滚动（比逐个 ref 简单）。
  - 实测更简单的做法：侧栏在 `activeCommentId` 变化的 effect 里 `containerRef.current?.querySelector(\`[data-comment-thread="${activeCommentId}"]\`)?.scrollIntoView({block:'nearest'})`。
- 更新 `DocumentCommentsSidebar.test.tsx`（mock `DocumentCommentThread` 桩透出 `active`）：断言传入 `activeCommentId='c1'` 时对应桩收到 `active=true`。

- [ ] **Step 3: 宿主 `DocumentEditorPage` 接线**

1. `const [activeCommentId, setActiveCommentId] = useState<string | null>(null)`（顶层）。
2. `useQueryClient()` + 实时订阅：

```tsx
const qc = useQueryClient()
usePusherEvent(
  `document-${doc.id}`,
  'document-update',
  (event: { type?: string }) => {
    if (docCommentEventNeedsRefetch(event)) {
      void qc.invalidateQueries({
        queryKey: queryKeys.documentComments(doc.id),
      })
    }
  }
)
```

3. 反向联动：给 `<DescriptionEditor onCommentClick={id => { setActiveCommentId(id); setRightTab?.('comments') }} />`（若右栏 tab 由 `activeRightTab` 派生，确保点击能切到评论 tab——用现有 `setRightTab('comments')`）。同时 `setActiveEditorAnchor(editorRef.current, id)` 高亮正文。
4. 正向 flash：现有 `scrollToAnchor`（onSelectThread）里追加 `flashEditorAnchor(editorRef.current, commentId)` + `setActiveCommentId(commentId)`。
5. 传 `activeCommentId={activeCommentId}` 给 `<DocumentCommentsSidebar>`。
6. 当 `activeCommentId` 变化，effect 调 `setActiveEditorAnchor(editorRef.current, activeCommentId)` 让正文高亮跟随（统一出口；移除步骤 3 里重复的调用，改为只 setState，由 effect 驱动 DOM）。

```tsx
useEffect(() => {
  if (editorRef.current)
    setActiveEditorAnchor(editorRef.current, activeCommentId)
}, [activeCommentId])
```

- [ ] **Step 4: 验证**
      `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/components/anchorDom.test.ts __tests__/components/DocumentCommentsSidebar.test.tsx __tests__/lib/services/documentComment.service.test.ts` → green。
      `npx tsc --noEmit` → 0。`npm run lint:tokens` → 无回归。

- [ ] **Step 5: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx" \
        "app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx" \
        "app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar.tsx" \
        "app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentThread.tsx" \
        __tests__/components/DocumentCommentsSidebar.test.tsx
git commit -m "feat: comment editor<->sidebar two-way linking + realtime refresh [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾验证

- [ ] `npx tsc --noEmit` → 0；上述测试全绿；`lint:tokens` 无回归。
- [ ] 无 `console.log`；无新 npm 包；无迁移。
- [ ] 手验思路：点正文高亮→右栏切到评论 tab 且该线程高亮/滚入；点侧栏线程→正文滚动 + 闪烁；另一端改评论→本端侧栏自动刷新；删掉被评论原文→重开文档侧栏显示「原文已删除」。
- [ ] PR 描述：①无迁移/无新依赖；②采用直接 DOM class 切换而非 PM decoration 插件（贴合仓库惯例、YAGNI），权衡见下；③i18n 仍 en/zh-CN（Plan #7）；④@通知 Plan #6；⑤编辑/删除服务端作者校验取决于未决权限边界。

## 设计权衡（写进 PR）

active 高亮/flash 用直接操作渲染 DOM 的 class（仓库已有 scroll-flash 同模式），而非 ProseMirror decoration 插件。优点：零插件依赖、与现有代码一致、易测；风险：若 ProseMirror 在 active 期间重渲染被评论节点，class 可能被冲掉——但 active 是交互态（短暂），且 PM 仅重渲染变化节点，实测可接受。若日后需要"持久且绝对可靠"的高亮，再升级为 decoration 插件（独立小重构）。

## 自查（spec coverage）

| 设计要求                        | 本计划                                                                         | 备注                          |
| ------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| 点侧栏线程→正文滚动             | 已有（Plan #4）+ 本期补 flash                                                  |                               |
| 点正文高亮→侧栏定位（反向联动） | Task 1?(no) Task 3（handleClick→onCommentClick→activeCommentId→侧栏高亮+滚动） |                               |
| active/hover 强调高亮           | Task 2/3（`.comment-highlight--active` + setActiveEditorAnchor）               | hover 可后续加；本期做 active |
| scroll-to-flash                 | Task 2/3（flashEditorAnchor 1.5s）                                             |                               |
| 实时多端同步                    | Task 3（usePusherEvent→invalidate）                                            |                               |
| 孤儿状态出现                    | Task 1（getComments 触发 detectAndFlagOrphans）                                | UI 在 Plan #4 已就绪          |
| @通知                           | ❌ → Plan #6                                                                   |                               |
| i18n 全量                       | ❌ → Plan #7                                                                   |                               |
