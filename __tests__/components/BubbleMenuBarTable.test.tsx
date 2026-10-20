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
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { BubbleMenuBar } from '@/app/workspace/[workspaceUrl]/components/BubbleMenuBar'

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
    'toggleBold',
    'toggleItalic',
    'toggleUnderline',
    'toggleStrike',
    'setTextAlign',
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
    getAttributes: () => ({}),
    commands: { focus: jest.fn() },
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
  isLink: false,
  canMergeCells: false,
  canSplitCell: false,
})

describe('BubbleMenuBar unified table toolbar', () => {
  it('shows the same controls whether or not text is selected (no shape-shift)', () => {
    editorState = inTable(true)
    const a = renderToolbar(makeEditor().editor)
    const whenEmpty = screen.getAllByRole('button').length
    expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument()
    a.unmount()

    editorState = inTable(false)
    renderToolbar(makeEditor().editor)
    const whenSelected = screen.getAllByRole('button').length
    expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument()
    // Same number of controls in both selection states — the old code dropped
    // all text-format buttons when text was selected; the unified bar must not.
    expect(whenSelected).toBe(whenEmpty)
    expect(whenEmpty).toBeGreaterThan(1)
  })

  it('opens the table dropdown and runs a row insert', () => {
    const { editor, chain } = makeEditor()
    editorState = inTable(true)
    renderToolbar(editor)
    openMenu(screen.getByRole('button', { name: /Table/i }))
    fireEvent.click(screen.getByText('Add row above'))
    expect(chain.addRowBefore).toHaveBeenCalledTimes(1)
  })

  it('still requires two clicks to delete the whole table', () => {
    const { editor, chain } = makeEditor()
    editorState = inTable(true)
    renderToolbar(editor)
    openMenu(screen.getByRole('button', { name: /Table/i }))
    fireEvent.click(screen.getByText('Delete table'))
    expect(chain.deleteTable).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Click again to confirm'))
    expect(chain.deleteTable).toHaveBeenCalledTimes(1)
  })

  it('opens the link panel even while inside a table', () => {
    const openRef = createRef<(() => void) | null>()
    const { editor } = makeEditor()
    editorState = inTable(true)
    render(
      <BubbleMenuBar
        editor={editor}
        openLinkInputRef={openRef}
        onInsertImage={() => {}}
      />
    )
    // The editor's keydown handler invokes this ref to open the link panel.
    // Previously the table branch shadowed it; now the link panel must show.
    act(() => {
      openRef.current?.()
    })
    expect(screen.getByPlaceholderText('https://')).toBeInTheDocument()
  })
})
