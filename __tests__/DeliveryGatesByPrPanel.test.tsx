import { render, screen, within } from '@testing-library/react'
import { DeliveryGatesByPrPanel } from '@/app/workspace/[workspaceUrl]/components/DeliveryGatesByPrPanel'
import type { PerPrGateAudit } from '@/lib/services/gate-audit'

const messages: Record<string, string> = {
  'gates.status.passed': 'passed',
  'gates.status.failed': 'failed',
  'gates.status.did_not_run': 'did not run',
  'gates.ci.title': 'CI checks (independent)',
  'gates.ci.none': 'No CI checks reported for commit {sha}',
  'gates.ci.noneNoCommit': 'No CI checks reported',
  'gates.ci.details': 'details',
  'gates.self.title': 'Agent self-reported',
  'gates.self.none': 'No check commands recorded from the agent',
  'gates.self.exit': 'exit {code}',
  'gates.unlinked': 'unlinked signals',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, string | number>
    ) =>
      (messages[id] ?? id).replace(/\{(\w+)\}/g, (_, k: string) =>
        String(values?.[k] ?? '')
      ),
  }),
}))

const PER_PR: PerPrGateAudit = {
  prs: [
    {
      pr: {
        number: 756,
        title: 'read GitHub CI',
        state: 'in_review',
        headBranch: 'lumo/LUM-616',
        headSha: 'deadbeefcafe',
      },
      audit: { headSha: 'deadbeefcafe', ci: [], selfReported: [] },
    },
    {
      pr: {
        number: 754,
        title: 'strip quotes',
        state: 'merged',
        headBranch: 'lumo/LUM-614-fix',
        headSha: 'abc1234',
      },
      audit: {
        headSha: 'abc1234',
        ci: [
          {
            name: 'e2e',
            status: 'did_not_run',
            source: 'github_check',
            detailsUrl: null,
            at: '2026-06-28T10:00:00.000Z',
          },
          {
            name: 'Vercel',
            status: 'passed',
            source: 'github_check',
            detailsUrl: 'https://vercel.com/deploy/1',
            at: '2026-06-28T10:00:00.000Z',
          },
        ],
        selfReported: [
          {
            command: 'npx jest __tests__/x.test.ts',
            status: 'failed',
            exitCode: 1,
            at: '2026-06-28T09:00:00.000Z',
          },
        ],
      },
    },
  ],
  unlinked: {
    headSha: null,
    ci: [],
    selfReported: [
      {
        command: 'npm test',
        status: 'passed',
        exitCode: 0,
        at: '2026-06-28T08:00:00.000Z',
      },
    ],
  },
}

describe('DeliveryGatesByPrPanel', () => {
  it('renders CI checks by name and self-reported checks separately', () => {
    render(<DeliveryGatesByPrPanel perPr={PER_PR} />)

    expect(screen.getAllByTestId(/^pr-gate-row-\d+$/)).toHaveLength(2)
    expect(screen.getByText('#756')).toBeInTheDocument()

    // PR 754: CI checks listed by their own names, with status + details link.
    const pr754 = screen.getByTestId('pr-gate-row-754')
    const ci = within(pr754).getByTestId('ci-checks')
    expect(within(ci).getByText('CI checks (independent)')).toBeInTheDocument()
    const vercel = within(ci)
      .getAllByTestId('ci-check')
      .find(el => el.getAttribute('data-name') === 'Vercel')!
    expect(vercel).toHaveTextContent('passed')
    expect(
      within(vercel).getByRole('link', { name: 'details' })
    ).toHaveAttribute('href', 'https://vercel.com/deploy/1')
    const e2e = within(ci)
      .getAllByTestId('ci-check')
      .find(el => el.getAttribute('data-name') === 'e2e')!
    expect(e2e).toHaveTextContent('did not run')
    expect(e2e).not.toHaveTextContent('failed')

    // The agent's own run is in a separately labelled self-reported list.
    const self = within(pr754).getByTestId('self-reported-checks')
    expect(within(self).getByText('Agent self-reported')).toBeInTheDocument()
    expect(
      within(self).getByText('npx jest __tests__/x.test.ts')
    ).toBeInTheDocument()
    expect(within(self).getByText('exit 1')).toBeInTheDocument()
    expect(within(ci).queryByText(/npx jest/)).not.toBeInTheDocument()

    // PR 756 has no CI checks on its head: said explicitly, nothing green.
    const pr756 = screen.getByTestId('pr-gate-row-756')
    expect(within(pr756).getByTestId('ci-checks-none')).toHaveTextContent(
      'No CI checks reported for commit deadbee'
    )
    expect(within(pr756).queryByText('passed')).not.toBeInTheDocument()
    expect(within(pr756).getByTestId('self-reported-none')).toBeInTheDocument()

    // No fixed typecheck/build/test columns any more.
    for (const key of ['typecheck', 'build', 'test']) {
      expect(screen.queryByTestId(`gate-col-${key}`)).not.toBeInTheDocument()
    }

    // The unlinked bucket shows its own lists; no commit known → plain wording.
    const unlinked = screen.getByTestId('gate-unlinked-bucket')
    expect(within(unlinked).getByTestId('ci-checks-none')).toHaveTextContent(
      'No CI checks reported'
    )
    expect(within(unlinked).getByText('npm test')).toBeInTheDocument()
  })

  it('omits the unlinked bucket when there are no unresolved signals', () => {
    render(
      <DeliveryGatesByPrPanel perPr={{ prs: PER_PR.prs, unlinked: null }} />
    )
    expect(screen.queryByTestId('gate-unlinked-bucket')).not.toBeInTheDocument()
  })
})
