/** @jest-environment jsdom */
/**
 * LUM-489 (Task 6): tooltips explaining the human verdict actions on the
 * VerdictDecision header in review (IN_REVIEW) mode — the pass-with-follow-up
 * and fail action buttons. Each InfoTooltip is a SIBLING next to its button
 * (never nested inside it). Renders the REAL VerdictDecision; mirrors the
 * verdict-header-passive.test.tsx harness.
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

jest.mock('@/lib/api-client', () => ({
  tasksClient: { submitHumanVerdict: jest.fn() },
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(() => ({ crossings: [] })),
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { VerdictDecision } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const reviewCrit: TaskStatusCriterionView = {
  id: 'c-1',
  statement: 's',
  verifierType: 'HUMAN',
  checkpointer: null,
  evidenceRequired: false,
  judgeSteps: null,
  source: 'HUMAN_EDIT',
  addedAtRound: 0,
  latestVerdict: null,
  machinePassed: false,
  verdictStale: false,
  checkMismatch: false,
  changeState: null,
  changedAtRound: null,
  lastEdit: null,
} as unknown as TaskStatusCriterionView

function reviewData(): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't', identifier: 'LUM-7', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 5,
    escalated: false,
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    criteria: [reviewCrit],
  } as unknown as TaskAcceptanceStatusView
}

function renderReview() {
  return render(
    <VerdictDecision
      variant='header'
      taskIdentifier='LUM-7'
      data={reviewData()}
      onVerdictRecorded={jest.fn()}
    />
  )
}

describe('Verdict action tooltips', () => {
  it('pass-with-follow-up action carries an explanatory tooltip', () => {
    renderReview()
    expect(
      screen.getByLabelText(
        'Mark passed but leave a follow-up note — the task is accepted with a tracked loose end.'
      )
    ).toBeInTheDocument()
  })

  it('fail action carries an explanatory tooltip', () => {
    renderReview()
    expect(
      screen.getByLabelText(
        'Reject and send the task back — it cannot be marked Done until re-verified.'
      )
    ).toBeInTheDocument()
  })

  it('the action tooltips are siblings of their buttons, not nested inside them', () => {
    renderReview()
    // A button must never be a descendant of another button (DOM nesting).
    const followupButton = screen.getByTestId('verdict-followup')
    const failButton = screen.getByTestId('verdict-fail')
    expect(followupButton.querySelector('button')).toBeNull()
    expect(failButton.querySelector('button')).toBeNull()
  })

  it('pass action carries an explanatory tooltip', () => {
    renderReview()
    expect(
      screen.getByLabelText(
        'Accept the task as done — all criteria are met and it moves to completed.'
      )
    ).toBeInTheDocument()
  })
})
