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

it('renders inline word-level diff by default with added/removed marks', () => {
  renderView({
    oldHtml: '<p>the quick brown fox</p>',
    newHtml: '<p>the slow brown fox</p>',
    mode: 'inline',
  })
  expect(screen.getByText('quick')).toHaveAttribute('data-diff', 'removed')
  expect(screen.getByText('slow')).toHaveAttribute('data-diff', 'added')
})

it('renders side-by-side panes when mode=split', () => {
  renderView({
    oldHtml: '<p>old body</p>',
    newHtml: '<p>new body</p>',
    mode: 'split',
  })
  expect(screen.getByTestId('diff-old-pane')).toBeInTheDocument()
  expect(screen.getByTestId('diff-new-pane')).toBeInTheDocument()
})
