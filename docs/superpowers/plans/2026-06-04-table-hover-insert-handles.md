# 表格 hover 边缘就地插入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Tiptap 表格 hover 行/列边缘时,就地出 `+` 句柄,在精确边界插入行/列(Notion 风格)。

**Architecture:** React DOM 浮层 + `editor.view.posAtCoords`。一个纯几何函数解析「鼠标坐标 → 插入目标」,一个纯命令函数把目标派发成 stock Tiptap 表格命令,一个 hook 做 DOM 测量 + 状态编排,一个表现组件渲染 `+` 钮与定位线。不引入 ProseMirror 插件、不重写 NodeView。bubble 菜单插入/删除按钮原样保留。

**Tech Stack:** Next.js 14 / TypeScript(strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`)、Tiptap 3.22、react-intl、Jest(jsdom)、Tailwind + 语义 CSS token。

---

## File Structure

| 文件                                                                           | 职责                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `lib/editor/table/resolve-insert-target.ts`(新建)                              | 纯几何函数:坐标 + 边界数组 → `InsertTarget \| null`               |
| `lib/editor/table/insert-command.ts`(新建)                                     | `InsertMarker` 类型 + `runTableInsert(editor, marker)` 纯命令派发 |
| `app/workspace/[workspaceUrl]/components/table/useTableInsertHandles.ts`(新建) | hook:DOM 测量 + marker 状态 + onInsert                            |
| `app/workspace/[workspaceUrl]/components/table/TableInsertHandles.tsx`(新建)   | 表现层:渲染 `+` 钮 + 定位线                                       |
| `lib/i18n/*.json`(改 16 个)                                                    | 新增 `table.insertColumnHere` / `table.insertRowHere`             |
| `app/globals.css`(改)                                                          | `.table-insert-handle` / `.table-insert-line` 样式                |
| `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`(改)            | 在 editable 时挂载组件                                            |
| `__tests__/lib/editor/resolve-insert-target.test.ts`(新建)                     | 纯函数单测                                                        |
| `__tests__/lib/editor/table-insert-command.test.ts`(新建)                      | 命令派发单测                                                      |
| `__tests__/components/TableInsertHandles.test.tsx`(新建)                       | 组件单测(mock hook)                                               |

---

## Task 1: 纯几何函数 `resolveInsertTarget`

**Files:**

- Create: `lib/editor/table/resolve-insert-target.ts`
- Test: `__tests__/lib/editor/resolve-insert-target.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/editor/resolve-insert-target.test.ts
import { resolveInsertTarget } from '@/lib/editor/table/resolve-insert-target'

// 3-column / 2-row table. Column boundaries at x = 0,100,200,300.
// Row boundaries at y = 0,40,80. Table spans (0,0)→(300,80).
const tableRect = { left: 0, top: 0, right: 300, bottom: 80 }
const columnBoundaries = [0, 100, 200, 300]
const rowBoundaries = [0, 40, 80]
const base = { tableRect, columnBoundaries, rowBoundaries }

describe('resolveInsertTarget', () => {
  it('returns null when pointer is in the table interior (no edge band)', () => {
    expect(
      resolveInsertTarget({ ...base, pointer: { x: 150, y: 40 } })
    ).toBeNull()
  })

  it('resolves an inner column boundary near the top edge → after previous column', () => {
    // x≈200 (boundary index 2), y at top edge
    expect(resolveInsertTarget({ ...base, pointer: { x: 201, y: 2 } })).toEqual(
      { axis: 'col', side: 'after', anchorIndex: 1, boundaryCoord: 200 }
    )
  })

  it('resolves the outermost-left column boundary → before column 0', () => {
    expect(resolveInsertTarget({ ...base, pointer: { x: 1, y: 2 } })).toEqual({
      axis: 'col',
      side: 'before',
      anchorIndex: 0,
      boundaryCoord: 0,
    })
  })

  it('resolves the outermost-right column boundary → after last column', () => {
    expect(resolveInsertTarget({ ...base, pointer: { x: 299, y: 2 } })).toEqual(
      { axis: 'col', side: 'after', anchorIndex: 2, boundaryCoord: 300 }
    )
  })

  it('resolves a row boundary near the left edge → after previous row', () => {
    // y≈40 (boundary index 1), x at left edge
    expect(resolveInsertTarget({ ...base, pointer: { x: 2, y: 41 } })).toEqual({
      axis: 'row',
      side: 'after',
      anchorIndex: 0,
      boundaryCoord: 40,
    })
  })

  it('returns null when near the top band but not near any column boundary', () => {
    expect(
      resolveInsertTarget({ ...base, pointer: { x: 150, y: 2 } })
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- resolve-insert-target`
Expected: FAIL — `Cannot find module '@/lib/editor/table/resolve-insert-target'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/editor/table/resolve-insert-target.ts
export type InsertAxis = 'row' | 'col'

export interface InsertTarget {
  axis: InsertAxis
  side: 'before' | 'after'
  /** column index (col axis) or row index (row axis) of the cell to anchor the command on */
  anchorIndex: number
  /** viewport x (col) or y (row) of the boundary line, for rendering */
  boundaryCoord: number
}

