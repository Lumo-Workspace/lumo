/** @jest-environment jsdom */
/**
 * LUM-489: Acceptance tab simplification + zone tooltips.
 * - drops the redundant top total-count meta line
 * - drops the "· read-only" machine-zone decoration and the human-zone "/ 7" quota
 * - adds InfoTooltip explanations to the machine and human zone headers
 */
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

// The tab leads with the shared header VerdictDecision; stub it to keep this
// suite focused on the contract zone (and avoid its next/navigation subtree).
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({
    VerdictDecision: () => <div data-testid='verdict-status' />,
  })
)

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'

const mockUseTaskStatus = useTaskStatus as jest.Mock

function statusView(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-489', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [
      {
        id: 'm1',
        statement: 'jest green',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest',
        evidenceRequired: false,
        source: 'AGENT_DRAFT',
        addedAtRound: 0,
        latestVerdict: null,
        changeState: null,
        changedAtRound: null,
        lastEdit: null,
      },
      {
        id: 'h1',
        statement: 'UX feels right',
        verifierType: 'HUMAN',
        checkpointer: null,
        evidenceRequired: false,
        source: 'HUMAN_EDIT',
        addedAtRound: 0,
        latestVerdict: null,
        changeState: null,
        changedAtRound: null,
        lastEdit: null,
      },
    ],
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

function renderAcceptanceTab() {
  mockUseTaskStatus.mockReturnValue({
    data: statusView(),
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
  return render(
    <AcceptanceTab
      taskIdentifier='LUM-489'
      enabled
      onVerdictRecorded={jest.fn()}
    />
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Acceptance tab — simplification', () => {
  it('does not render the redundant top total-count line', () => {
    renderAcceptanceTab()
    expect(screen.queryByText(/MACHINE \/ \d+ HUMAN/)).not.toBeInTheDocument()
  })

  it('machine zone header no longer shows the "read-only" decoration word', () => {
    renderAcceptanceTab()
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument()
  })

  it('human zone header shows count without the "/ 7" quota decoration', () => {
    renderAcceptanceTab()
    expect(screen.queryByText(/\/\s*7/)).not.toBeInTheDocument()
  })
})

describe('Acceptance tab — zone tooltips', () => {
  it('machine zone has an info tooltip explaining machine verification', () => {
    renderAcceptanceTab()
    expect(
      screen.getByLabelText(
        'Machine criteria are checked by a checkpointer command and are read-only — they cannot be hand-edited.'
      )
    ).toBeInTheDocument()
  })

  it('human zone has an info tooltip explaining human judgment', () => {
    renderAcceptanceTab()
    expect(
      screen.getByLabelText(
        'Human criteria need a person to judge and sign off — they are not machine-checkable.'
      )
    ).toBeInTheDocument()
  })
})

// LUM-489 (Task 4): per-row term tooltips on CriterionRow.
function machineCriterion(over: Record<string, unknown> = {}) {
  return {
    id: 'mc1',
    statement: 'jest green',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest',
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
    ...over,
  }
}

function renderWithCriteria(criteria: Record<string, unknown>[]) {
  mockUseTaskStatus.mockReturnValue({
    data: statusView({ criteria }),
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
  return render(
    <AcceptanceTab
      taskIdentifier='LUM-489'
      enabled
      onVerdictRecorded={jest.fn()}
    />
  )
}

// LUM-489 (Task 6): tooltip explaining the per-criterion send-back action in
// the interactive (IN_REVIEW) VerdictControls. The HUMAN criterion in the
// default fixture is unverified, so its VerdictControls (pass + send-back)
// render. The InfoTooltip sits as a SIBLING next to the send-back button.
describe('Verdict action tooltips (send-back)', () => {
  it('send-back action carries an explanatory tooltip', () => {
    renderAcceptanceTab()
    // Each unverified criterion's VerdictControls carries its own send-back
    // tooltip; assert the explanatory label is present (one per criterion row).
    expect(
      screen.getAllByLabelText(
        'Reject this criterion and send the task back to the agent for another round.'
      ).length
    ).toBeGreaterThan(0)
  })

  it('the send-back tooltip is a sibling of the button, not nested inside it', () => {
    renderAcceptanceTab()
    const sendBack = screen.getByTestId('verdict-sendback-h1')
    expect(sendBack.querySelector('button')).toBeNull()
  })

  it('pass action carries an explanatory tooltip', () => {
    renderAcceptanceTab()
    expect(
      screen.getAllByLabelText('Mark this criterion met.').length
    ).toBeGreaterThan(0)
  })
})

describe('CriterionRow term tooltips', () => {
  it('human-override badge on a criterion has a tooltip', () => {
    // A MACHINE criterion currently passing without a checkpointer pass behind
    // it (machinePassed=false) is the canonical human override. It is not
    // machine-verified, so the machine zone is open by default.
    renderWithCriteria([
      machineCriterion({
        id: 'override-crit',
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          verifierType: 'HUMAN',
          evidencePointer: null,
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-06-13T00:00:00.000Z',
        },
        machinePassed: false,
      }),
    ])
    expect(
      screen.getByLabelText(
        'A person marked this criterion passed without a machine check confirming it.'
      )
    ).toBeInTheDocument()
  })

  it('evidence/checkpointer disclosure has a tooltip explaining the proof', () => {
    // A machine criterion with a checkpointer + passing machine evidence. Its
    // disclosure ("View check output") is collapsed by default; expand it.
    renderWithCriteria([
      machineCriterion({
        id: 'evidence-crit',
        checkpointer: 'npx jest',
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          verifierType: 'MACHINE',
          evidencePointer: 'cmd:npx jest#exit=0',
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-06-13T00:00:00.000Z',
        },
        machinePassed: true,
      }),
    ])
    // Zone may be collapsed (all verified) — open it, then expand the row.
    const zoneToggle = screen.getByRole('button', { name: /Machine-verified/ })
    if (zoneToggle.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(zoneToggle)
    }
    fireEvent.click(screen.getByRole('button', { name: /View check output/ }))
    expect(
      screen.getByLabelText(
        'The command (checkpointer) that was run to verify this criterion, and its exit code. Exit 0 means it passed.'
      )
    ).toBeInTheDocument()
  })

  it('stale-pass marker has a tooltip', () => {
    // A passing MACHINE criterion flagged stale (verdict predates an edit).
    renderWithCriteria([
      machineCriterion({
        id: 'stale-crit',
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          verifierType: 'MACHINE',
          evidencePointer: 'cmd:npx jest#exit=0',
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-06-13T00:00:00.000Z',
        },
        machinePassed: true,
        verdictStale: true,
      }),
    ])
    // A stale-but-verified machine crit collapses the zone — open it.
    const zoneToggle = screen.getByRole('button', { name: /Machine-verified/ })
    if (zoneToggle.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(zoneToggle)
    }
    expect(
      screen.getByLabelText(
        'This passed against an earlier version of the criterion. Re-run lumo verify to re-confirm.'
      )
    ).toBeInTheDocument()
  })
})
