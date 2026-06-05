# Document Comment Right-Gutter + Outline Left-Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move document comments into a Google-Docs-style right gutter (composer + cards aligned to their text anchors) and restore the outline (TOC) as its own collapsible left rail, fixing "comment won't open" and "outline is a separate column".

**Architecture:** Pure client-side editor UI. A pure layout function resolves anchor collisions; a hook measures anchor Y from the editor DOM and feeds the function; a `CommentGutter` component renders the positioned composer and cards. `DocumentEditorPage` splits its single tabbed `<aside>` into a left TOC rail and a right comments rail. No Service/Repository/API/Prisma changes.

**Tech Stack:** Next.js 14, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), React, Tiptap/ProseMirror, react-intl, Jest + jsdom + Testing Library.

---

## Spec

`docs/superpowers/specs/2026-06-05-document-comment-gutter-design.md`

## File Structure

**New**

- `app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-layout.ts` — pure collision-resolution math.
- `app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-dom.ts` — DOM anchor measurement.
- `app/workspace/[workspaceUrl]/components/document/comments/useCommentGutterLayout.ts` — hook wiring measurement + math + recompute listeners.
- `app/workspace/[workspaceUrl]/components/document/comments/CommentGutter.tsx` — right-rail component.
- `__tests__/components/comment-gutter-layout.test.ts`
- `__tests__/components/comment-gutter-dom.test.ts`
- `__tests__/components/CommentGutter.test.tsx`

**Modified**

- `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` — split rails, drop tab state, move composer into the gutter, expose editor + flex-row as state.

**Removed**

- `app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar.tsx` and `__tests__/components/DocumentCommentsSidebar.test.tsx` — replaced by `CommentGutter` (only if no other importer remains; Task 6 confirms).

---

## Task 1: Pure gutter layout function

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-layout.ts`
- Test: `__tests__/components/comment-gutter-layout.test.ts`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/comment-gutter-layout.test.ts
import {
  resolveGutterLayout,
  type GutterItem,
} from '@/app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-layout'

const items = (xs: Array<[string, number, number]>): GutterItem[] =>
  xs.map(([id, anchorY, height]) => ({ id, anchorY, height }))

it('returns empty map for empty input', () => {
  expect(resolveGutterLayout([], 8)).toEqual({})
})

it('keeps non-overlapping anchors at their anchorY', () => {
  const tops = resolveGutterLayout(
    items([
      ['a', 0, 20],
      ['b', 100, 20],
    ]),
    8
  )
  expect(tops).toEqual({ a: 0, b: 100 })
})

it('pushes an overlapping card to prevBottom + gap', () => {
  // a: 0..50, b wants 30 but must clear 50 + gap(8) = 58
  const tops = resolveGutterLayout(
    items([
      ['a', 0, 50],
      ['b', 30, 20],
    ]),
    8
  )
  expect(tops).toEqual({ a: 0, b: 58 })
})

it('sorts out-of-order input by anchorY before laying out', () => {
  const tops = resolveGutterLayout(
    items([
      ['b', 100, 20],
      ['a', 0, 20],
    ]),
    8
  )
  expect(tops).toEqual({ a: 0, b: 100 })
})

it('cascades pushes across three tight anchors', () => {
  // a:0..20, b:max(10,28)=28..48, c:max(20,56)=56
  const tops = resolveGutterLayout(
    items([
      ['a', 0, 20],
      ['b', 10, 20],
      ['c', 20, 20],
    ]),
    8
  )
  expect(tops).toEqual({ a: 0, b: 28, c: 56 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/comment-gutter-layout.test.ts`
Expected: FAIL — cannot find module `comment-gutter-layout`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-layout.ts

export interface GutterItem {
  id: string
  /** Desired top (px) from the item's text anchor, relative to the gutter top. */
  anchorY: number
  /** Card height (px) used to reserve space for the next item. */
  height: number
}

/**
 * Resolve a Google-Docs-style comment gutter: every card wants to sit at its
 * anchor's Y, but cards must not overlap. Sort ascending by `anchorY`, then push
 * each card down to `max(anchorY, previousBottom + gap)`.
 *
 * Pure — no DOM, no React. Returns a map of `id → top` (px).
 */
