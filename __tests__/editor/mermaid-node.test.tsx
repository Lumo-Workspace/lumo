// __tests__/editor/mermaid-node.test.tsx
/** @jest-environment jsdom */

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

import { screen, waitFor } from '@testing-library/react'
import { renderWithQueryClient as render } from '../helpers/query-client'
import { RichTextViewer } from '@/app/workspace/[workspaceUrl]/components/RichTextViewer'
import { Mermaid, DEFAULT_MERMAID_SOURCE } from '@/lib/editor/nodes/mermaid'

const STORED =
  '<pre data-type="mermaid"><code>graph TD\n  A--&gt;B</code></pre>'

beforeEach(() => renderMermaid.mockReset())

describe('Mermaid node', () => {
  it('is a Tiptap node named "mermaid" with a starter template', () => {
    expect(Mermaid.name).toBe('mermaid')
    expect(DEFAULT_MERMAID_SOURCE).toContain('graph TD')
  })

  it('renders stored source as a diagram in the read-only viewer', async () => {
    renderMermaid.mockResolvedValue({
      ok: true,
      svg: '<svg data-testid="diagram">D</svg>',
    })

    render(<RichTextViewer value={STORED} />)

    await waitFor(() =>
      expect(screen.getByTestId('diagram')).toBeInTheDocument()
    )
    expect(renderMermaid).toHaveBeenCalledWith(
      expect.any(String),
      'graph TD\n  A-->B',
      'default'
    )
  })

  it('shows an inline error placeholder when rendering fails', async () => {
    renderMermaid.mockResolvedValue({
      ok: false,
      error: 'Parse error on line 1',
    })

    const { container } = render(<RichTextViewer value={STORED} />)

    await waitFor(() =>
      expect(container.querySelector('.mermaid-error')).not.toBeNull()
    )
    expect(container.textContent).toContain('Parse error on line 1')
  })

  it('renders the empty-state placeholder for blank source', async () => {
    const { container } = render(
      <RichTextViewer value='<pre data-type="mermaid"><code></code></pre>' />
    )
    await waitFor(() =>
      expect(container.querySelector('.mermaid-empty')).not.toBeNull()
    )
    // renderMermaid is never called for empty source.
    expect(renderMermaid).not.toHaveBeenCalled()
  })

  it('does not show an Edit button in the read-only viewer error state', async () => {
    renderMermaid.mockResolvedValue({ ok: false, error: 'bad syntax' })
    const { container } = render(<RichTextViewer value={STORED} />)
    await waitFor(() =>
      expect(container.querySelector('.mermaid-error')).not.toBeNull()
    )
    // RichTextViewer is not editable, so no Edit button is rendered.
    expect(container.querySelector('.mermaid-edit-button')).toBeNull()
  })
})
