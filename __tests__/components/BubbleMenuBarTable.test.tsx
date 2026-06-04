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
    expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument()
    unmount()

    const b = makeEditor()
    editorState = inTable(false)
    renderToolbar(b.editor)
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
