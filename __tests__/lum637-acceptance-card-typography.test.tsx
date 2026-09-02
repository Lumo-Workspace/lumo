/** @jest-environment jsdom */
/**
 * LUM-637 — Acceptance 容器内卡片标题字体层级统一.
 *
 * The Acceptance container's five sibling cards (human zone · machine zone ·
 * boundary crossings · claim vs verification · evidence & audit trail) all
 * carry their title on the text-body-strong tier; text-title is reserved for
 * the top-level dossier group headers ("Acceptance", "Run report"). Claim vs
 * verification was the one card still on text-title — pin the tier so it
 * can't drift back up.
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
import type { TaskAcceptanceStatusView } from '@/app/workspace/[workspaceUrl]/types'

function statusView(): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-637', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    machineVerification: { total: 2, machineVerified: 2, humanOverridden: 0 },
    claim: { text: 'I unified the card typography.', source: 'AGENT' },
    // LUM-730: the card only renders on a mismatch.
    faithfulness: {
      state: 'OVERSTATED',
      verdict: 'OVERSTATED',
      evidence: [],
      reasoning: null,
      diffShas: [],
      prNumbers: [],
      judgedAt: '2026-06-20T12:00:00.000Z',
      judgedClaimAt: '2026-06-20T10:00:00.000Z',
    },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
  }
}

describe('LUM-637 · Acceptance card title typography', () => {
  it('claim vs verification header sits on text-body-strong, not text-title', () => {
    const { container } = render(<ClaimVsVerification data={statusView()} />)

    // The header row carries the shared sibling-card tier…
    const title = screen.getByText('Claim vs verification')
    const headerRow = title.closest('.text-body-strong')
    expect(headerRow).not.toBeNull()

    // …and nothing in the card escalates to the dossier-group tier.
    expect(container.querySelector('.text-title')).toBeNull()
  })
})
