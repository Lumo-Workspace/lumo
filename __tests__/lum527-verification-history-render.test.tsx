/** @jest-environment jsdom */
/**
 * LUM-527: the 验证记录 panel splits a round's machine verdicts from the agent
 * send-backs that share its round number. The LUM-522 case — round 1 = 5 MACHINE
 * PASS + 2 AGENT FAIL, round 2 = 5 MACHINE PASS — must render the round-1
 * headline as 5/5 (not the misleading 5/7) with a separate send-back sub-line.
 */
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
      msg = msg.replace(
        /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
        (_m, key, one, other) => {
          const n = Number(values?.[key] ?? 0)
          return (n === 1 ? one : other).replace('#', String(n))
        }
      )
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskStatus', () => ({
  useTaskStatus: jest.fn(),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(() => ({
    crossings: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
  })),
}))

jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    submitHumanVerdict: jest.fn().mockResolvedValue({}),
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
    reviseCriteria: jest.fn().mockResolvedValue({}),
  },
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({ VerdictDecision: () => <div data-testid='verdict-status' /> })
)

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'

const mockUseTaskStatus = useTaskStatus as jest.Mock

function verdict(
  criterionId: string,
  verifierType: 'MACHINE' | 'HUMAN' | 'AGENT',
  v: 'PASS' | 'FAIL'
) {
  return {
    criterionId,
    verdict: v,
    verifierType,
    evidencePointer: null,
    rejectionReason: v === 'FAIL' ? 'post-deploy funnel not working' : null,
    rejectionReasonEnum: null,
  }
}

// Round 1 mixes a 5/5 machine pass with a 2-criterion agent send-back; round 2
// is a clean machine re-run — exactly the LUM-522 history.
function lum522History() {
  const machine = ['c1', 'c2', 'c3', 'c4', 'c5'].map(id =>
    verdict(id, 'MACHINE', 'PASS')
  )
  return [
    {
      round: 1,
      recordedAt: '2026-06-15T07:17:00.000Z',
      passed: 5,
      failed: 2,
      verdicts: [
        ...machine,
        verdict('h1', 'AGENT', 'FAIL'),
        verdict('h2', 'AGENT', 'FAIL'),
      ],
    },
    {
      round: 2,
      recordedAt: '2026-06-15T17:19:00.000Z',
      passed: 5,
      failed: 0,
      verdicts: machine,
    },
  ]
}

function criterion(id: string, verifierType: 'MACHINE' | 'HUMAN') {
  return {
    id,
    statement: `${id} statement`,
    verifierType,
    checkpointer: verifierType === 'MACHINE' ? 'npx jest' : null,
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict: null,
    machinePassed: false,
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
    sendBackResolution: null,
  }
}

