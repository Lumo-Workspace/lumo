/** @jest-environment jsdom */

// react-intl ships ESM that jest can't load from the symlinked node_modules
// (transformIgnorePatterns excludes it). The repo convention (see
// DocumentCommentsSidebar.test.tsx) is to mock react-intl. RevisionDiffView is
// purely presentational and does not use intl, so IntlProvider is just a
// passthrough wrapper here.
jest.mock('react-intl', () => ({
  IntlProvider: ({ children }: { children: React.ReactNode }) => children,
}))

import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { RevisionDiffView } from '@/app/workspace/[workspaceUrl]/components/documents/RevisionDiffView'

function renderView(props: React.ComponentProps<typeof RevisionDiffView>) {
  return render(
    <IntlProvider locale='en' messages={{}}>
      <RevisionDiffView {...props} />
    </IntlProvider>
  )
}

it('renders an inline word-level diff with added/removed marks', () => {
  const { container } = renderView({
    oldHtml: '<p>the quick brown fox</p>',
    newHtml: '<p>the slow brown fox</p>',
  })
  const removed = container.querySelector('del[data-diff="removed"]')
  const added = container.querySelector('ins[data-diff="added"]')
  expect(removed?.textContent).toBe('quick')
  expect(added?.textContent).toBe('slow')
})

it('preserves markdown formatting (renders the block structure)', () => {
  const { container } = renderView({
    oldHtml: '<p>intro</p>',
    newHtml: '<p>intro</p><h2>New section</h2>',
  })
  expect(container.querySelector('h2')).toBeInTheDocument()
  expect(screen.getByText('New section')).toBeInTheDocument()
})

it('wraps long unbreakable tokens', () => {
  renderView({
    oldHtml: '<p>prisma/migrations/x_add_figma_integration</p>',
    newHtml: '<p>prisma/migrations/x_add_figma_integration</p>',
  })
  expect(screen.getByTestId('diff-inline')).toHaveClass('break-words')
})
