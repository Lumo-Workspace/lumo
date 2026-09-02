/** @jest-environment jsdom */
/**
 * LUM-597 — Claim-vs-Verification UX 重排 (decision-first).
 *
 * Verification is the framed main block (what the reviewer decides on); the
 * claim collapses to a single "reality check" line whose headline IS the
 * faithfulness conclusion, with a provenance label that tells AGENT (the
 * agent's own self-report) apart from SYNTHESIZED (a summarizer paraphrase).
 * When there is no claim at all the whole row disappears — no empty box.
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
import { render, screen } from '@testing-library/react'
import { ClaimVsVerification } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/HonestReportSections'
import type {
  TaskAcceptanceStatusView,
  TaskClaimFaithfulnessView,
  TaskClaimView,
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
    task: { id: 't1', identifier: 'LUM-597', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    machineVerification: { total: 2, machineVerified: 2, humanOverridden: 0 },
    claim: { text: 'I added the AGENT source.', source: 'AGENT' },
    // LUM-730: the section only exists on a mismatch, so the fixture rides on
    // an OVERSTATED verdict — the layering assertions below need it rendered.
    faithfulness: faithfulness({ state: 'OVERSTATED', verdict: 'OVERSTATED' }),
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

const AGENT_CLAIM: TaskClaimView = {
  text: 'I added the AGENT source.',
  source: 'AGENT',
}
const SYNTH_CLAIM: TaskClaimView = {
  text: 'Implemented the retry path.',
  source: 'RUN_SUMMARY',
}

describe('LUM-597 · Claim-vs-Verification UX', () => {
  it('collapses the claim row when there is no claim and labels AGENT vs SYNTHESIZED provenance', () => {
    // ── No claim → the whole reality-check row disappears (no empty box). ──
    // LUM-730: with nothing to compare there is no mismatch, so the entire
    // section — verification block included — is absent, not just the row.
    const { faithfulness: _f, ...noFaith } = statusView({
      claim: { text: null, source: null },
    })
    const { rerender } = render(<ClaimVsVerification data={noFaith} />)
    expect(screen.queryByTestId('claim-reality-check')).toBeNull()
    expect(screen.queryByTestId('verification-main')).toBeNull()

    // ── AGENT claim → provenance reads as the agent's own self-report. ──
    rerender(<ClaimVsVerification data={statusView({ claim: AGENT_CLAIM })} />)
    const agentRow = screen.getByTestId('claim-reality-check')
    expect(screen.getByTestId('claim-provenance')).toHaveTextContent(
      /self-report/i
    )
    expect(screen.getByTestId('claim-provenance')).not.toHaveTextContent(
      /synthesized/i
    )

    // ── RUN_SUMMARY claim → provenance reads as a synthesized paraphrase. ──
    rerender(<ClaimVsVerification data={statusView({ claim: SYNTH_CLAIM })} />)
    expect(screen.getByTestId('claim-provenance')).toHaveTextContent(
      /synthesized/i
    )
    expect(agentRow).toBeDefined()
  })

  it('makes the faithfulness conclusion the headline of the claim line', () => {
    render(
      <ClaimVsVerification
        data={statusView({
          claim: AGENT_CLAIM,
          faithfulness: faithfulness({
            state: 'OVERSTATED',
            verdict: 'OVERSTATED',
          }),
        })}
      />
    )
    // The faithfulness chip rides INSIDE the claim reality-check row — it is the
    // headline conclusion, not a footnote under a co-equal claim box.
    const row = screen.getByTestId('claim-reality-check')
    const chip = screen.getByTestId('faithfulness-chip')
    expect(row).toContainElement(chip)
    expect(chip).toHaveTextContent(/Overstated/)
  })
})