function renderTab() {
  mockUseTaskStatus.mockReturnValue({
    data: {
      version: 1,
      task: {
        id: 't1',
        identifier: 'LUM-522',
        title: 'x',
        status: 'IN_REVIEW',
      },
      currentRound: 2,
      maxRounds: 3,
      escalated: false,
      criteria: [
        criterion('c1', 'MACHINE'),
        criterion('c2', 'MACHINE'),
        criterion('c3', 'MACHINE'),
        criterion('c4', 'MACHINE'),
        criterion('c5', 'MACHINE'),
        criterion('h1', 'HUMAN'),
        criterion('h2', 'HUMAN'),
      ],
      machineVerification: { total: 5, machineVerified: 5, humanOverridden: 0 },
      removedCriteria: [],
      verificationHistory: lum522History(),
      lastRoundFailures: [],
      nextActions: [],
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
  const result = render(
    <AcceptanceTab
      taskIdentifier='LUM-522'
      enabled
      onVerdictRecorded={jest.fn()}
    />
  )
  // LUM-620: the verification record now lives inside the collapsed "Evidence &
  // audit trail" card — expand it so the round history is in the DOM.
  fireEvent.click(screen.getByText('Evidence & audit trail'))
  return result
}

beforeEach(() => jest.clearAllMocks())

describe('LUM-527 verification record — round split', () => {
  it('shows the machine headline as 5/5, never the misleading 5/7', () => {
    renderTab()
    expect(screen.getAllByText('5/5 passed')).toHaveLength(2)
    expect(screen.queryByText('5/7 passed')).not.toBeInTheDocument()
  })

  it('surfaces the agent send-back as its own sub-line', () => {
    renderTab()
    expect(screen.getByText('agent send-back · 2')).toBeInTheDocument()
  })

  it('labels round 1 as a machine check (not the generic label) now that the send-back is peeled off', () => {
    renderTab()
    expect(screen.getByText('round 1 · machine check')).toBeInTheDocument()
    expect(screen.queryByText('round 1')).not.toBeInTheDocument()
  })
})

// MINOR 2b — LUM-586: withdrawn badge in the verification history
describe('LUM-586 verification history — withdrawn badge', () => {
  function renderTabWithWithdrawn() {
    // One criterion: c1 in round 1 with withdrawn: true; c2 normal (no withdrawn)
    mockUseTaskStatus.mockReturnValue({
      data: {
        version: 1,
        task: {
          id: 't1',
          identifier: 'LUM-586',
          title: 'x',
          status: 'IN_REVIEW',
        },
        currentRound: 1,
        maxRounds: 3,
        escalated: false,
        criteria: [criterion('c1', 'MACHINE'), criterion('c2', 'MACHINE')],
        machineVerification: {
          total: 2,
          machineVerified: 2,
          humanOverridden: 0,
        },
        removedCriteria: [],
        verificationHistory: [
          {
            round: 1,
            recordedAt: '2026-06-25T10:00:00.000Z',
            passed: 2,
            failed: 0,
            verdicts: [
              { ...verdict('c1', 'MACHINE', 'PASS'), withdrawn: true },
              { ...verdict('c2', 'MACHINE', 'PASS') },
            ],
          },
        ],
        lastRoundFailures: [],
        nextActions: [],
      },
      loading: false,
      error: null,
      refresh: jest.fn(),
    })
    const result = render(
      <AcceptanceTab
        taskIdentifier='LUM-586'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    // LUM-620: expand the Evidence & audit trail card so the verdict rows mount
    fireEvent.click(screen.getByText('Evidence & audit trail'))
    // Expand round 1 so the verdict detail rows appear
    fireEvent.click(screen.getByRole('button', { name: /round 1/i }))
    return result
  }

  it('renders the withdrawn badge for a withdrawn verdict', () => {
    renderTabWithWithdrawn()
    // The withdrawn badge renders the i18n key
    expect(
      screen.getByText('task.verdict.historyWithdrawn')
    ).toBeInTheDocument()
  })

  it('does NOT render the withdrawn badge for a non-withdrawn verdict', () => {
    renderTabWithWithdrawn()
    // Only ONE badge exists (the withdrawn c1 one, not c2 which is normal)
    const badges = screen.getAllByText('task.verdict.historyWithdrawn')
    expect(badges).toHaveLength(1)
  })

  it('applies line-through styling to the withdrawn verdict row text', () => {
    renderTabWithWithdrawn()
    // The criterion statement may appear in multiple places (e.g. claim panel);
    // find specifically the verdict-row span with line-through class.
    const c1Candidates = screen.getAllByText('c1 statement')
    const c1Withdrawn = c1Candidates.find(el =>
      el.classList.contains('line-through')
    )
    expect(c1Withdrawn).toBeDefined()
    // c2 should NOT have any line-through instance
    const c2Candidates = screen.getAllByText('c2 statement')
    const c2Withdrawn = c2Candidates.find(el =>
      el.classList.contains('line-through')
    )
    expect(c2Withdrawn).toBeUndefined()
  })
})
