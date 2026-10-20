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
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { TableActionsMenu } from '@/app/workspace/[workspaceUrl]/components/bubble-menu/TableActionsMenu'

// jsdom has no PointerEvent, so fireEvent.pointerDown would drop `button`
// and the Radix DropdownMenu trigger (which opens on pointerdown) ignores it.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class extends MouseEvent {} as typeof PointerEvent
}
const openMenu = (el: HTMLElement) =>
  fireEvent.pointerDown(el, { button: 0, ctrlKey: false })

function makeEditor() {
  const chain: Record<string, jest.Mock> = {}
  const methods = [
    'focus',
    'addRowBefore',
    'addRowAfter',
    'addColumnBefore',
    'addColumnAfter',
    'toggleHeaderRow',
    'mergeCells',
    'splitCell',
    'deleteRow',
    'deleteColumn',
    'deleteTable',
    'run',
  ]
  for (const m of methods)
    chain[m] = jest.fn(() => (m === 'run' ? true : chain))
  const editor = {
    chain: () => chain,
    commands: { focus: jest.fn() },
  } as unknown as Editor
  return { editor, chain }
}

function open() {
  openMenu(screen.getByRole('button', { name: /Table/i }))
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
    fireEvent.click(screen.getByText('Toggle header row'))
    expect(chain.toggleHeaderRow).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Toggle header row')).not.toBeInTheDocument()
  })

  it('disables merge/split when not available', () => {
    const { editor, chain } = makeEditor()
    render(
      <TableActionsMenu
        editor={editor}
        canMergeCells={false}
        canSplitCell={false}
      />
    )
    open()
    const merge = screen.getByText('Merge cells').closest('[role=menuitem]')!
    const split = screen.getByText('Split cell').closest('[role=menuitem]')!
    expect(merge).toHaveAttribute('aria-disabled', 'true')
    expect(split).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(merge)
    expect(chain.mergeCells).not.toHaveBeenCalled()
    fireEvent.click(split)
    expect(chain.splitCell).not.toHaveBeenCalled()
  })

  it('requires two clicks to delete the whole table', () => {
    const { editor, chain } = makeEditor()
    render(<TableActionsMenu editor={editor} canMergeCells canSplitCell />)
    open()
    fireEvent.click(screen.getByText('Delete table'))
    expect(chain.deleteTable).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Click again to confirm'))
    expect(chain.deleteTable).toHaveBeenCalledTimes(1)
  })

  it('auto-disarms the delete-table confirm after the timeout', () => {
    jest.useFakeTimers()
    try {
      const { editor, chain } = makeEditor()
      render(<TableActionsMenu editor={editor} canMergeCells canSplitCell />)
      open()
      fireEvent.click(screen.getByText('Delete table'))
      expect(screen.getByText('Click again to confirm')).toBeInTheDocument()
      act(() => {
        jest.advanceTimersByTime(3000)
      })
      expect(
        screen.queryByText('Click again to confirm')
      ).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('Delete table'))
      expect(chain.deleteTable).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
