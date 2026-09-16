/** @jest-environment jsdom */
/**
 * LUM-489: passive (non-IN_REVIEW) header simplification + human-override tip.
 * Renders the REAL VerdictDecision (the shared acceptance-tab suite stubs it),
 * so these live in their own file. Mirrors the VerdictDecision.test.tsx harness.
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
  AcceptanceVerdict,
} from '@/app/workspace/[workspaceUrl]/types'

let seq = 0

const crit = (
  v: AcceptanceVerdict | null,
  verifier: 'MACHINE' | 'HUMAN' = 'MACHINE',
  machinePassed = v === 'PASS' && verifier === 'MACHINE'
): TaskStatusCriterionView =>
  ({
    id: `c-${seq++}`,
    statement: 's',
    verifierType: verifier,
    checkpointer: verifier === 'MACHINE' ? 'cmd:test' : null,
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict: v
      ? {
          round: 1,
          verdict: v,
          verifierType: verifier,
          evidencePointer: null,
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: 'now',
        }
      : null,
    machinePassed,
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
    confirmedAt: null,
  }) as TaskStatusCriterionView

function baseData(
  status: string,
  criteria: TaskStatusCriterionView[] = [crit('PASS')]
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't', identifier: 'LUM-7', title: 'x', status },
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

describe('Verdict header — passive simplification', () => {
  it('passive header renders without the heavy tone-box card', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('DONE')}
        onVerdictRecorded={jest.fn()}
      />
    )
    const banner = screen.getByTestId('verdict-status-banner')
    expect(banner.className).not.toMatch(/rounded-lg/)
  })

  it('human-override term carries an explanatory tooltip', () => {
    // A MACHINE criterion passing without a checkpointer pass = human override.
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('DONE', [crit('PASS', 'MACHINE', false)])}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(
      screen.getByLabelText(
        'Passed because a person signed off — no machine check confirmed this criterion.'
      )
    ).toBeInTheDocument()
  })
})
