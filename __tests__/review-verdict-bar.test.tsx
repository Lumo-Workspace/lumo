/** @jest-environment jsdom */
/**
 * LUM-529: the floating verdict bar moved out of TimelineTabs to the top of the
 * task page. ReviewVerdictBar owns the gate (IN_REVIEW + hasCriteria) and the
 * status fetch. This locks that gate — the bar shows only when a reviewer has
 * something to adjudicate, and renders nothing otherwise.
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

const mockUseTaskStatus = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskStatus', () => ({
  useTaskStatus: (opts: unknown) => mockUseTaskStatus(opts),
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { ReviewVerdictBar } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ReviewVerdictBar'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

afterEach(() => mockUseTaskStatus.mockReset())

const passCriterion = {
  id: 'c-0',
  statement: 's',
  verifierType: 'MACHINE',
  checkpointer: 'cmd:test',
  evidenceRequired: false,
  judgeSteps: null,
  source: 'AGENT_DRAFT',
  addedAtRound: 0,
  latestVerdict: {
    round: 1,
    verdict: 'PASS',
    verifierType: 'MACHINE',
    evidencePointer: null,
    rejectionReason: null,
    rejectionReasonEnum: null,
    recordedAt: 'now',
  },
  machinePassed: true,
  verdictStale: false,
  checkMismatch: false,
  changeState: null,
  changedAtRound: null,
  lastEdit: null,
  confirmedAt: null,
} as unknown as TaskStatusCriterionView

function statusData(
  taskStatus: string,
  criteria: TaskStatusCriterionView[] = [passCriterion]
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't', identifier: 'LUM-7', title: 'x', status: taskStatus },
    currentRound: 1,
    maxRounds: 5,
    escalated: false,
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    criteria,
  } as unknown as TaskAcceptanceStatusView
}

const setStatus = (data: TaskAcceptanceStatusView | null) =>
  mockUseTaskStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })

describe('ReviewVerdictBar', () => {
  it('ReviewVerdictBar shows the verdict bar only when IN_REVIEW with criteria', () => {
    // 1) IN_REVIEW + criteria → bar shows.
    setStatus(statusData('IN_REVIEW'))
    const { rerender } = render(
      <ReviewVerdictBar taskIdentifier='LUM-7' onVerdictRecorded={jest.fn()} />
    )
    expect(screen.getByTestId('verdict-status')).toBeInTheDocument()

    // 2) Not IN_REVIEW → nothing.
    setStatus(statusData('IN_PROGRESS'))
    rerender(
      <ReviewVerdictBar taskIdentifier='LUM-7' onVerdictRecorded={jest.fn()} />
    )
    expect(screen.queryByTestId('verdict-status')).not.toBeInTheDocument()

    // 3) IN_REVIEW but no criteria → nothing.
    setStatus(statusData('IN_REVIEW', []))
    rerender(
      <ReviewVerdictBar taskIdentifier='LUM-7' onVerdictRecorded={jest.fn()} />
    )
    expect(screen.queryByTestId('verdict-status')).not.toBeInTheDocument()

    // 4) Status not loaded yet → nothing (no crash on null data).
    setStatus(null)
    rerender(
      <ReviewVerdictBar taskIdentifier='LUM-7' onVerdictRecorded={jest.fn()} />
    )
    expect(screen.queryByTestId('verdict-status')).not.toBeInTheDocument()
  })
})
