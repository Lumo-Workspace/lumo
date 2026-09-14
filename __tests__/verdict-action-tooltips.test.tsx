/** @jest-environment jsdom */
/**
 * LUM-492: tooltips explaining the human verdict actions on the VerdictDecision
 * header in review (IN_REVIEW) mode. The PASS and FAIL buttons are themselves
 * the tooltip triggers (via ActionTooltip) — hovering or focusing a button
 * reveals its explanation, with no separate `ⓘ` sibling and no nested button.
 * The pass-with-follow-up action was removed entirely. Renders the REAL
 * VerdictDecision; mirrors the verdict-header-passive.test.tsx harness.
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
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/my-tasks/LUM-1',
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { VerdictDecision } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  // jsdom has no ResizeObserver; Radix tooltip arrow uses it for sizing.
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

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
  it('the pass-with-follow-up action is gone', () => {
    renderReview()
    expect(screen.queryByTestId('verdict-followup')).toBeNull()
  })

  it('pass button is its own tooltip trigger (no nested button, no separate ⓘ)', () => {
    renderReview()
    const pass = screen.getByTestId('verdict-pass')
    expect(pass.tagName).toBe('BUTTON')
    expect(pass.querySelector('button')).toBeNull()
  })

  it('fail button is its own tooltip trigger (no nested button)', () => {
    renderReview()
    const fail = screen.getByTestId('verdict-fail')
    expect(fail.querySelector('button')).toBeNull()
  })

  it('pass tip is reachable by focusing the button', async () => {
    renderReview()
    screen.getByTestId('verdict-pass').focus()
    expect(
      await screen.findAllByText(
        'Accept the task as done — all criteria are met and it moves to completed.'
      )
    ).not.toHaveLength(0)
  })

  it('fail tip is reachable by focusing the button', async () => {
    renderReview()
    screen.getByTestId('verdict-fail').focus()
    expect(
      await screen.findAllByText(
        'Reject and send the task back — it cannot be marked Done until re-verified.'
      )
    ).not.toHaveLength(0)
  })
})
