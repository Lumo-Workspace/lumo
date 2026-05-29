/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { RichTextViewer } from '@/app/workspace/[workspaceUrl]/components/RichTextViewer'

describe('RichTextViewer', () => {
  it('renders the supplied HTML content', () => {
    render(<RichTextViewer value='<p>hello world</p>' />)
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('renders read-only (the ProseMirror surface is not editable)', () => {
    const { container } = render(<RichTextViewer value='<p>read only</p>' />)
    const editable = container.querySelector('[contenteditable]')
    // Tiptap reflects `editable: false` as contenteditable="false".
    expect(editable?.getAttribute('contenteditable')).toBe('false')
  })

  it('renders nothing visible for null content without crashing', () => {
    const { container } = render(<RichTextViewer value={null} />)
    expect(container.textContent).toBe('')
  })
})
