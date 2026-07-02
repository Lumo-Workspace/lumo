/** @jest-environment jsdom */

// react-intl ships pure ESM and can't be transformed by jest without special
// config. Mock it the same way other component tests in this project do.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      const template = defaultMessage ?? id
      if (!values) return template
      return `${template} ${Object.entries(values)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ')}`
    },
  }),
}))

import { render, screen } from '@testing-library/react'
import { MilestoneOutcomeSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOutcomeSection'
import type { ApiMilestone } from '@/lib/api-client/milestones'

type Outcome = NonNullable<ApiMilestone['outcome']>

function outcome(over: Partial<Outcome> = {}): Outcome {
  return {
    claims: [],
    fate: { doneCount: 0, rejected: [], inconclusiveCount: 0 },
    ...over,
  }
}

describe('MilestoneOutcomeSection', () => {
  it('renders nothing when the detail response carries no outcome enrichment', () => {
    const { container } = render(<MilestoneOutcomeSection outcome={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the section with an explicit empty state when the milestone has no DONE tasks (section not hidden)', () => {
    render(<MilestoneOutcomeSection outcome={outcome()} />)
    expect(screen.getByText('milestone.outcome.title')).toBeInTheDocument()
    expect(screen.getByText('milestone.outcome.empty')).toBeInTheDocument()
  })

  it('renders claim rows (with source tag), an explicit no-claim row, and the well fate rollup', () => {
    render(
      <MilestoneOutcomeSection
        outcome={outcome({
          claims: [
            {
              taskId: 't1',
              ref: 'LUM-283',
              title: 'Bundle diet',
              claim: '首屏 -298KB',
              source: 'AGENT',
            },
            {
              taskId: 't2',
              ref: 'LUM-290',
              title: 'No-claim delivery',
              claim: null,
              source: null,
            },
          ],
          fate: {
            doneCount: 2,
            rejected: [
              {
                taskId: 't1',
                ref: 'LUM-283',
                title: 'Bundle diet',
                kinds: [{ kind: 'REVERTED', count: 1 }],
              },
            ],
            inconclusiveCount: 1,
          },
        })}
      />
    )

    // Hard results: the frozen claim + its provenance tag.
    expect(screen.getByText('首屏 -298KB')).toBeInTheDocument()
    expect(
      screen.getByText('milestone.outcome.claims.source.AGENT')
    ).toBeInTheDocument()
    // The claim-less DONE task is explicitly present, not silently dropped.
    expect(
      screen.getByText('milestone.outcome.claims.noClaim')
    ).toBeInTheDocument()
    // Fate rollup: summary line + per-rejection kind breakdown.
    expect(
      screen.getByText(
        /milestone\.outcome\.fate\.summary.*rejected=1.*done=2.*inconclusive=1/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/milestone\.outcome\.fate\.kind\.REVERTED.*count=1/)
    ).toBeInTheDocument()
    expect(screen.getAllByText('LUM-283')).toHaveLength(2)
  })
})