export interface ResolveInput {
  pointer: { x: number; y: number }
  tableRect: { left: number; top: number; right: number; bottom: number }
  /** ascending x coordinates, length = columnCount + 1 (outer-left … outer-right) */
  columnBoundaries: number[]
  /** ascending y coordinates, length = rowCount + 1 (outer-top … outer-bottom) */
  rowBoundaries: number[]
  /** max distance (px) from a boundary to trigger. Default 6. */
  threshold?: number
  /** how far the edge trigger band extends in/out from the table edge. Default 12. */
  edgeBand?: number
}

/** Index of the boundary within `threshold` of `coord` and closest to it, or -1. */
function nearestBoundaryIndex(
  boundaries: number[],
  coord: number,
  threshold: number
): number {
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i]
    if (b === undefined) continue
    const d = Math.abs(b - coord)
    if (d <= threshold && d < bestDist) {
      best = i
      bestDist = d
    }
  }
  return best
}

/** boundary index k (0…count) → which cell to anchor on and which side to insert. */
function targetFromBoundary(
  axis: InsertAxis,
  k: number,
  boundaries: number[]
): InsertTarget | null {
  const coord = boundaries[k]
  if (coord === undefined) return null
  if (k === 0)
    return { axis, side: 'before', anchorIndex: 0, boundaryCoord: coord }
  // any other boundary == "after the column/row to its left"
  return { axis, side: 'after', anchorIndex: k - 1, boundaryCoord: coord }
}

