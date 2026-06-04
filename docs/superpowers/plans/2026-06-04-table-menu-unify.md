# Table Menu Unify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make table operations reachable regardless of text selection by collapsing the two selection-keyed table toolbars into one stable in-table bar, and wire up Tiptap's `toggleHeaderRow` / `mergeCells` / `splitCell`.

**Architecture:** Replace the two mutually-exclusive `isTable` render branches in `BubbleMenuBar.tsx` with a single `if (state.isTable)` branch that always shows text formatting plus two new self-contained dropdown components — `AlignMenu` (collapses the 3 align buttons) and `TableActionsMenu` (all structural ops + the two-step delete-table confirm). Selection only toggles the enabled state of merge/split items.

**Tech Stack:** Next.js 14, React, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Tiptap, lucide-react 1.17.0, react-intl, Tailwind + shadcn semantic tokens, Jest + Testing Library (jsdom).

**Working directory:** All commands run from the worktree `.worktrees/LUM-217-table-menu-unify` (jest must run with cwd inside the worktree — see project memory on haste collisions). Prefix shell with `cd .worktrees/LUM-217-table-menu-unify &&`.

---

## File Structure

- `app/workspace/[workspaceUrl]/components/bubble-menu/AlignMenu.tsx` — **new**. Self-contained alignment dropdown. Owns its open state + outside-click. Props: `{ editor, alignLeft, alignCenter, alignRight }`.
- `app/workspace/[workspaceUrl]/components/bubble-menu/TableActionsMenu.tsx` — **new**. Self-contained table-ops dropdown. Owns open state, outside-click, and the two-step delete-table confirm (state + timer). Props: `{ editor, canMergeCells, canSplitCell }`.
- `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx` — **modify**. Merge the two table branches into one; add `canMergeCells`/`canSplitCell` to the `useEditorState` selector; render `<AlignMenu>` + `<TableActionsMenu>`; remove the now-moved delete-confirm state/handler/timer; move the `linkOpen` branch above the table branch.
- `__tests__/components/AlignMenu.test.tsx` — **new**. Unit tests for AlignMenu.
- `__tests__/components/TableActionsMenu.test.tsx` — **new**. Unit tests for TableActionsMenu (open, merge/split disabled, delete two-step confirm).
- `__tests__/components/BubbleMenuBarTable.test.tsx` — **modify**. Replace the flat-7-button assertions with the unified-bar / not-shape-shifting integration tests.
- `lib/i18n/*.json` × 16 — **modify**. Add 5 keys to every locale.

> The existing `正文▾` (text-style) and `列表▾` (list) dropdowns stay inline in `BubbleMenuBar`; they are out of scope. The two new dropdowns reuse the same hand-rolled toggle pattern (mousedown → React state), which works in jsdom — unlike Radix Select.

---

## Task 1: i18n keys across all 16 locales

**Files:**
- Modify: `lib/i18n/en.json`, `en-GB.json`, `en-AU.json`, `zh-CN.json`, `zh-TW.json`, `es.json`, `es-419.json`, `fr.json`, `de.json`, `ja.json`, `ko.json`, `hi.json`, `ru.json`, `vi.json`, `id.json`, `ms.json`
- Test: `__tests__/i18n-locale-parity.test.ts` (existing — enforces same key set + non-empty values across all locales)

Add these 5 keys to **every** locale file. Insert them immediately after the existing `"table.deleteTableConfirm": ...,` line (key order is cosmetic — the parity test only checks the set). Use the translation for the matching locale:

