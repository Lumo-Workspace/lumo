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

  it('renders the usefulness percentage and the judged-used tooltip for a proven verdict', () => {
    renderBadge({
      judgedUsedTasks: 4,
      auditedTasks: 5,
      appearanceTasks: 7,
      usefulnessPct: 80,
      qualified: true,
    })
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByTitle(/judged-used track record/)).toBeInTheDocument()
  })

  it('marks an unproven verdict', () => {
    const { container } = renderBadge({
      judgedUsedTasks: 1,
      auditedTasks: 5,
      appearanceTasks: 7,
      usefulnessPct: 20,
      qualified: false,
    })
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(container.textContent).toContain('unproven')
  })
})
