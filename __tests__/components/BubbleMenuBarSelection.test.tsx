/** @jest-environment jsdom */

// LUM-219: two BubbleMenuBar fixes —
//   (1) selectionHasTaskLink must short-circuit (skip the full-doc nodesBetween
//       traversal) when there is no extract context, since canConvert already
//       requires !!extractCtx.
//   (2) the link input panel must close on outside click (LUM-1275: focus
//       leaving the panel), matching the style/list dropdowns.
//
// Unlike BubbleMenuBarTable.test.tsx, this file runs the REAL useEditorState
// selector against a fake editor so we can assert on the traversal itself.

const messages: Record<string, string> = {
  'editor.bold': 'Bold',
  'editor.italic': 'Italic',
  'editor.underline': 'Underline',
  'editor.strikethrough': 'Strikethrough',
  'editor.link': 'Link',
  'editor.link.apply': 'Apply',
  'editor.link.remove': 'Remove link',
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

// Run the selector for real so the short-circuit logic is exercised.
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

// Convert action calls these only on click; stub to keep the module light.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/extract/wrapSelection',
  () => ({ wrapSelectionWithExtractPending: jest.fn(() => ({})) })
)
jest.mock('@/lib/api-client/documents-extract', () => ({
  extractTasks: jest.fn(),
}))

import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { BubbleMenuBar } from '@/app/workspace/[workspaceUrl]/components/BubbleMenuBar'

type NodesBetween = (
  from: number,
  to: number,
  cb: (node: unknown) => void
) => void

function makeEditor(nodesBetween: NodesBetween = jest.fn()) {
  const run = jest.fn(() => true)
  // Proxy so any chain().focus().toggleX()... returns the chain and run() ends it.
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
        empty: false,
        $from: { pos: 1, parent: sameParent },
        $to: { pos: 5, parent: sameParent },
      },
      doc: { nodesBetween },
    },
  } as unknown as Editor
  return { editor, run }
}

function renderToolbar(editor: Editor) {
  mockHolder.editor = editor
  return render(
    <BubbleMenuBar
      editor={editor}
      openLinkInputRef={createRef<(() => void) | null>()}
      onInsertImage={() => {}}
    />
  )
}

describe('BubbleMenuBar selectionHasTaskLink short-circuit (LUM-219)', () => {
  afterEach(() => {
    mockExtract.value = null
    mockHolder.editor = null
  })

  it('does NOT traverse the document when there is no extract context', () => {
    mockExtract.value = null
    const nodesBetween = jest.fn()
    const { editor } = makeEditor(nodesBetween)
    renderToolbar(editor)
    // The whole point of the fix: skip the per-transaction full-doc walk.
    expect(nodesBetween).not.toHaveBeenCalled()
  })

  // The convert button is icon-only — its title lives in a Tooltip, not an
  // aria-label, so getByRole({name}) can't see it. It is the ONLY toolbar
  // button that ever receives `disabled`, so query the disabled attribute.
  it('still walks the selection and disables convert when a task link is present', () => {
    mockExtract.value = {
      documentId: 'doc1',
      onApplied: jest.fn(),
      onError: jest.fn(),
    }
    const nodesBetween: NodesBetween = jest.fn((_from, _to, cb) => {
      cb({ marks: [{ type: { name: 'taskLink' } }] })
    })
    const { editor } = makeEditor(nodesBetween)
    const { container } = renderToolbar(editor)
    expect(nodesBetween).toHaveBeenCalled()
    expect(container.querySelector('button[disabled]')).toBeInTheDocument()
  })

  it('enables convert when extract context is present and no task link in selection', () => {
    mockExtract.value = {
      documentId: 'doc1',
      onApplied: jest.fn(),
      onError: jest.fn(),
    }
    const nodesBetween: NodesBetween = jest.fn((_from, _to, cb) => {
      cb({ marks: [] })
    })
    const { editor } = makeEditor(nodesBetween)
    const { container } = renderToolbar(editor)
    expect(nodesBetween).toHaveBeenCalled()
    expect(container.querySelector('button[disabled]')).toBeNull()
  })
})

describe('BubbleMenuBar link panel outside-click close (LUM-219)', () => {
  afterEach(() => {
    mockExtract.value = null
    mockHolder.editor = null
  })

  function openLinkPanel() {
    const openRef = createRef<(() => void) | null>()
    const { editor } = makeEditor()
    mockHolder.editor = editor
    render(
      <BubbleMenuBar
        editor={editor}
        openLinkInputRef={openRef}
        onInsertImage={() => {}}
      />
    )
    act(() => {
      openRef.current?.()
    })
    return screen.getByPlaceholderText('https://')
  }

  it('closes the link panel when focus leaves it (outside click)', () => {
    const input = openLinkPanel()
    expect(input).toBeInTheDocument()
    act(() => {
      fireEvent.focusOut(input, { relatedTarget: document.body })
    })
    expect(screen.queryByPlaceholderText('https://')).not.toBeInTheDocument()
  })

  it('keeps the link panel open when focus moves within it', () => {
    const input = openLinkPanel()
    act(() => {
      fireEvent.focusOut(input, {
        relatedTarget: screen.getByRole('button', { name: 'Apply' }),
      })
    })
    expect(screen.getByPlaceholderText('https://')).toBeInTheDocument()
  })
})
