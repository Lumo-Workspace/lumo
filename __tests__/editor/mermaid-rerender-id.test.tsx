// __tests__/editor/mermaid-rerender-id.test.tsx
/** @jest-environment jsdom */

// Regression for the "blank diagram after clicking 完成/Done" bug (LUM-336).
//
// Root cause: the node view passed a STABLE id (from useId) to mermaid.render
// on every render. The rendered SVG carries that id, so it lands in the live
// DOM via dangerouslySetInnerHTML. On the next render (after an edit/commit),
// mermaid.render(id, …) runs `removeExistingElements` → `getElementById(id)
// .remove()`, yanking the currently-displayed SVG out of the DOM. When the
// re-rendered SVG string is identical (unchanged source → deterministic
// output), React's state is byte-equal, so it skips the DOM write and the
// diagram stays blank.
//
// The invariant that prevents this: every renderMermaid invocation must use a
// UNIQUE id so it never collides with the SVG already on the page.

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))

jest.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))

const renderMermaid = jest.fn()
jest.mock('@/lib/editor/mermaid-render', () => ({
  renderMermaid: (...args: unknown[]) => renderMermaid(...args),
}))

import { useEffect } from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Mermaid } from '@/lib/editor/nodes/mermaid'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'

// Minimal editable editor hosting a single Mermaid block. Real node view runs.
const STORED =
  '<pre data-type="mermaid"><code>graph TD\n  A--&gt;B</code></pre>'

function EditableMermaid() {
  const editor = useEditor({
    immediatelyRender: false,
    editable: true,
    extensions: [Document, Paragraph, Text, Mermaid],
    content: STORED,
  })
  useEffect(() => () => editor?.destroy(), [editor])
  return <EditorContent editor={editor} />
}

beforeEach(() => {
  renderMermaid.mockReset()
  renderMermaid.mockResolvedValue({
    ok: true,
    svg: '<svg data-testid="diagram">D</svg>',
  })
})

it('uses a unique id for each render so a re-render never collides with the displayed SVG', async () => {
  const { container } = render(<EditableMermaid />)

  // First render of the diagram.
  await waitFor(() => expect(screen.getByTestId('diagram')).toBeInTheDocument())

  // Open the source editor by clicking the diagram, then commit via "Done"
  // WITHOUT changing the source (the exact repro: default template, just Done).
  await act(async () => {
    fireEvent.click(container.querySelector('.mermaid-diagram')!)
  })
  const done = await screen.findByText('Done')
  await act(async () => {
    fireEvent.mouseDown(done)
  })

  // The commit toggles editing→false, re-running the render effect.
  await waitFor(() =>
    expect(renderMermaid.mock.calls.length).toBeGreaterThanOrEqual(2)
  )

  const ids = renderMermaid.mock.calls.map(c => c[0] as string)
  // Every invocation must carry a distinct id — a reused id is what lets
  // mermaid's removeExistingElements delete the on-screen diagram.
  expect(new Set(ids).size).toBe(ids.length)
})