export function resolveInsertTarget(input: ResolveInput): InsertTarget | null {
  const threshold = input.threshold ?? 6
  const edgeBand = input.edgeBand ?? 12
  const { pointer, tableRect, columnBoundaries, rowBoundaries } = input

  // Column insert: pointer hugging the table's top edge.
  if (
    pointer.y >= tableRect.top - edgeBand &&
    pointer.y <= tableRect.top + edgeBand
  ) {
    const k = nearestBoundaryIndex(columnBoundaries, pointer.x, threshold)
    if (k !== -1) return targetFromBoundary('col', k, columnBoundaries)
  }

  // Row insert: pointer hugging the table's left edge.
  if (
    pointer.x >= tableRect.left - edgeBand &&
    pointer.x <= tableRect.left + edgeBand
  ) {
    const k = nearestBoundaryIndex(rowBoundaries, pointer.y, threshold)
    if (k !== -1) return targetFromBoundary('row', k, rowBoundaries)
  }

  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- resolve-insert-target`
Expected: PASS (6 passing)

- [ ] **Step 5: Commit**

```bash
git add lib/editor/table/resolve-insert-target.ts __tests__/lib/editor/resolve-insert-target.test.ts
git commit -m "feat: pure geometry resolver for table insert handles [LUM-218]"
```

---

## Task 2: 命令派发 `runTableInsert`

**Files:**

- Create: `lib/editor/table/insert-command.ts`
- Test: `__tests__/lib/editor/table-insert-command.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/editor/table-insert-command.test.ts
import type { Editor } from '@tiptap/core'
import {
  runTableInsert,
  type InsertMarker,
} from '@/lib/editor/table/insert-command'

// chainable stub: every method returns the chain; run() is terminal.
function makeEditor(posResult: { pos: number } | null) {
  const chain: Record<string, jest.Mock> = {}
  for (const m of [
    'focus',
    'setTextSelection',
    'addColumnBefore',
    'addColumnAfter',
    'addRowBefore',
    'addRowAfter',
    'run',
  ]) {
    chain[m] = jest.fn(() => (m === 'run' ? true : chain))
  }
  const editor = {
    chain: () => chain,
    view: { posAtCoords: jest.fn(() => posResult) },
  } as unknown as Editor
  return { editor, chain }
}

const marker = (over: Partial<InsertMarker>): InsertMarker => ({
  axis: 'col',
  side: 'after',
  anchorIndex: 0,
  left: 0,
  top: 0,
  lineLength: 80,
  cellPoint: { x: 50, y: 20 },
  ...over,
})

describe('runTableInsert', () => {
  it('places the selection at the resolved pos then inserts a column after', () => {
    const { editor, chain } = makeEditor({ pos: 7 })
    runTableInsert(editor, marker({ axis: 'col', side: 'after' }))
    expect(editor.view.posAtCoords).toHaveBeenCalledWith({ left: 50, top: 20 })
    expect(chain.setTextSelection).toHaveBeenCalledWith(7)
    expect(chain.addColumnAfter).toHaveBeenCalled()
    expect(chain.run).toHaveBeenCalled()
  })

  it('inserts a row before for a row/before marker', () => {
    const { editor, chain } = makeEditor({ pos: 3 })
    runTableInsert(editor, marker({ axis: 'row', side: 'before' }))
    expect(chain.addRowBefore).toHaveBeenCalled()
    expect(chain.addColumnAfter).not.toHaveBeenCalled()
  })

  it('does nothing when posAtCoords returns null', () => {
    const { editor, chain } = makeEditor(null)
    runTableInsert(editor, marker({}))
    expect(chain.setTextSelection).not.toHaveBeenCalled()
    expect(chain.addColumnAfter).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- table-insert-command`
Expected: FAIL — `Cannot find module '@/lib/editor/table/insert-command'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/editor/table/insert-command.ts
import type { Editor } from '@tiptap/core'
import type { InsertAxis } from './resolve-insert-target'

export interface InsertMarker {
  axis: InsertAxis
  side: 'before' | 'after'
  anchorIndex: number
  /** container-relative px: center of the + button (also the line's anchor end) */
  left: number
  top: number
  /** px length of the positioning line along the table edge */
  lineLength: number
  /** viewport coords of the anchor cell's center, for posAtCoords */
  cellPoint: { x: number; y: number }
}

/**
 * Place the editor selection inside the anchor cell, then run the stock
 * Tiptap insert command for the marker's axis + side. No-op if the cell
 * point can't be mapped to a document position.
 */
export function runTableInsert(editor: Editor, marker: InsertMarker): void {
  const resolved = editor.view.posAtCoords({
    left: marker.cellPoint.x,
    top: marker.cellPoint.y,
  })
  if (!resolved) return

  const chain = editor.chain().focus().setTextSelection(resolved.pos)
  if (marker.axis === 'col') {
    if (marker.side === 'before') chain.addColumnBefore().run()
    else chain.addColumnAfter().run()
  } else {
    if (marker.side === 'before') chain.addRowBefore().run()
    else chain.addRowAfter().run()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- table-insert-command`
Expected: PASS (3 passing)

- [ ] **Step 5: Commit**

```bash
git add lib/editor/table/insert-command.ts __tests__/lib/editor/table-insert-command.test.ts
git commit -m "feat: table insert command dispatcher [LUM-218]"
```

---

## Task 3: i18n keys(全部 16 个 locale)

**Files:**

- Modify: `lib/i18n/en.json`, `en-AU.json`, `en-GB.json`, `de.json`, `es.json`, `es-419.json`, `fr.json`, `hi.json`, `id.json`, `ja.json`, `ko.json`, `ms.json`, `ru.json`, `vi.json`, `zh-CN.json`, `zh-TW.json`

- [ ] **Step 1: Add two keys to every locale file**

Add `"table.insertColumnHere"` and `"table.insertRowHere"` next to the existing `"table.addColRight"` entry in each file. Use these values. **Before saving each non-English file, open it and copy the column/row noun already used in that locale's existing `table.addColLeft` / `table.addRowAbove` so the new strings stay terminologically consistent** (the values below are the expected result; reconcile if a locale already uses a different word).

```jsonc
// en.json / en-AU.json / en-GB.json
"table.insertColumnHere": "Insert column",
"table.insertRowHere": "Insert row",

// de.json
"table.insertColumnHere": "Spalte einfügen",
"table.insertRowHere": "Zeile einfügen",

// es.json / es-419.json
"table.insertColumnHere": "Insertar columna",
"table.insertRowHere": "Insertar fila",

// fr.json
"table.insertColumnHere": "Insérer une colonne",
"table.insertRowHere": "Insérer une ligne",

// hi.json
"table.insertColumnHere": "कॉलम डालें",
"table.insertRowHere": "पंक्ति डालें",

// id.json
"table.insertColumnHere": "Sisipkan kolom",
"table.insertRowHere": "Sisipkan baris",

// ja.json
"table.insertColumnHere": "列を挿入",
"table.insertRowHere": "行を挿入",

// ko.json
"table.insertColumnHere": "열 삽입",
"table.insertRowHere": "행 삽입",

// ms.json
"table.insertColumnHere": "Sisip lajur",
"table.insertRowHere": "Sisip baris",

// ru.json
"table.insertColumnHere": "Вставить столбец",
"table.insertRowHere": "Вставить строку",

// vi.json
"table.insertColumnHere": "Chèn cột",
"table.insertRowHere": "Chèn hàng",

// zh-CN.json
"table.insertColumnHere": "插入列",
"table.insertRowHere": "插入行",

// zh-TW.json
"table.insertColumnHere": "插入欄",
"table.insertRowHere": "插入列",
```

- [ ] **Step 2: Verify every locale has both keys**

Run:

```bash
for f in lib/i18n/*.json; do
  c=$(grep -c 'table.insertColumnHere\|table.insertRowHere' "$f")
  echo "$f: $c"
done
```

Expected: every `.json` prints `2`.

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/*.json
git commit -m "i18n: add table.insertColumnHere/insertRowHere across all locales [LUM-218]"
```

---

## Task 4: hook `useTableInsertHandles`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/table/useTableInsertHandles.ts`

> No unit test for this file: its only logic beyond delegation is live DOM
> geometry (`getBoundingClientRect`/`posAtCoords`), which jsdom returns as zeros
> and cannot exercise. The geometry is tested in Task 1, the command in Task 2,
> and the rendered button + click wiring in Task 5. The hook is thin glue.

- [ ] **Step 1: Write the hook**

```ts
// app/workspace/[workspaceUrl]/components/table/useTableInsertHandles.ts
import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { resolveInsertTarget } from '@/lib/editor/table/resolve-insert-target'
import {
  runTableInsert,
  type InsertMarker,
} from '@/lib/editor/table/insert-command'

/** Measure the hovered table and resolve a marker, or null. */
function computeMarker(
  table: HTMLElement,
  container: HTMLElement,
  clientX: number,
  clientY: number
): InsertMarker | null {
  const firstRow = table.querySelector('tr')
  if (!firstRow) return null
  const headerCells = Array.from(firstRow.children) as HTMLElement[]
  const rows = Array.from(table.querySelectorAll('tr')) as HTMLElement[]
  if (headerCells.length === 0 || rows.length === 0) return null

  const tableRect = table.getBoundingClientRect()

  const columnBoundaries: number[] = [
    headerCells[0]!.getBoundingClientRect().left,
  ]
  for (const c of headerCells)
    columnBoundaries.push(c.getBoundingClientRect().right)

  const rowBoundaries: number[] = [rows[0]!.getBoundingClientRect().top]
  for (const r of rows) rowBoundaries.push(r.getBoundingClientRect().bottom)

  const target = resolveInsertTarget({
    pointer: { x: clientX, y: clientY },
    tableRect,
    columnBoundaries,
    rowBoundaries,
  })
  if (!target) return null

  const containerRect = container.getBoundingClientRect()

  if (target.axis === 'col') {
    const cell = headerCells[target.anchorIndex]
    if (!cell) return null
    const r = cell.getBoundingClientRect()
    return {
      axis: 'col',
      side: target.side,
      anchorIndex: target.anchorIndex,
      left: target.boundaryCoord - containerRect.left,
      top: tableRect.top - containerRect.top,
      lineLength: tableRect.height,
      cellPoint: { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 },
    }
  }

  const row = rows[target.anchorIndex]
  const cell = row?.children[0] as HTMLElement | undefined
  if (!cell) return null
  const r = cell.getBoundingClientRect()
  return {
    axis: 'row',
    side: target.side,
    anchorIndex: target.anchorIndex,
    left: tableRect.left - containerRect.left,
    top: target.boundaryCoord - containerRect.top,
    lineLength: tableRect.width,
    cellPoint: { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 },
  }
}

/**
 * Tracks the hovered table edge and exposes a marker + an insert action.
 * Binds mousemove/leave on the editor DOM; clears the marker on scroll/resize
 * (a stale marker would float away from its boundary — re-derived on next move).
 */
export function useTableInsertHandles(
  editor: Editor | null,
  containerRef: RefObject<HTMLElement | null>
) {
  const [marker, setMarker] = useState<InsertMarker | null>(null)

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom as HTMLElement

    const onMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const table = (e.target as HTMLElement | null)?.closest?.(
        'table'
      ) as HTMLElement | null
      if (!table || !dom.contains(table)) {
        setMarker(null)
        return
      }
      setMarker(computeMarker(table, container, e.clientX, e.clientY))
    }
    const clear = () => setMarker(null)

    dom.addEventListener('mousemove', onMove)
    dom.addEventListener('mouseleave', clear)
    // capture:true catches scrolls on any ancestor scroll container
    window.addEventListener('scroll', clear, true)
    const ro = new ResizeObserver(clear)
    ro.observe(dom)

    return () => {
      dom.removeEventListener('mousemove', onMove)
      dom.removeEventListener('mouseleave', clear)
      window.removeEventListener('scroll', clear, true)
      ro.disconnect()
    }
  }, [editor, containerRef])

  const onInsert = useCallback(() => {
    if (!editor || !marker) return
    runTableInsert(editor, marker)
    setMarker(null)
  }, [editor, marker])

  return { marker, onInsert }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `useTableInsertHandles.ts`.

- [ ] **Step 3: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/table/useTableInsertHandles.ts"
git commit -m "feat: useTableInsertHandles hook for hover-edge measurement [LUM-218]"
```

---

## Task 5: 组件 `TableInsertHandles` + CSS

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/table/TableInsertHandles.tsx`
- Modify: `app/globals.css`
- Test: `__tests__/components/TableInsertHandles.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/TableInsertHandles.test.tsx
/** @jest-environment jsdom */
import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import type { InsertMarker } from '@/lib/editor/table/insert-command'

const messages: Record<string, string> = {
  'table.insertColumnHere': 'Insert column',
  'table.insertRowHere': 'Insert row',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

// Drive the component by controlling the hook's return value.
const onInsert = jest.fn()
let hookMarker: InsertMarker | null = null
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/table/useTableInsertHandles',
  () => ({
    useTableInsertHandles: () => ({ marker: hookMarker, onInsert }),
  })
)

import { TableInsertHandles } from '@/app/workspace/[workspaceUrl]/components/table/TableInsertHandles'

const editor = {} as unknown as Editor
const containerRef = createRef<HTMLElement>()

function renderHandles() {
  return render(
    <TableInsertHandles editor={editor} containerRef={containerRef} />
  )
}

describe('TableInsertHandles', () => {
  beforeEach(() => {
    onInsert.mockClear()
    hookMarker = null
  })

  it('renders nothing when there is no marker', () => {
    const { container } = renderHandles()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an insert-column button and fires onInsert on click', () => {
    hookMarker = {
      axis: 'col',
      side: 'after',
      anchorIndex: 1,
      left: 120,
      top: 0,
      lineLength: 80,
      cellPoint: { x: 50, y: 20 },
    }
    renderHandles()
    const btn = screen.getByRole('button', { name: 'Insert column' })
    fireEvent.click(btn)
    expect(onInsert).toHaveBeenCalledTimes(1)
  })

  it('labels the button as insert-row for a row marker', () => {
    hookMarker = {
      axis: 'row',
      side: 'before',
      anchorIndex: 0,
      left: 0,
      top: 40,
      lineLength: 300,
      cellPoint: { x: 50, y: 20 },
    }
    renderHandles()
    expect(
      screen.getByRole('button', { name: 'Insert row' })
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- TableInsertHandles`
Expected: FAIL — `Cannot find module '.../TableInsertHandles'`

- [ ] **Step 3: Write the component**

```tsx
// app/workspace/[workspaceUrl]/components/table/TableInsertHandles.tsx
'use client'

import { type RefObject } from 'react'
import { useIntl } from 'react-intl'
import { Plus } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { useTableInsertHandles } from './useTableInsertHandles'

interface Props {
  editor: Editor | null
  /** Positioned (relative) container the marker coords are measured against. */
  containerRef: RefObject<HTMLElement | null>
}

export function TableInsertHandles({ editor, containerRef }: Props) {
  const intl = useIntl()
  const { marker, onInsert } = useTableInsertHandles(editor, containerRef)
  if (!marker) return null

  const isCol = marker.axis === 'col'
  const label = intl.formatMessage({
    id: isCol ? 'table.insertColumnHere' : 'table.insertRowHere',
  })

  return (
    <>
      <span
        className='table-insert-line'
        style={
          isCol
            ? {
                left: marker.left,
                top: marker.top,
                width: 2,
                height: marker.lineLength,
                transform: 'translateX(-50%)',
              }
            : {
                left: marker.left,
                top: marker.top,
                width: marker.lineLength,
                height: 2,
                transform: 'translateY(-50%)',
              }
        }
      />
      <button
        type='button'
        className='table-insert-handle'
        style={{ left: marker.left, top: marker.top }}
        aria-label={label}
        onClick={onInsert}
      >
        <Plus size={12} />
      </button>
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- TableInsertHandles`
Expected: PASS (3 passing)

- [ ] **Step 5: Add CSS to `app/globals.css`**

First confirm both tokens exist in the file's `:root` / `.dark` blocks: `grep -n -- '--primary\b\|--primary-foreground' app/globals.css`. `--primary-foreground` drives the `+` icon color (lucide strokes with `currentColor`); if it's absent, use `hsl(var(--background))` instead.

Append after the table block (near the `.column-resize-handle` rule, ~line 212). Use `hsl(var(--primary))` to match the existing token convention used by `.column-resize-handle`:

```css
/* Hover-edge row/column insert handles (LUM-218) */
.table-insert-handle {
  position: absolute;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 9999px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  cursor: pointer;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
}

.table-insert-line {
  position: absolute;
  z-index: 24;
  background: hsl(var(--primary));
  opacity: 0.5;
  pointer-events: none;
}
```

- [ ] **Step 6: Verify CSS tokens pass lint**

Run: `npm run lint:tokens`
Expected: PASS, no new violations. (If it flags `rgb(0 0 0 / 0.25)`, switch the shadow to an existing shadow token or drop the shadow — do NOT add a baseline entry.)

- [ ] **Step 7: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/table/TableInsertHandles.tsx" "__tests__/components/TableInsertHandles.test.tsx" app/globals.css
git commit -m "feat: TableInsertHandles component + insert-handle styles [LUM-218]"
```

---

## Task 6: 接入 DescriptionEditor + 全量验证

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx`

- [ ] **Step 1: Import the component**

Add to the import block (after the `BubbleMenuBar` import at line 37):

```tsx
import { TableInsertHandles } from './table/TableInsertHandles'
```

- [ ] **Step 2: Make the drop-zone a positioned container and mount the handles**

Replace the existing block (lines 499-502):

```tsx
{
  /* Native capture listeners are bound to this div via useEffect above */
}
;<div ref={dropZoneRef}>
  <EditorContent editor={editor} />
</div>
```

with:

```tsx
{
  /* Native capture listeners are bound to this div via useEffect above.
          `relative` so TableInsertHandles can absolutely-position its markers. */
}
;<div ref={dropZoneRef} className='relative'>
  <EditorContent editor={editor} />
  {editor && editor.isEditable && (
    <TableInsertHandles editor={editor} containerRef={dropZoneRef} />
  )}
</div>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`dropZoneRef` is `RefObject<HTMLDivElement>`, assignable to the prop's `RefObject<HTMLElement | null>`.)

- [ ] **Step 4: Run the full test suite for touched areas**

Run: `npm test -- resolve-insert-target table-insert-command TableInsertHandles BubbleMenuBarTable`
Expected: all PASS. (BubbleMenuBarTable confirms the existing table toolbar is untouched.)

- [ ] **Step 5: Token lint + full typecheck once more**

Run: `npm run lint:tokens && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/DescriptionEditor.tsx"
git commit -m "feat: mount table insert handles in editor when editable [LUM-218]"
```

---

## Verification Summary (run before opening PR)

- [ ] `npx tsc --noEmit` — clean (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)
- [ ] `npm test -- resolve-insert-target table-insert-command TableInsertHandles BubbleMenuBarTable` — all pass
- [ ] `npm run lint:tokens` — no new violations
- [ ] No `console.log`; named exports only; react-intl for all strings; all 16 locales have both new keys
- [ ] No Prisma/schema/DB migration touched (pure frontend) — PR description notes "no migration required"
- [ ] Branch `lumo/LUM-218-table-hover-insert-handles`; PR title `feat: hover-edge row/column insert handles for tables [LUM-218]`
- [ ] `cli/src/commands/` untouched → no SKILL.md update needed
- [ ] Manual smoke (dev server): hover a table's top edge near a column gap → blue line + `+` appears → click inserts a column at that boundary; same for row at the left edge; read-only doc shows no handles; bubble-menu insert/delete buttons still work

```

```
