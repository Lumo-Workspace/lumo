/** @jest-environment jsdom */

// react-intl ships pure ESM and can't be transformed by jest without special config.
// Mock it the same way other component tests in this project do.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      const template = defaultMessage ?? id
      if (!values) return template
      return template.replace(/\{(\w+)(?:,[^}]*)?\}/g, (_, key) =>
        values[key] != null ? String(values[key]) : _
      )
    },
  }),
}))

import { render, screen } from '@testing-library/react'
import { FragmentTrustBadge } from '@/app/workspace/[workspaceUrl]/components/memory/FragmentTrustBadge'

function renderBadge(
  verdict: Parameters<typeof FragmentTrustBadge>[0]['verdict']
) {
  return render(<FragmentTrustBadge verdict={verdict} />)
}

describe('FragmentTrustBadge', () => {
  it('renders nothing for an undefined verdict', () => {
    const { container } = renderBadge(undefined)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the percentage and the usage tooltip for a strong verdict', () => {
    renderBadge({ kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 })
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByTitle(/real-usage signal/)).toBeInTheDocument()
  })

  it('marks a presence verdict as weak', () => {
    renderBadge({ kind: 'presence', resolvedTasks: 4, mergedTasks: 1, pct: 25 })
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByTitle(/weak signal/)).toBeInTheDocument()
  })
})
