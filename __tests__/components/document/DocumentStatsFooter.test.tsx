/**
 * Mock react-intl (ships as ESM; next/jest doesn't transpile it). The mock
 * interpolates {placeholders} so we can assert the rendered counts.
 */
const messages: Record<string, string> = {
  'documentEditor.stats.words': '{count} words',
  'documentEditor.stats.characters': '{count} characters',
  'documentEditor.stats.readingTime': '{minutes} min read',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values: Record<string, unknown> = {}
    ) =>
      (messages[id] ?? id).replace(/\{(\w+)\}/g, (_, k) =>
        String(values[k] ?? '')
      ),
  }),
}))

import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import { DocumentStatsFooter } from '@/app/workspace/[workspaceUrl]/components/document/DocumentStatsFooter'

describe('DocumentStatsFooter', () => {
  it('renders nothing when stats are absent', () => {
    const { container } = render(<DocumentStatsFooter stats={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows words, characters and reading time joined', () => {
    const { container } = render(
      <DocumentStatsFooter
        stats={{ words: 128, characters: 642, readingMinutes: 3 }}
      />
    )
    expect(container.textContent).toBe(
      '128 words · 642 characters · 3 min read'
    )
  })

  it('omits reading time for empty content (0 minutes)', () => {
    const { container } = render(
      <DocumentStatsFooter
        stats={{ words: 0, characters: 0, readingMinutes: 0 }}
      />
    )
    expect(container.textContent).toBe('0 words · 0 characters')
  })

  it('renders a sticky, click-through floating layer with a pointer-enabled pill', () => {
    const { container } = render(
      <DocumentStatsFooter
        stats={{ words: 1, characters: 1, readingMinutes: 0 }}
      />
    )
    // Zero-height sticky layer reserves no flow space and stays click-through.
    const layer = container.firstElementChild as HTMLElement
    expect(layer).toHaveClass(
      'sticky',
      'bottom-0',
      'h-0',
      'pointer-events-none'
    )
    // The pill itself is pinned bottom-right and re-enables pointer events.
    const pill = layer.firstElementChild as HTMLElement
    expect(pill).toHaveClass(
      'absolute',
      'bottom-4',
      'right-4',
      'pointer-events-auto'
    )
  })
})