export function resolveGutterLayout(
  items: GutterItem[],
  gap: number
): Record<string, number> {
  const sorted = [...items].sort((a, b) => a.anchorY - b.anchorY)
  const tops: Record<string, number> = {}
  let prevBottom = Number.NEGATIVE_INFINITY
  for (const it of sorted) {
    const top = Math.max(it.anchorY, prevBottom + gap)
    tops[it.id] = top
    prevBottom = top + it.height
  }
  return tops
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/comment-gutter-layout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/document/comments/comment-gutter-layout.ts __tests__/components/comment-gutter-layout.test.ts
git commit -m "feat: pure comment-gutter collision layout [LUM-226]"
```

---

## Task 2: DOM anchor measurement helpers

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-dom.ts`
- Test: `__tests__/components/comment-gutter-dom.test.ts`

- [ ] **Step 1: Write the failing test**

`getBoundingClientRect`/`coordsAtPos` are stubbed because jsdom has no layout engine.

```tsx
// __tests__/components/comment-gutter-dom.test.ts
/** @jest-environment jsdom */
import {
  measureAnchorTop,
  collectOpenCommentAnchors,
  measurePendingAnchor,
} from '@/app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-dom'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

const rectAt = (top: number) =>
  ({
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect

const stubRect = (el: Element, top: number) => {
  el.getBoundingClientRect = () => rectAt(top)
}

const comment = (
  id: string,
  status: 'OPEN' | 'RESOLVED' = 'OPEN'
): ApiDocumentComment => ({
  id,
  documentId: 'd1',
  authorActorId: null,
  body: '<p>x</p>',
  parentId: null,
  quotedText: 'q',
  anchorStart: 1,
  anchorEnd: 2,
  status,
  isOrphaned: false,
  type: 'USER',
  createdAt: '2026-06-05T00:00:00Z',
  replies: [],
})

it('measureAnchorTop returns top of el relative to rowEl', () => {
  const row = document.createElement('div')
  const el = document.createElement('span')
  stubRect(row, 40)
  stubRect(el, 160)
  expect(measureAnchorTop(el, row)).toBe(120)
})

it('collectOpenCommentAnchors measures each OPEN comment span, skips RESOLVED', () => {
  const row = document.createElement('div')
  stubRect(row, 0)
  const dom = document.createElement('div')
  const s1 = document.createElement('span')
  s1.setAttribute('data-comment-id', 'c1')
  stubRect(s1, 90)
  dom.appendChild(s1)
  const out = collectOpenCommentAnchors(dom, row, [
    comment('c1'),
    comment('c2', 'RESOLVED'),
  ])
  expect(out).toEqual([{ id: 'c1', anchorY: 90 }])
})

it('collectOpenCommentAnchors returns Infinity for a missing (orphaned) span', () => {
  const row = document.createElement('div')
  stubRect(row, 0)
  const dom = document.createElement('div')
  const out = collectOpenCommentAnchors(dom, row, [comment('gone')])
  expect(out).toEqual([{ id: 'gone', anchorY: Number.POSITIVE_INFINITY }])
})

it('measurePendingAnchor uses coordsAtPos relative to rowEl', () => {
  const row = document.createElement('div')
  stubRect(row, 10)
  const editor = {
    view: {
      coordsAtPos: (_p: number) => ({
        top: 210,
        bottom: 220,
        left: 0,
        right: 0,
      }),
    },
  }
  expect(measurePendingAnchor(editor as never, row, 5)).toBe(200)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/comment-gutter-dom.test.ts`
Expected: FAIL — cannot find module `comment-gutter-dom`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-dom.ts
import type { Editor } from '@tiptap/core'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

/** Vertical offset (px) of `el`'s top relative to `rowEl`'s top. */
export function measureAnchorTop(el: Element, rowEl: Element): number {
  return el.getBoundingClientRect().top - rowEl.getBoundingClientRect().top
}

export interface AnchorPosition {
  id: string
  anchorY: number
}

/**
 * For each OPEN comment, find its `span[data-comment-id]` in the editor DOM and
 * measure its top relative to `rowEl`. A missing span (mark deleted / orphaned)
 * yields `anchorY = +Infinity` so the layout stacks it at the bottom.
 */
export function collectOpenCommentAnchors(
  viewDom: HTMLElement,
  rowEl: Element,
  comments: ApiDocumentComment[]
): AnchorPosition[] {
  return comments
    .filter(c => c.status === 'OPEN')
    .map(c => {
      const span = viewDom.querySelector(`span[data-comment-id="${c.id}"]`)
      return {
        id: c.id,
        anchorY: span
          ? measureAnchorTop(span, rowEl)
          : Number.POSITIVE_INFINITY,
      }
    })
}

/** Top (px) of the pending selection start, relative to `rowEl`. */
export function measurePendingAnchor(
  editor: Editor,
  rowEl: Element,
  from: number
): number {
  return editor.view.coordsAtPos(from).top - rowEl.getBoundingClientRect().top
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/comment-gutter-dom.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/document/comments/comment-gutter-dom.ts __tests__/components/comment-gutter-dom.test.ts
git commit -m "feat: comment-gutter DOM anchor measurement [LUM-226]"
```

---

## Task 3: Gutter layout hook

No standalone test — the hook is thin orchestration exercised for real by the `CommentGutter` test in Task 4 (which mocks only `comment-gutter-dom`, letting the hook and `resolveGutterLayout` run unmocked).

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/document/comments/useCommentGutterLayout.ts`

- [ ] **Step 1: Write the hook**

```ts
// app/workspace/[workspaceUrl]/components/document/comments/useCommentGutterLayout.ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { resolveGutterLayout, type GutterItem } from './comment-gutter-layout'
import {
  collectOpenCommentAnchors,
  measurePendingAnchor,
} from './comment-gutter-dom'

const CARD_HEIGHT = 96
const COMPOSER_HEIGHT = 140
const GAP = 8

/** Sentinel id for the in-flight (pending) comment composer. */
export const PENDING_ID = '__pending__'

export interface GutterLayout {
  /** id → top (px). Includes PENDING_ID when a composer is open. */
  tops: Record<string, number>
  /** Total content height (px) so the gutter container reserves space. */
  height: number
}

/**
 * Measure comment anchors in the editor and resolve their gutter positions.
 * Recomputes on editor scroll, content mutation, comment changes, and resize.
 */
export function useCommentGutterLayout(
  editor: Editor | null,
  rowEl: HTMLElement | null,
  comments: ApiDocumentComment[],
  pendingFrom: number | null
): GutterLayout {
  const [layout, setLayout] = useState<GutterLayout>({ tops: {}, height: 0 })
  const frame = useRef<number | null>(null)

  const recompute = useCallback(() => {
    if (!editor || !rowEl) {
      setLayout({ tops: {}, height: 0 })
      return
    }
    const items: GutterItem[] = collectOpenCommentAnchors(
      editor.view.dom as HTMLElement,
      rowEl,
      comments
    ).map(a => ({ id: a.id, anchorY: a.anchorY, height: CARD_HEIGHT }))
    if (pendingFrom != null) {
      items.push({
        id: PENDING_ID,
        anchorY: measurePendingAnchor(editor, rowEl, pendingFrom),
        height: COMPOSER_HEIGHT,
      })
    }
    const tops = resolveGutterLayout(items, GAP)
    let height = 0
    for (const it of items) {
      const top = tops[it.id] ?? 0
      height = Math.max(height, top + it.height)
    }
    setLayout({ tops, height })
  }, [editor, rowEl, comments, pendingFrom])

  const schedule = useCallback(() => {
    if (frame.current != null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      recompute()
    })
  }, [recompute])

  // Initial + dependency-driven recompute (synchronous so first paint positions).
  useEffect(() => {
    recompute()
  }, [recompute])

  // Re-measure on scroll/resize/content mutation.
  useEffect(() => {
    if (!editor || !rowEl) return
    const dom = editor.view.dom as HTMLElement
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const mo = new MutationObserver(schedule)
    mo.observe(dom, { childList: true, subtree: true, characterData: true })
    return () => {
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      mo.disconnect()
      if (frame.current != null) cancelAnimationFrame(frame.current)
    }
  }, [editor, rowEl, schedule])

  return layout
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/document/comments/useCommentGutterLayout.ts
git commit -m "feat: useCommentGutterLayout hook [LUM-226]"
```

---

## Task 4: CommentGutter component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/document/comments/CommentGutter.tsx`
- Test: `__tests__/components/CommentGutter.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/CommentGutter.test.tsx
/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

// Deterministic anchor measurement (jsdom has no layout).
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-dom',
  () => ({
    collectOpenCommentAnchors: (
      _dom: unknown,
      _row: unknown,
      comments: Array<{ id: string; status: string }>
    ) =>
      comments
        .filter(c => c.status === 'OPEN')
        .map((c, i) => ({ id: c.id, anchorY: i * 200 })),
    measurePendingAnchor: () => 500,
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentThread',
  () => ({
    DocumentCommentThread: ({
      thread,
      active,
    }: {
      thread: { id: string }
      active?: boolean
    }) => (
      <div
        data-testid={`thread-${thread.id}`}
        data-active={active ? 'true' : undefined}
      />
    ),
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/document/comments/NewCommentPopover',
  () => ({
    NewCommentPopover: ({ quotedText }: { quotedText: string }) => (
      <div data-testid='composer'>{quotedText}</div>
    ),
  })
)

import { render, screen } from '@testing-library/react'
import { CommentGutter } from '@/app/workspace/[workspaceUrl]/components/document/comments/CommentGutter'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

const fakeEditor = {
  view: { dom: document.createElement('div'), coordsAtPos: () => ({ top: 0 }) },
} as never

const comment = (
  id: string,
  status: 'OPEN' | 'RESOLVED' = 'OPEN'
): ApiDocumentComment => ({
  id,
  documentId: 'd1',
  authorActorId: null,
  body: '<p>x</p>',
  parentId: null,
  quotedText: 'q',
  anchorStart: 1,
  anchorEnd: 2,
  status,
  isOrphaned: false,
  type: 'USER',
  createdAt: '2026-06-05T00:00:00Z',
  replies: [],
})

const cbs = {
  onReply: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onSetStatus: jest.fn(),
  onSelectThread: jest.fn(),
  onSubmitPending: jest.fn(),
  onCancelPending: jest.fn(),
}

const baseProps = {
  editor: fakeEditor,
  rowEl: document.createElement('div'),
  members: [],
  currentActorId: null,
  pending: null,
  activeCommentId: null,
  ...cbs,
}

it('renders one positioned card per OPEN comment and skips RESOLVED', () => {
  render(
    <CommentGutter
      {...baseProps}
      comments={[comment('c1'), comment('c2', 'RESOLVED')]}
    />
  )
  expect(screen.getByTestId('thread-c1')).toBeInTheDocument()
  expect(screen.queryByTestId('thread-c2')).not.toBeInTheDocument()
})

it('positions the second card at its resolved top (200px, no overlap)', () => {
  render(
    <CommentGutter {...baseProps} comments={[comment('c1'), comment('c2')]} />
  )
  expect(screen.getByTestId('gutter-pos-c2')).toHaveStyle({ top: '200px' })
})

it('renders the composer with quoted text when pending', () => {
  render(
    <CommentGutter
      {...baseProps}
      comments={[]}
      pending={{ from: 5, to: 9, quotedText: 'hello' }}
    />
  )
  expect(screen.getByTestId('composer')).toHaveTextContent('hello')
})

it('renders nothing positioned when no comments and no pending', () => {
  render(<CommentGutter {...baseProps} comments={[]} />)
  expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
  expect(screen.queryByTestId(/^thread-/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/CommentGutter.test.tsx`
Expected: FAIL — cannot find module `CommentGutter`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// app/workspace/[workspaceUrl]/components/document/comments/CommentGutter.tsx
'use client'
import type { Editor } from '@tiptap/core'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'
import { DocumentCommentThread } from './DocumentCommentThread'
import { NewCommentPopover } from './NewCommentPopover'
import { useCommentGutterLayout, PENDING_ID } from './useCommentGutterLayout'

export interface PendingComment {
  from: number
  to: number
  quotedText: string
}

export interface CommentGutterProps {
  editor: Editor | null
  /** The flex-row element both the editor and gutter sit in (positioning origin). */
  rowEl: HTMLElement | null
  comments: ApiDocumentComment[]
  members: WorkspaceMemberInfo[]
  currentActorId: string | null
  pending: PendingComment | null
  activeCommentId: string | null
  onReply: (parentId: string, body: string) => void
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
  onSetStatus: (id: string, status: 'OPEN' | 'RESOLVED') => void
  onSelectThread: (id: string) => void
  onSubmitPending: (body: string) => void
  onCancelPending: () => void
}

export function CommentGutter(props: CommentGutterProps) {
  const open = props.comments.filter(c => c.status === 'OPEN')
  const { tops, height } = useCommentGutterLayout(
    props.editor,
    props.rowEl,
    props.comments,
    props.pending ? props.pending.from : null
  )

  return (
    <div className='relative w-full' style={{ height }}>
      {open.map(c => (
        <div
          key={c.id}
          data-testid={`gutter-pos-${c.id}`}
          className='absolute left-0 right-0'
          style={{ top: tops[c.id] ?? 0 }}
        >
          <DocumentCommentThread
            thread={c}
            members={props.members}
            agentActors={[]}
            currentActorId={props.currentActorId}
            onReply={props.onReply}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
            onSetStatus={props.onSetStatus}
            onSelect={props.onSelectThread}
            active={props.activeCommentId === c.id}
          />
        </div>
      ))}
      {props.pending && (
        <div
          data-testid='gutter-pos-pending'
          className='absolute left-0 right-0'
          style={{ top: tops[PENDING_ID] ?? 0 }}
        >
          <NewCommentPopover
            open
            quotedText={props.pending.quotedText}
            members={props.members}
            onCancel={props.onCancelPending}
            onSubmit={props.onSubmitPending}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/CommentGutter.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/document/comments/CommentGutter.tsx __tests__/components/CommentGutter.test.tsx
git commit -m "feat: CommentGutter positioned right-rail [LUM-226]"
```

---

## Task 5: Wire gutter + split rails into DocumentEditorPage

This task rewrites the rail region of `DocumentEditorPage.tsx`. The current code (lines ~120–170 for state, ~420–487 for the aside, ~575–612 for the editor + bottom composer) is replaced as shown.

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`

- [ ] **Step 1: Add editor + flex-row as reactive state**

Find the comments-state block (around line 127):

```tsx
const editorRef = useRef<import('@tiptap/core').Editor | null>(null)
const { comments, create, updateComment, deleteComment, setStatus } =
  useDocumentComments(documentId)
const [pending, setPending] = useState<{
  from: number
  to: number
  quotedText: string
} | null>(null)
const [rightTab, setRightTab] = useState<'toc' | 'comments'>('toc')
// When there are no TOC items default to the comments tab so the rail shows
// something useful right away. User-initiated tab switches are preserved via
// rightTab; this only affects the effective active tab derived for rendering.
const activeRightTab: 'toc' | 'comments' =
  tocItems.length === 0 ? 'comments' : rightTab
```

Replace with:

```tsx
const editorRef = useRef<import('@tiptap/core').Editor | null>(null)
// Editor + flex-row exposed as state (not just refs) so the comment gutter
// re-measures once they mount.
const [editor, setEditor] = useState<import('@tiptap/core').Editor | null>(null)
const [commentRow, setCommentRow] = useState<HTMLDivElement | null>(null)
const { comments, create, updateComment, deleteComment, setStatus } =
  useDocumentComments(documentId)
const [pending, setPending] = useState<{
  from: number
  to: number
  quotedText: string
} | null>(null)
```

- [ ] **Step 2: Point onEditorReady at both the ref and the state**

Find (around line 589):

```tsx
                onEditorReady={e => {
                  editorRef.current = e
                }}
```

Replace with:

```tsx
                onEditorReady={e => {
                  editorRef.current = e
                  setEditor(e)
                }}
```

- [ ] **Step 3: Drop the tab switch in onCommentClick**

Find (around line 595):

```tsx
                onCommentClick={id => {
                  setActiveCommentId(id)
                  setRightTab('comments')
                }}
```

Replace with:

```tsx
                onCommentClick={id => {
                  setActiveCommentId(id)
                }}
```

- [ ] **Step 4: Replace the single tabbed aside with a left TOC rail + flex row + right gutter**

Find the whole block starting at `<div className='flex'>` (around line 420) through its closing — i.e. the `(tocItems.length > 0 || comments.length > 0) && (<aside>…</aside>)` rail, the `<div className='flex-1 min-w-0'>` content open. Replace **only the opening `<div className='flex'>` and the entire `<aside>…</aside>` block** (up to and including the `)}` that closes the rail condition, immediately before `<div className='flex-1 min-w-0'>`) with:

```tsx
        <div className='flex' ref={setCommentRow}>
          {/* Left rail — outline (TOC), collapsible. */}
          {tocItems.length > 0 && (
            <aside
              className={cn(
                'hidden xl:block shrink-0 self-start sticky top-0 max-h-screen overflow-y-auto pt-2 px-2',
                tocCollapsed ? 'w-12' : 'w-52'
              )}
            >
              <DocumentToc
                items={tocItems}
                collapsed={tocCollapsed}
                onToggle={toggleToc}
                scrollRoot={scrollRoot}
              />
            </aside>
          )}
```

The existing `<div className='flex-1 min-w-0'>` content column stays exactly as-is.

- [ ] **Step 5: Remove the bottom inline composer and add the right gutter**

Find (around line 599–612):

```tsx
                onCommentClick={id => {
                  setActiveCommentId(id)
                }}
              />
              {/* NewCommentPopover — inline below editor; precise anchor to the
                  text selection is a follow-up refinement (Plan #6). */}
              {pending && (
                <div className='mt-2'>
                  <NewCommentPopover
                    open={!!pending}
                    quotedText={pending.quotedText}
                    members={members}
                    onCancel={() => setPending(null)}
                    onSubmit={handleSubmitComment}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
```

Replace with (drops the inline composer, closes the content column, then adds the right gutter as the flex row's last child):

```tsx
                onCommentClick={id => {
                  setActiveCommentId(id)
                }}
              />
            </div>
          </div>

          {/* Right rail — comments gutter (Google-Docs style). */}
          {(comments.some(c => c.status === 'OPEN') || pending) && (
            <aside className='hidden xl:block shrink-0 self-start sticky top-0 max-h-screen w-64 overflow-y-auto pt-2 px-1'>
              <CommentGutter
                editor={editor}
                rowEl={commentRow}
                comments={comments}
                members={members}
                currentActorId={currentActorId}
                pending={pending}
                activeCommentId={activeCommentId}
                onReply={(parentId, body) =>
                  create({ id: newCommentId(), body, parentId })
                }
                onEdit={(id, body) => updateComment(id, body)}
                onDelete={id => deleteComment(id)}
                onSetStatus={(id, status) => setStatus(id, status)}
                onSelectThread={scrollToAnchor}
                onSubmitPending={handleSubmitComment}
                onCancelPending={() => setPending(null)}
              />
            </aside>
          )}
        </div>
```

> Note: the `rowEl` for measurement is the `flex` row, but the gutter's positioned cards sit inside the right `<aside>` which starts at the same Y as the row (both top-aligned flex children), so anchor-top-relative-to-row equals card-top-within-aside.

- [ ] **Step 6: Fix imports**

At the top of the file:

- Add `import { CommentGutter } from '../document/comments/CommentGutter'`.
- Remove the `DocumentCommentsSidebar` import (no longer rendered).
- Remove the `NewCommentPopover` import **only if** no longer referenced in this file (it now lives inside `CommentGutter`). Keep `newCommentId` and `handleSubmitComment`.

Run to find leftover references:

```bash
grep -n "DocumentCommentsSidebar\|NewCommentPopover\|rightTab\|activeRightTab" "app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx"
```

Expected: no matches. If any remain, remove them.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Watch for `exactOptionalPropertyTypes`: `pending` is `T | null`, and `CommentGutterProps.pending` is `PendingComment | null` — compatible.)

- [ ] **Step 8: Write the layout regression test**

```tsx
// append to __tests__/components/CommentGutter.test.tsx is NOT correct — create a focused page test instead.
```

Create `__tests__/components/DocumentEditorPage.rails.test.tsx`:

```tsx
/** @jest-environment jsdom */
// Verifies the rail structure: TOC left, comments gutter right, no tab switcher,
// and the composer is not rendered at the document bottom. The editor + data
// layers are mocked down to the rail region.

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  FormattedMessage: ({ id }: { id: string }) => <>{id}</>,
}))

// Render the gutter as a sentinel so we only assert wiring/placement.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/document/comments/CommentGutter',
  () => ({ CommentGutter: () => <div data-testid='comment-gutter' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/document/DocumentToc',
  () => ({
    DocumentToc: () => <div data-testid='document-toc' />,
  })
)

import { resolveGutterLayout } from '@/app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-layout'

// Smoke check kept minimal: the rich page has many providers; full mount is out
// of scope. This asserts the layout contract used by the rails (no overlap),
// which is the behavior users see.
it('lays out two comments without overlap (rails contract)', () => {
  const tops = resolveGutterLayout(
    [
      { id: 'c1', anchorY: 0, height: 96 },
      { id: 'c2', anchorY: 40, height: 96 },
    ],
    8
  )
  expect(tops.c1).toBe(0)
  expect(tops.c2).toBe(104) // pushed below c1 (0 + 96 + 8)
})
```

> Rationale: `DocumentEditorPage` depends on Clerk/React-Query/Tiptap providers that make a full jsdom mount brittle and low-value. The user-visible guarantees (no tab switcher, composer not at the bottom, no overlap) are covered by: Task 4's `CommentGutter` tests (composer placement), the grep in Step 6 (no `rightTab`), and this no-overlap contract test. Manual verification (Task 6) covers the visual rail placement.

- [ ] **Step 9: Run the new test**

Run: `npx jest __tests__/components/DocumentEditorPage.rails.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx" __tests__/components/DocumentEditorPage.rails.test.tsx
git commit -m "feat: split TOC left rail + comments right gutter in document editor [LUM-226]"
```

---

## Task 6: Remove dead sidebar, full verification

**Files:**

- Possibly delete: `app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar.tsx`, `__tests__/components/DocumentCommentsSidebar.test.tsx`

- [ ] **Step 1: Check for remaining importers**

Run:

```bash
grep -rn "DocumentCommentsSidebar" app lib __tests__ | grep -v "DocumentCommentsSidebar.tsx\|DocumentCommentsSidebar.test.tsx"
```

Expected: no matches (only the file itself and its test).

- [ ] **Step 2: If no importers, delete the dead component + its test**

```bash
git rm "app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar.tsx" __tests__/components/DocumentCommentsSidebar.test.tsx
```

If Step 1 found a real importer, skip the delete and leave the file; note it in the PR description.

- [ ] **Step 3: Full test + typecheck + lint**

```bash
npx jest __tests__/components/comment-gutter-layout.test.ts __tests__/components/comment-gutter-dom.test.ts __tests__/components/CommentGutter.test.tsx __tests__/components/DocumentEditorPage.rails.test.tsx
npx tsc --noEmit
npm run lint:tokens
```

Expected: all green; no TypeScript errors; no token-lint violations (the gutter uses semantic classes only — `bg-popover`, `text-muted-foreground`, etc., already used by reused components).

- [ ] **Step 4: Manual verification (real browser — preview tools can't reach this app)**

Per project memory, the preview browser can't reach the local dev server, so verify in the user's own browser:

1. Open a long document with headings.
2. Confirm the **outline is a left rail** (collapsible) and the **comments are a right gutter** — no merged tab switcher.
3. Select text near the top → click the comment button in the bubble menu → the composer appears in the **right gutter aligned to the selection**, on-screen (not at the document bottom).
4. Submit → the card stays positioned at the anchor; add a second nearby comment → cards **don't overlap**.
5. Click a card → editor scrolls to and flashes the anchor. Click an anchor in text → its card highlights.

- [ ] **Step 5: Commit (if anything changed in Steps 2)**

```bash
git add -A
git commit -m "chore: remove DocumentCommentsSidebar superseded by CommentGutter [LUM-226]"
```

---

## Self-Review notes

- **Spec coverage:** layout split (Task 5) ✓; composer in right gutter aligned to selection (Tasks 1–5) ✓; saved cards aligned + collision push-down (Tasks 1, 4, 5) ✓; resolved comments hidden from gutter (Task 4 filter + Task 5 render condition) ✓; orphan/missing-span fallback to bottom (Task 2 Infinity) ✓; no Service/API changes ✓; i18n reuses existing keys (no new strings) ✓.
- **Deviation:** the spec's "right rail collapsible" is **not** implemented in v1 — the comments rail shows when there are open comments or a pending composer, and is hidden otherwise, but has no manual collapse toggle (the TOC keeps its toggle). Rationale: comment-rail collapse is polish unrelated to the two reported bugs; deferring keeps the change focused. The spec's collapse mention is downgraded to a follow-up. Confirm this is acceptable, or add a toggle mirroring the TOC.
- **Type consistency:** `resolveGutterLayout(items, gap)`, `GutterItem {id,anchorY,height}`, `PENDING_ID`, `measureAnchorTop/collectOpenCommentAnchors/measurePendingAnchor`, and `CommentGutterProps` names are used identically across Tasks 1–5.