| key | en / en-GB / en-AU | zh-CN | zh-TW | es / es-419 | fr | de | ja | ko | hi | ru | vi | id | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `editor.align` | Alignment | 对齐 | 對齊 | Alineación | Alignement | Ausrichtung | 配置 | 정렬 | संरेखण | Выравнивание | Căn chỉnh | Perataan | Penjajaran |
| `table.actions` | Table | 表格 | 表格 | Tabla | Tableau | Tabelle | 表 | 표 | तालिका | Таблица | Bảng | Tabel | Jadual |
| `table.toggleHeaderRow` | Toggle header row | 表头行 | 表頭列 | Alternar fila de encabezado | Activer la ligne d'en-tête | Kopfzeile umschalten | ヘッダー行の切り替え | 머리글 행 전환 | हेडर पंक्ति टॉगल करें | Переключить строку заголовка | Bật/tắt hàng tiêu đề | Alihkan baris header | Togol baris pengepala |
| `table.mergeCells` | Merge cells | 合并单元格 | 合併儲存格 | Combinar celdas | Fusionner les cellules | Zellen verbinden | セルを結合 | 셀 병합 | कक्ष मर्ज करें | Объединить ячейки | Gộp ô | Gabungkan sel | Cantum sel |
| `table.splitCell` | Split cell | 拆分单元格 | 拆分儲存格 | Dividir celda | Fractionner la cellule | Zelle teilen | セルを分割 | 셀 분할 | कक्ष विभाजित करें | Разделить ячейку | Tách ô | Pisahkan sel | Pisah sel |

For example, in `lib/i18n/en.json` after `"table.deleteTableConfirm": "Click again to confirm",` add:

```json
  "editor.align": "Alignment",
  "table.actions": "Table",
  "table.toggleHeaderRow": "Toggle header row",
  "table.mergeCells": "Merge cells",
  "table.splitCell": "Split cell",
```

- [ ] **Step 1: Add the 5 keys to all 16 locale files** (en/en-GB/en-AU use the English column).

- [ ] **Step 2: Run the parity test to verify all locales are in sync**

Run: `cd .worktrees/LUM-217-table-menu-unify && npx jest i18n-locale-parity`
Expected: PASS (all `has the same key set` + `non-empty values` tests green). If a locale is missing a key or has an empty value, the test names the offender — fix it.

- [ ] **Step 3: Commit**

```bash
cd .worktrees/LUM-217-table-menu-unify
git add lib/i18n/*.json
git commit -m "i18n: add align/table-actions/header/merge/split keys [LUM-217]"
```

---

## Task 2: AlignMenu component

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/bubble-menu/AlignMenu.tsx`
- Test: `__tests__/components/AlignMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */

const messages: Record<string, string> = {
  'editor.align': 'Alignment',
  'editor.alignLeft': 'Align left',
  'editor.alignCenter': 'Align center',
  'editor.alignRight': 'Align right',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => messages[id] ?? id }),
}))

import { fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { AlignMenu } from '@/app/workspace/[workspaceUrl]/components/bubble-menu/AlignMenu'

function makeEditor() {
  const chain: Record<string, jest.Mock> = {}
  for (const m of ['focus', 'setTextAlign', 'run']) {
    chain[m] = jest.fn(() => (m === 'run' ? true : chain))
  }
  const editor = { chain: () => chain } as unknown as Editor
  return { editor, chain }
}

describe('AlignMenu', () => {
  it('is collapsed until clicked, then lists the three alignments', () => {
    const { editor } = makeEditor()
    render(<AlignMenu editor={editor} alignLeft alignCenter={false} alignRight={false} />)
    // Trigger only — dropdown items not rendered yet
    expect(screen.queryByText('Align center')).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button'))
    expect(screen.getByText('Align left')).toBeInTheDocument()
    expect(screen.getByText('Align center')).toBeInTheDocument()
    expect(screen.getByText('Align right')).toBeInTheDocument()
  })

  it('applies the chosen alignment and closes', () => {
    const { editor, chain } = makeEditor()
    render(<AlignMenu editor={editor} alignLeft alignCenter={false} alignRight={false} />)
    fireEvent.mouseDown(screen.getByRole('button'))
    fireEvent.mouseDown(screen.getByText('Align center'))
    expect(chain.setTextAlign).toHaveBeenCalledWith('center')
    expect(screen.queryByText('Align center')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/LUM-217-table-menu-unify && npx jest AlignMenu`
Expected: FAIL — cannot resolve module `AlignMenu` (not created yet).

- [ ] **Step 3: Create the component**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import type { Editor } from '@tiptap/core'
import { AlignLeft, AlignCenter, AlignRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function AlignMenu({
  editor,
  alignLeft,
  alignCenter,
  alignRight,
}: {
  editor: Editor
  alignLeft: boolean
  alignCenter: boolean
  alignRight: boolean
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const options = [
    {
      id: 'editor.alignLeft',
      icon: <AlignLeft size={14} />,
      value: 'left' as const,
      active: alignLeft,
    },
    {
      id: 'editor.alignCenter',
      icon: <AlignCenter size={14} />,
      value: 'center' as const,
      active: alignCenter,
    },
    {
      id: 'editor.alignRight',
      icon: <AlignRight size={14} />,
      value: 'right' as const,
      active: alignRight,
    },
  ]
  const current = options.find(o => o.active) ?? options[0]!

  return (
    <div ref={ref} className='relative'>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            onMouseDown={e => {
              e.preventDefault()
              setOpen(o => !o)
            }}
            className='flex items-center gap-1 px-1.5 h-7 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors'
          >
            {current.icon}
            <ChevronDown size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {intl.formatMessage({ id: 'editor.align' })}
        </TooltipContent>
      </Tooltip>
      {open && (
        <div className='absolute top-full left-0 mt-1 z-50 min-w-[140px] bg-popover text-popover-foreground border border-border rounded-md shadow-lg py-1'>
          {options.map(o => (
            <button
              key={o.id}
              type='button'
              onMouseDown={e => {
                e.preventDefault()
                editor.chain().focus().setTextAlign(o.value).run()
                setOpen(false)
              }}
              className={cn(
                'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                o.active
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {o.icon}
              {intl.formatMessage({ id: o.id })}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .worktrees/LUM-217-table-menu-unify && npx jest AlignMenu`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-217-table-menu-unify
git add app/workspace/\[workspaceUrl\]/components/bubble-menu/AlignMenu.tsx __tests__/components/AlignMenu.test.tsx
git commit -m "feat: AlignMenu dropdown for bubble menu [LUM-217]"
```

---

## Task 3: TableActionsMenu component

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/bubble-menu/TableActionsMenu.tsx`
- Test: `__tests__/components/TableActionsMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
/** @jest-environment jsdom */

const messages: Record<string, string> = {
  'table.actions': 'Table',
  'table.addRowAbove': 'Add row above',
  'table.addRowBelow': 'Add row below',
  'table.addColLeft': 'Add column left',
  'table.addColRight': 'Add column right',
  'table.toggleHeaderRow': 'Toggle header row',
  'table.mergeCells': 'Merge cells',
  'table.splitCell': 'Split cell',
  'table.deleteRow': 'Delete row',
  'table.deleteCol': 'Delete column',
  'table.deleteTable': 'Delete table',
  'table.deleteTableConfirm': 'Click again to confirm',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => messages[id] ?? id }),
}))

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { TableActionsMenu } from '@/app/workspace/[workspaceUrl]/components/bubble-menu/TableActionsMenu'

function makeEditor() {
  const chain: Record<string, jest.Mock> = {}
  const methods = [
    'focus', 'addRowBefore', 'addRowAfter', 'addColumnBefore', 'addColumnAfter',
    'toggleHeaderRow', 'mergeCells', 'splitCell',
    'deleteRow', 'deleteColumn', 'deleteTable', 'run',
  ]
  for (const m of methods) chain[m] = jest.fn(() => (m === 'run' ? true : chain))
  const editor = { chain: () => chain } as unknown as Editor
  return { editor, chain }
}

function open() {
  fireEvent.mouseDown(screen.getByRole('button', { name: /Table/i }))
}

describe('TableActionsMenu', () => {
  it('opens to reveal structural + delete actions', () => {
    const { editor } = makeEditor()
    render(<TableActionsMenu editor={editor} canMergeCells canSplitCell />)
    expect(screen.queryByText('Toggle header row')).not.toBeInTheDocument()
    open()
    expect(screen.getByText('Toggle header row')).toBeInTheDocument()
    expect(screen.getByText('Merge cells')).toBeInTheDocument()
    expect(screen.getByText('Split cell')).toBeInTheDocument()
    expect(screen.getByText('Delete table')).toBeInTheDocument()
  })

  it('runs toggleHeaderRow and closes', () => {
    const { editor, chain } = makeEditor()
    render(<TableActionsMenu editor={editor} canMergeCells canSplitCell />)
    open()
    fireEvent.mouseDown(screen.getByText('Toggle header row'))
    expect(chain.toggleHeaderRow).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Toggle header row')).not.toBeInTheDocument()
  })

  it('disables merge/split when not available', () => {
    const { editor, chain } = makeEditor()
    render(<TableActionsMenu editor={editor} canMergeCells={false} canSplitCell={false} />)
    open()
    const merge = screen.getByText('Merge cells').closest('button')!
    const split = screen.getByText('Split cell').closest('button')!
    expect(merge).toBeDisabled()
    expect(split).toBeDisabled()
    fireEvent.mouseDown(merge)
    expect(chain.mergeCells).not.toHaveBeenCalled()
  })

  it('requires two clicks to delete the whole table', () => {
    const { editor, chain } = makeEditor()
    render(<TableActionsMenu editor={editor} canMergeCells canSplitCell />)
    open()
    fireEvent.mouseDown(screen.getByText('Delete table'))
    expect(chain.deleteTable).not.toHaveBeenCalled()
    // armed: label switched to the confirm copy, menu still open
    fireEvent.mouseDown(screen.getByText('Click again to confirm'))
    expect(chain.deleteTable).toHaveBeenCalledTimes(1)
  })

  it('auto-disarms the delete-table confirm after the timeout', () => {
    jest.useFakeTimers()
    try {
      const { editor, chain } = makeEditor()
      render(<TableActionsMenu editor={editor} canMergeCells canSplitCell />)
      open()
      fireEvent.mouseDown(screen.getByText('Delete table'))
      expect(screen.getByText('Click again to confirm')).toBeInTheDocument()
      act(() => { jest.advanceTimersByTime(3000) })
      expect(screen.queryByText('Click again to confirm')).not.toBeInTheDocument()
      fireEvent.mouseDown(screen.getByText('Delete table'))
      expect(chain.deleteTable).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/LUM-217-table-menu-unify && npx jest TableActionsMenu`
Expected: FAIL — cannot resolve module `TableActionsMenu`.

- [ ] **Step 3: Create the component**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import type { Editor } from '@tiptap/core'
import {
  Table2,
  ChevronDown,
  BetweenHorizontalStart,
  BetweenHorizontalEnd,
  BetweenVerticalStart,
  BetweenVerticalEnd,
  PanelTop,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const ITEM_BASE =
  'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors'
const ITEM_IDLE =
  'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
const ITEM_DANGER = 'text-destructive hover:bg-destructive/10'
const ITEM_DISABLED = 'text-muted-foreground opacity-40 cursor-not-allowed'

export function TableActionsMenu({
  editor,
  canMergeCells,
  canSplitCell,
}: {
  editor: Editor
  canMergeCells: boolean
  canSplitCell: boolean
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [confirmDeleteTable, setConfirmDeleteTable] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending confirm timer on unmount
  useEffect(
    () => () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    },
    []
  )

  // Close on outside click; reset the delete-confirm when the menu closes
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false)
        setConfirmDeleteTable(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function runAndClose(fn: () => void) {
    fn()
    setOpen(false)
  }

  function handleDeleteTableClick() {
    if (confirmDeleteTable) {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = null
      }
      setConfirmDeleteTable(false)
      editor.chain().focus().deleteTable().run()
      setOpen(false)
    } else {
      setConfirmDeleteTable(true)
      confirmTimerRef.current = setTimeout(() => {
        setConfirmDeleteTable(false)
        confirmTimerRef.current = null
      }, 3000)
    }
  }

  return (
    <div ref={ref} className='relative'>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            onMouseDown={e => {
              e.preventDefault()
              setOpen(o => !o)
            }}
            className='flex items-center gap-1 px-1.5 h-7 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors'
          >
            <Table2 size={14} />
            <ChevronDown size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {intl.formatMessage({ id: 'table.actions' })}
        </TooltipContent>
      </Tooltip>
      {open && (
        <div className='absolute top-full left-0 mt-1 z-50 min-w-[180px] bg-popover text-popover-foreground border border-border rounded-md shadow-lg py-1'>
          {/* rows / cols */}
          <button
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().addRowBefore().run())
            }}
          >
            <BetweenHorizontalStart size={14} />
            {intl.formatMessage({ id: 'table.addRowAbove' })}
          </button>
          <button
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().addRowAfter().run())
            }}
          >
            <BetweenHorizontalEnd size={14} />
            {intl.formatMessage({ id: 'table.addRowBelow' })}
          </button>
          <button
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().addColumnBefore().run())
            }}
          >
            <BetweenVerticalStart size={14} />
            {intl.formatMessage({ id: 'table.addColLeft' })}
          </button>
          <button
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().addColumnAfter().run())
            }}
          >
            <BetweenVerticalEnd size={14} />
            {intl.formatMessage({ id: 'table.addColRight' })}
          </button>

          <div className='my-1 h-px bg-border' />

          {/* structure */}
          <button
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().toggleHeaderRow().run())
            }}
          >
            <PanelTop size={14} />
            {intl.formatMessage({ id: 'table.toggleHeaderRow' })}
          </button>
          <button
            type='button'
            disabled={!canMergeCells}
            className={cn(ITEM_BASE, canMergeCells ? ITEM_IDLE : ITEM_DISABLED)}
            onMouseDown={e => {
              e.preventDefault()
              if (canMergeCells)
                runAndClose(() => editor.chain().focus().mergeCells().run())
            }}
          >
            <TableCellsMerge size={14} />
            {intl.formatMessage({ id: 'table.mergeCells' })}
          </button>
          <button
            type='button'
            disabled={!canSplitCell}
            className={cn(ITEM_BASE, canSplitCell ? ITEM_IDLE : ITEM_DISABLED)}
            onMouseDown={e => {
              e.preventDefault()
              if (canSplitCell)
                runAndClose(() => editor.chain().focus().splitCell().run())
            }}
          >
            <TableCellsSplit size={14} />
            {intl.formatMessage({ id: 'table.splitCell' })}
          </button>

          <div className='my-1 h-px bg-border' />

          {/* delete */}
          <button
            type='button'
            className={cn(ITEM_BASE, ITEM_DANGER)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().deleteRow().run())
            }}
          >
            <Trash2 size={13} />
            {intl.formatMessage({ id: 'table.deleteRow' })}
          </button>
          <button
            type='button'
            className={cn(ITEM_BASE, ITEM_DANGER)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().deleteColumn().run())
            }}
          >
            <Trash2 size={13} />
            {intl.formatMessage({ id: 'table.deleteCol' })}
          </button>
          <button
            type='button'
            className={cn(
              ITEM_BASE,
              confirmDeleteTable
                ? 'bg-destructive/10 text-destructive font-medium'
                : ITEM_DANGER
            )}
            onMouseDown={e => {
              e.preventDefault()
              handleDeleteTableClick()
            }}
          >
            <Trash2 size={13} />
            {intl.formatMessage({
              id: confirmDeleteTable
                ? 'table.deleteTableConfirm'
                : 'table.deleteTable',
            })}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .worktrees/LUM-217-table-menu-unify && npx jest TableActionsMenu`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-217-table-menu-unify
git add app/workspace/\[workspaceUrl\]/components/bubble-menu/TableActionsMenu.tsx __tests__/components/TableActionsMenu.test.tsx
git commit -m "feat: TableActionsMenu dropdown with header/merge/split + delete confirm [LUM-217]"
```

