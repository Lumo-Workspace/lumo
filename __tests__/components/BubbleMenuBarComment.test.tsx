/** @jest-environment jsdom */

// LUM-226: BubbleMenuBar comment button wiring
// The comment button should only render when onRequestComment prop is provided,
// and should fire it with (from, to, quotedText) on mouseDown.

const messages: Record<string, string> = {
  'editor.bold': 'Bold',
  'editor.italic': 'Italic',
  'editor.underline': 'Underline',
  'editor.strikethrough': 'Strikethrough',
  'editor.link': 'Link',
  'editor.link.apply': 'Apply',
  'editor.link.remove': 'Remove link',
  'editor.comment': 'Comment',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => messages[id] ?? defaultMessage ?? id,
  }),
}))

// Run the selector for real (same pattern as BubbleMenuBarSelection.test.tsx)
// so the selectionEmpty field from the real editor state flows through.
const mockHolder: { editor: unknown } = { editor: null }
jest.mock('@tiptap/react', () => ({
  useEditorState: ({
    selector,
  }: {
    selector: (ctx: { editor: unknown }) => unknown
  }) => selector({ editor: mockHolder.editor }),
}))

const mockExtract: { value: unknown } = { value: null }
jest.mock('@/lib/editor/doc-extract-context', () => ({
  useDocExtractContext: () => mockExtract.value,
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/extract/wrapSelection',
  () => ({ wrapSelectionWithExtractPending: jest.fn(() => ({})) })
)
jest.mock('@/lib/api-client/documents-extract', () => ({
  extractTasks: jest.fn(),
}))

import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { BubbleMenuBar } from '@/app/workspace/[workspaceUrl]/components/BubbleMenuBar'

function makeEditor(
  opts: { selectionEmpty?: boolean; from?: number; to?: number } = {}
) {
  const { selectionEmpty = false, from = 7, to = 12 } = opts
  const run = jest.fn(() => true)
  const chain: Record<string, unknown> = new Proxy(
    {},
    { get: (_t, prop) => (prop === 'run' ? run : () => chain) }
  )
  const sameParent = {}
  const editor = {
    chain: () => chain,
    isActive: jest.fn(() => false),
    can: () => ({ mergeCells: () => false, splitCell: () => false }),
    getAttributes: jest.fn(() => ({})),
    state: {
      selection: {
        empty: selectionEmpty,
        from,
        to,
        $from: { pos: from, parent: sameParent },
        $to: { pos: to, parent: sameParent },
      },
      doc: {
        nodesBetween: jest.fn(),
        textBetween: jest.fn(() => 'brave'),
      },
    },
  } as unknown as Editor
  return editor
}

function renderBar(
  editor: Editor,
  onRequestComment?: (f: number, t: number, q: string) => void
) {
  mockHolder.editor = editor
  return render(
    <BubbleMenuBar
      editor={editor}
      openLinkInputRef={createRef<(() => void) | null>()}
      onInsertImage={() => {}}
      onRequestComment={onRequestComment}
    />
  )
}

afterEach(() => {
  mockExtract.value = null
  mockHolder.editor = null
})

describe('BubbleMenuBar comment button (LUM-226)', () => {
  it('fires onRequestComment with the selection range + quoted text', () => {
    const spy = jest.fn()
    const editor = makeEditor({ selectionEmpty: false, from: 7, to: 12 })
    renderBar(editor, spy)
    const btn = screen.getByTestId('bubble-comment')
    fireEvent.mouseDown(btn)
    expect(spy).toHaveBeenCalledWith(7, 12, 'brave')
  })

  it('does not render the comment button when onRequestComment is absent', () => {
    const editor = makeEditor({ selectionEmpty: false })
    renderBar(editor, undefined)
    expect(screen.queryByTestId('bubble-comment')).toBeNull()
  })

  it('does not render the comment button when selection is empty (even if callback provided)', () => {
    const spy = jest.fn()
    const editor = makeEditor({ selectionEmpty: true })
    renderBar(editor, spy)
    expect(screen.queryByTestId('bubble-comment')).toBeNull()
  })
})
