/** @jest-environment jsdom */

// ─── i18n mock ──────────────────────────────────────────────────────────────
const messages: Record<string, string> = {
  'table.addRowAbove': 'Add row above',
  'table.addRowBelow': 'Add row below',
  'table.addColLeft': 'Add column left',
  'table.addColRight': 'Add column right',
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

// ─── tiptap useEditorState mock ───────────────────────────────────────────────
// The component derives all button state from useEditorState; for the
// table-only toolbar we only need isTable + selectionEmpty to be true.
let editorState: Record<string, unknown> = {}
jest.mock('@tiptap/react', () => ({
  useEditorState: () => editorState,
}))

import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { BubbleMenuBar } from '@/app/workspace/[workspaceUrl]/components/BubbleMenuBar'

// A chainable editor stub: every method returns the same chain, `run` is terminal.
function makeEditor() {
  const chain: Record<string, jest.Mock> = {}
  const methods = [
    'focus',
    'addRowBefore',
    'addRowAfter',
    'addColumnBefore',
    'addColumnAfter',
    'deleteRow',
    'deleteColumn',
    'deleteTable',
    'run',
  ]
  for (const m of methods) {
    chain[m] = jest.fn(() => (m === 'run' ? true : chain))
  }
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

// Table-only toolbar button order:
// 0 addRowBefore, 1 addRowAfter, 2 addColumnBefore, 3 addColumnAfter,
// 4 deleteRow, 5 deleteColumn, 6 deleteTable
const DELETE_ROW = 4
const DELETE_COL = 5
const DELETE_TABLE = 6

// Armed = solid destructive background applied unconditionally (vs. the idle
// destructive variant which only gets `bg-destructive/10` on hover).
const isArmed = (btn: HTMLElement) =>
  btn.className.split(/\s+/).includes('bg-destructive/10')

beforeEach(() => {
  editorState = { isTable: true, selectionEmpty: true }
})

describe('BubbleMenuBar table toolbar', () => {
  it('renders the seven table-control buttons', () => {
    const { editor } = makeEditor()
    renderToolbar(editor)
    expect(screen.getAllByRole('button')).toHaveLength(7)
  })

  it('deletes a row immediately on a single click', () => {
    const { editor, chain } = makeEditor()
    renderToolbar(editor)
    fireEvent.mouseDown(screen.getAllByRole('button')[DELETE_ROW]!)
    expect(chain.deleteRow).toHaveBeenCalledTimes(1)
  })

  it('deletes a column immediately on a single click', () => {
    const { editor, chain } = makeEditor()
    renderToolbar(editor)
    fireEvent.mouseDown(screen.getAllByRole('button')[DELETE_COL]!)
    expect(chain.deleteColumn).toHaveBeenCalledTimes(1)
  })

  it('requires two clicks to delete the whole table (arm, then confirm)', () => {
    const { editor, chain } = makeEditor()
    renderToolbar(editor)
    const btn = screen.getAllByRole('button')[DELETE_TABLE]!

    // First click arms — no deletion yet, button shows the destructive-armed style.
    fireEvent.mouseDown(btn)
    expect(chain.deleteTable).not.toHaveBeenCalled()
    expect(isArmed(btn)).toBe(true)

    // Second click confirms the deletion.
    fireEvent.mouseDown(btn)
    expect(chain.deleteTable).toHaveBeenCalledTimes(1)
  })

  it('auto-disarms the delete-table confirm after the timeout', () => {
    jest.useFakeTimers()
    try {
      const { editor, chain } = makeEditor()
      renderToolbar(editor)
      const btn = screen.getAllByRole('button')[DELETE_TABLE]!

      fireEvent.mouseDown(btn)
      expect(isArmed(btn)).toBe(true)

      act(() => {
        jest.advanceTimersByTime(3000)
      })
      // Reverted to idle: a subsequent click only re-arms, does not delete.
      expect(isArmed(btn)).toBe(false)
      fireEvent.mouseDown(btn)
      expect(chain.deleteTable).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