---

## Task 4: Wire the unified table toolbar into BubbleMenuBar

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx`
- Test: `__tests__/components/BubbleMenuBarTable.test.tsx`

This task replaces the two `isTable` branches (current lines ~255–388) with one, adds the two `can*` selector fields, renders the new components, removes the moved delete-confirm machinery, and moves the `linkOpen` branch above the table branch (fixes in-table link editing being shadowed).

- [ ] **Step 1: Rewrite the test for the unified bar**

Replace the entire contents of `__tests__/components/BubbleMenuBarTable.test.tsx` with:

```tsx
/** @jest-environment jsdom */

const messages: Record<string, string> = {
  'editor.bold': 'Bold',
  'editor.italic': 'Italic',
  'editor.underline': 'Underline',
  'editor.strikethrough': 'Strikethrough',
  'editor.link': 'Link',
  'editor.align': 'Alignment',
  'editor.alignLeft': 'Align left',
  'editor.alignCenter': 'Align center',
  'editor.alignRight': 'Align right',
  'table.actions': 'Table',
  'table.addRowAbove': 'Add row above',
  'table.addRowBelow': 'Add row below',
  'table.addColLeft': 'Add column left',
  'table.addColRight': 'Add column right',
  'table.toggleHeaderRow': 'Toggle header row',
  'table.mergeCells': 'Merge cells',
  'table.splitCell': 'Split cell',
  'table.deleteRow': 'Delete row',
  'table.deleteCol': 'Delete column',
  'table.deleteTable': 'Delete table',
  'table.deleteTableConfirm': 'Click again to confirm',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

// useEditorState is mocked to return our flat editorState (selector ignored).
let editorState: Record<string, unknown> = {}
jest.mock('@tiptap/react', () => ({
  useEditorState: () => editorState,
}))

import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { BubbleMenuBar } from '@/app/workspace/[workspaceUrl]/components/BubbleMenuBar'

function makeEditor() {
  const chain: Record<string, jest.Mock> = {}
  const methods = [
    'focus', 'toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleStrike',
    'setTextAlign', 'addRowBefore', 'addRowAfter', 'addColumnBefore',
    'addColumnAfter', 'toggleHeaderRow', 'mergeCells', 'splitCell',
    'deleteRow', 'deleteColumn', 'deleteTable', 'run',
  ]
  for (const m of methods) chain[m] = jest.fn(() => (m === 'run' ? true : chain))
  const editor = {
    chain: () => chain,
    getAttributes: () => ({}),
    isActive: () => false,
  } as unknown as Editor
  return { editor, chain }
}

function renderToolbar(editor: Editor) {
  return render(
    <BubbleMenuBar
      editor={editor}
      openLinkInputRef={createRef<(() => void) | null>()}
      onInsertImage={() => {}}
    />
  )
}

const inTable = (selectionEmpty: boolean) => ({
  isTable: true,
  selectionEmpty,
  canMergeCells: false,
  canSplitCell: false,
})

describe('BubbleMenuBar unified table toolbar', () => {
  it('shows the same controls whether or not text is selected (no shape-shift)', () => {
    const a = makeEditor()
    editorState = inTable(true)
    const { unmount } = renderToolbar(a.editor)
    // Table-actions trigger present when cursor is in a table with no selection
    expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument()
    unmount()

    const b = makeEditor()
    editorState = inTable(false)
    renderToolbar(b.editor)
    // Still present once text inside the table is selected
    expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument()
  })

  it('opens the table dropdown and runs a row insert', () => {
    const { editor, chain } = makeEditor()
    editorState = inTable(true)
    renderToolbar(editor)
    fireEvent.mouseDown(screen.getByRole('button', { name: /Table/i }))
    fireEvent.mouseDown(screen.getByText('Add row above'))
    expect(chain.addRowBefore).toHaveBeenCalledTimes(1)
  })

  it('still requires two clicks to delete the whole table', () => {
    const { editor, chain } = makeEditor()
    editorState = inTable(true)
    renderToolbar(editor)
    fireEvent.mouseDown(screen.getByRole('button', { name: /Table/i }))
    fireEvent.mouseDown(screen.getByText('Delete table'))
    expect(chain.deleteTable).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByText('Click again to confirm'))
    expect(chain.deleteTable).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd .worktrees/LUM-217-table-menu-unify && npx jest BubbleMenuBarTable`
Expected: FAIL — the old component renders two different bars and has no `Table`-labelled actions trigger when `selectionEmpty` is false.

- [ ] **Step 3: Add the two `can*` fields to the selector**

In `BubbleMenuBar.tsx`, inside the `useEditorState` `selector` object (after the `isTable: ...` line, near line 159), add:

```ts
      canMergeCells: ctx.editor.can().mergeCells(),
      canSplitCell: ctx.editor.can().splitCell(),
```

- [ ] **Step 4: Replace the two table branches with one, and move `linkOpen` above it**

Delete both existing table branches: the `if (state.isTable && state.selectionEmpty) { ... }` block and the `if (state.isTable && !state.selectionEmpty) { ... }` block (current lines ~255–388).

Move the existing `if (linkOpen) { ... }` block (the link URL input panel) so it appears **before** the new table branch. Then add the unified table branch immediately after it:

```tsx
  // Unified in-table toolbar — stable shape regardless of selection.
  if (state.isTable) {
    return (
      <div className='flex items-center gap-0.5 px-1.5 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg'>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={state.isBold}
          title={`${intl.formatMessage({ id: 'editor.bold' })} ${mod}B`}
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={state.isItalic}
          title={`${intl.formatMessage({ id: 'editor.italic' })} ${mod}I`}
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={state.isUnderline}
          title={`${intl.formatMessage({ id: 'editor.underline' })} ${mod}U`}
        >
          <UnderlineIcon size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={state.isStrike}
          title={intl.formatMessage({ id: 'editor.strikethrough' })}
        >
          <Strikethrough size={14} />
        </ToolbarButton>
        <ColorPicker
          editor={editor}
          currentColor={state.currentColor}
          currentHighlight={state.currentHighlight}
        />

        <Divider />

        <AlignMenu
          editor={editor}
          alignLeft={state.alignLeft}
          alignCenter={state.alignCenter}
          alignRight={state.alignRight}
        />

        <Divider />

        <ToolbarButton
          onClick={openLinkInput}
          active={state.isLink}
          title={`${intl.formatMessage({ id: 'editor.link' })} ${mod}K`}
        >
          <Link2 size={14} />
        </ToolbarButton>

        <Divider />

        <TableActionsMenu
          editor={editor}
          canMergeCells={state.canMergeCells}
          canSplitCell={state.canSplitCell}
        />
      </div>
    )
  }
```

- [ ] **Step 5: Remove the now-moved delete-confirm machinery and fix imports**

In `BubbleMenuBar.tsx`:

1. Delete the `confirmDeleteTable` state (`const [confirmDeleteTable, setConfirmDeleteTable] = useState(false)` + its comment).
2. Delete the `confirmDeleteTimerRef` ref.
3. Delete the unmount `useEffect` that clears `confirmDeleteTimerRef` (the "Clear any pending confirm timer on unmount" effect).
4. Delete the `handleDeleteTableClick` function.
5. Add the two imports near the other bubble-menu imports:

```ts
import { AlignMenu } from './bubble-menu/AlignMenu'
import { TableActionsMenu } from './bubble-menu/TableActionsMenu'
```

6. Remove icons no longer referenced in this file (they moved into the subcomponents): `Trash2`, `BetweenHorizontalStart`, `BetweenHorizontalEnd`, `BetweenVerticalStart`, `BetweenVerticalEnd`, `AlignLeft`, `AlignCenter`, `AlignRight`. Keep `Table2` (still used by the default toolbar's insert-table button) and all icons used by the default toolbar.

> After editing, double-check no remaining reference to the removed symbols exists in the file (grep in Step 7 catches this).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd .worktrees/LUM-217-table-menu-unify && npx jest BubbleMenuBarTable`
Expected: PASS (3 tests).

- [ ] **Step 7: Guard against leftover references**

Run: `cd .worktrees/LUM-217-table-menu-unify && grep -nE 'confirmDeleteTable|handleDeleteTableClick|confirmDeleteTimerRef' app/workspace/\[workspaceUrl\]/components/BubbleMenuBar.tsx; grep -nE '\b(Trash2|BetweenHorizontalStart|BetweenHorizontalEnd|BetweenVerticalStart|BetweenVerticalEnd|AlignLeft|AlignCenter|AlignRight)\b' app/workspace/\[workspaceUrl\]/components/BubbleMenuBar.tsx`
Expected: no output (all moved/removed).

- [ ] **Step 8: Commit**

```bash
cd .worktrees/LUM-217-table-menu-unify
git add app/workspace/\[workspaceUrl\]/components/BubbleMenuBar.tsx __tests__/components/BubbleMenuBarTable.test.tsx
git commit -m "feat: unify in-table bubble toolbar, wire header/merge/split [LUM-217]"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full bubble-menu test set**

Run: `cd .worktrees/LUM-217-table-menu-unify && npx jest AlignMenu TableActionsMenu BubbleMenuBar i18n-locale-parity`
Expected: PASS — all suites green.

- [ ] **Step 2: Typecheck (catches `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / stale Prisma client)**

Run: `cd .worktrees/LUM-217-table-menu-unify && npx prisma generate && npx tsc --noEmit`
Expected: no errors. If `tsc` reports `Property 'mergeCells'/'splitCell'/'toggleHeaderRow' does not exist on type ...`, the Tiptap table extension's command types aren't surfacing — verify `@tiptap/extension-table` (or the table kit) is in `package.json` and its types are included; these commands ship with the table cell/header extensions already used by `insertTable`.

- [ ] **Step 3: Token lint (new components must use semantic tokens)**

Run: `cd .worktrees/LUM-217-table-menu-unify && npm run lint:tokens`
Expected: PASS. The new files use `bg-popover`/`text-popover-foreground`/`border-border`/`bg-accent`/`text-accent-foreground`/`text-muted-foreground`/`text-destructive` — all semantic, no raw zinc/gray. If it flags anything, fix with semantic tokens (do **not** baseline-update — that's only for sanctioned brand hex).

- [ ] **Step 4: Confirm no console.log and named exports**

Run: `cd .worktrees/LUM-217-table-menu-unify && grep -rn 'console.log' app/workspace/\[workspaceUrl\]/components/bubble-menu/AlignMenu.tsx app/workspace/\[workspaceUrl\]/components/bubble-menu/TableActionsMenu.tsx`
Expected: no output.

---

## Self-Review Notes

- **Spec coverage:** unify branches (Task 4) ✓; toggleHeaderRow/mergeCells/splitCell (Task 3, wired Task 4) ✓; align→dropdown (Task 2) ✓; merge/split disabled via `can()` (Task 3 props + Task 4 selector) ✓; two-step delete confirm preserved (Task 3) ✓; 5 i18n keys × 16 locales (Task 1) ✓; component extraction (Tasks 2–3) ✓; tests updated (Tasks 2–4) ✓.
- **Bonus fix:** moving `linkOpen` above the table branch (Task 4 Step 4) repairs in-table link editing, which the current branch order shadows.
- **Type consistency:** `canMergeCells`/`canSplitCell` prop names match between selector (Task 4), TableActionsMenu props (Task 3), and test editorState (Tasks 3–4). `AlignMenu` props `alignLeft/alignCenter/alignRight` match the selector fields already present.
- **jsdom:** all dropdowns are hand-rolled (mousedown → state), so they open in jsdom — the Radix-Select-in-jsdom limitation does not apply.
