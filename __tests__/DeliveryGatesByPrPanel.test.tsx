import { render, screen, within } from '@testing-library/react'
import { DeliveryGatesByPrPanel } from '@/app/workspace/[workspaceUrl]/components/DeliveryGatesByPrPanel'
import type {
  PerPrGateAudit,
  DeliveryGateAudit,
} from '@/lib/services/gate-audit'

const messages: Record<string, string> = {
  'gates.title': 'Mechanical gates',
  'gates.auditTag': 'audit',
  'gates.guardrail.verdict':
    'Verifies that checks ran, not that the work is correct',
  'gates.guardrail.adjudication': 'Adjudication lives in the acceptance tab',
  'gates.status.passed': 'passed',
  'gates.status.failed': 'failed',
  'gates.status.not_run': 'not run',
  'gates.status.not_configured': 'not configured',
  'gates.provenance.independent_harness': 'independent harness',
  'gates.provenance.agent_self_reported': 'agent self-reported',
  'gates.unlinked': 'unlinked signals',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

function auditOf(
  states: Partial<
    Record<
      'typecheck' | 'build' | 'test',
      DeliveryGateAudit['gates'][number]['status']
    >
  >
): DeliveryGateAudit {
  const keys = ['typecheck', 'build', 'test'] as const
  return {
    gates: keys.map(key => ({
      key,
      status: states[key] ?? 'not_run',
      provenance: 'agent_self_reported',
      grounding: null,
    })),
  }
}

const PER_PR: PerPrGateAudit = {
  prs: [
    {
      pr: {
        number: 756,
        title: 'read GitHub CI',
        state: 'in_review',
        headBranch: 'lumo/LUM-616',
      },
      audit: auditOf({ build: 'passed' }),
    },
    {
      pr: {
        number: 754,
        title: 'strip quotes',
        state: 'merged',
        headBranch: 'lumo/LUM-614-fix',
      },
      audit: auditOf({ typecheck: 'passed', build: 'passed', test: 'failed' }),
    },
  ],
  unlinked: auditOf({ test: 'passed' }),
}

describe('DeliveryGatesByPrPanel', () => {
  it('renders one row per pull request with gate columns', () => {
    render(<DeliveryGatesByPrPanel perPr={PER_PR} />)

    // One row per PR.
    const rows = screen.getAllByTestId(/^pr-gate-row-\d+$/)
    expect(rows).toHaveLength(2)

    // Each PR is identified by its number.
    expect(screen.getByText('#756')).toBeInTheDocument()
    expect(screen.getByText('#754')).toBeInTheDocument()

    // The three execution-gate columns are present.
    for (const key of ['typecheck', 'build', 'test']) {
      expect(screen.getByTestId(`gate-col-${key}`)).toBeInTheDocument()
    }

    // PR 754's cells reflect its own gate states (a failed test is surfaced).
    const pr754 = screen.getByTestId('pr-gate-row-754')
    expect(within(pr754).getByTestId('cell-test')).toHaveTextContent('failed')
    expect(within(pr754).getByTestId('cell-typecheck')).toHaveTextContent(
      'passed'
    )

    // The unlinked bucket shows because there are unresolved signals.
    expect(screen.getByTestId('gate-unlinked-bucket')).toBeInTheDocument()
  })

  it('omits the unlinked bucket when there are no unresolved signals', () => {
    render(
      <DeliveryGatesByPrPanel perPr={{ prs: PER_PR.prs, unlinked: null }} />
    )
    expect(screen.queryByTestId('gate-unlinked-bucket')).not.toBeInTheDocument()
  })
})
