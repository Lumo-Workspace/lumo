/** @jest-environment jsdom */
/**
 * LUM-583 — the honest-report Claim-vs-verification section renders the claim
 * faithfulness third state: a chip for each of the four judged verdicts plus
 * PENDING and STALE, an evidence pointer to the diff/PR, and — coordinating with
 * the LUM-574 pending state — a 'generating' message instead of the raw turn
 * digest when no formal run summary exists yet.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { ClaimVsVerification } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/HonestReportSections'
import type {
  TaskAcceptanceStatusView,
  TaskClaimFaithfulnessView,
} from '@/app/workspace/[workspaceUrl]/types'

function faithfulness(
  over: Partial<TaskClaimFaithfulnessView> = {}
): TaskClaimFaithfulnessView {
  return {
    state: 'FAITHFUL',
    verdict: 'FAITHFUL',
    evidence: [],
    reasoning: null,
    diffShas: [],
    prNumbers: [],
    judgedAt: '2026-06-20T12:00:00.000Z',
    judgedClaimAt: '2026-06-20T10:00:00.000Z',
    ...over,
  }
}

function statusView(
  over: Partial<TaskAcceptanceStatusView> = {}
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-583', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    claim: { text: 'Implemented the retry path.', source: 'RUN_SUMMARY' },
    // LUM-730: the section only exists on a mismatch — default the fixture to
    // OVERSTATED so the chip / evidence / claim-text assertions have a section.
    faithfulness: faithfulness({ state: 'OVERSTATED', verdict: 'OVERSTATED' }),
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

describe('ClaimVsVerification — faithfulness chip (LUM-583)', () => {
  // LUM-730: only the two mismatch verdicts render a section (and so a chip);
  // the quiet states below render nothing at all.
  const cases: Array<{
    state: TaskClaimFaithfulnessView['state']
    verdict: TaskClaimFaithfulnessView['verdict']
    label: RegExp
  }> = [
    { state: 'OVERSTATED', verdict: 'OVERSTATED', label: /Overstated/ },
    { state: 'UNDERREPORT', verdict: 'UNDERREPORT', label: /Under-reported/ },
  ]

  it.each(cases)(
    'renders a chip for the %s state',
    ({ state, verdict, label }) => {
      render(
        <ClaimVsVerification
          data={statusView({ faithfulness: faithfulness({ state, verdict }) })}
        />
      )
      const row = screen.getByTestId('faithfulness-row')
      expect(row).toHaveAttribute('data-faithfulness-state', state)
      expect(within(row).getByTestId('faithfulness-chip')).toHaveTextContent(
        label
      )
    }
  )

  const quiet: Array<{
    state: TaskClaimFaithfulnessView['state']
    verdict: TaskClaimFaithfulnessView['verdict']
  }> = [
    { state: 'FAITHFUL', verdict: 'FAITHFUL' },
    { state: 'UNJUDGEABLE', verdict: 'UNJUDGEABLE' },
    { state: 'PENDING', verdict: null },
  ]

  it.each(quiet)(
    'renders no section at all for the quiet %s state (LUM-730)',
    ({ state, verdict }) => {
      const { container } = render(
        <ClaimVsVerification
          data={statusView({ faithfulness: faithfulness({ state, verdict }) })}
        />
      )
      expect(container.innerHTML).toBe('')
      expect(screen.queryByTestId('faithfulness-row')).toBeNull()
    }
  )

  it('STALE keeps the underlying verdict visible with a re-judge marker, distinct from PENDING', () => {
    render(
      <ClaimVsVerification
        data={statusView({
          faithfulness: faithfulness({ state: 'STALE', verdict: 'OVERSTATED' }),
        })}
      />
    )
    const row = screen.getByTestId('faithfulness-row')
    expect(row).toHaveAttribute('data-faithfulness-state', 'STALE')
    const chip = within(row).getByTestId('faithfulness-chip')
    expect(chip).toHaveTextContent(/Overstated/)
    expect(chip).toHaveTextContent(/stale/)
  })

  it('renders an evidence pointer to the diff/PR when present', () => {
    render(
      <ClaimVsVerification
        data={statusView({
          faithfulness: faithfulness({
            state: 'OVERSTATED',
            verdict: 'OVERSTATED',
            diffShas: ['a1b2c3d4e5', 'ffeeddcc'],
            prNumbers: [710, 711],
          }),
        })}
      />
    )
    const ev = screen.getByTestId('faithfulness-evidence')
    expect(ev).toHaveTextContent('PR #710, #711')
    expect(ev).toHaveTextContent('a1b2c3d') // 7-char short sha
  })

  it('omits the evidence pointer when the verdict cited nothing', () => {
    // LUM-730: a mismatch verdict (so the section renders) that cited no
    // diff / PR — the pointer line stays absent while the chip is present.
    render(
      <ClaimVsVerification
        data={statusView({
          faithfulness: faithfulness({
            state: 'UNDERREPORT',
            verdict: 'UNDERREPORT',
            diffShas: [],
            prNumbers: [],
          }),
        })}
      />
    )
    expect(screen.getByTestId('faithfulness-chip')).toBeInTheDocument()
    expect(screen.queryByTestId('faithfulness-evidence')).toBeNull()
  })

  it('shows a generating message instead of the raw turn digest (LUM-574 coordination)', () => {
    render(
      <ClaimVsVerification
        data={statusView({
          claim: {
            text: 'explored the repo · read foo.ts · no changes',
            source: 'DIGEST',
          },
          // LUM-730: a stale mismatch keeps the section on screen while the
          // formal summary is still being synthesized.
          faithfulness: faithfulness({ state: 'STALE', verdict: 'OVERSTATED' }),
        })}
      />
    )
    expect(screen.getByText(/still being synthesized/)).toBeInTheDocument()
    // The raw digest text must NOT be dumped into the claim card.
    expect(screen.queryByText(/explored the repo/)).toBeNull()
  })

  it('renders the RUN_SUMMARY claim text as before', () => {
    render(
      <ClaimVsVerification
        data={statusView({
          claim: {
            text: 'Implemented the retry path and added tests.',
            source: 'RUN_SUMMARY',
          },
        })}
      />
    )
    expect(
      screen.getByText(/Implemented the retry path and added tests/)
    ).toBeInTheDocument()
  })

  it('renders nothing extra when an older server omits faithfulness', () => {
    // Omit the key entirely (older server) — not an explicit undefined, which
    // exactOptionalPropertyTypes forbids on an optional field.
    // LUM-730: no faithfulness is no mismatch — the whole section is absent.
    const { faithfulness: _omitted, ...older } = statusView()
    const { container } = render(<ClaimVsVerification data={older} />)
    expect(screen.queryByTestId('faithfulness-row')).toBeNull()
    expect(container.innerHTML).toBe('')
  })
})
