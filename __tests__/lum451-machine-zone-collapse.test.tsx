/** @jest-environment jsdom */
/**
 * LUM-451: the machine-verified zone in the acceptance tab is collapsible with a
 * smart default — collapsed when every machine criterion passes, expanded when
 * any is FAIL or unjudged; the header toggle flips it.
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

// LUM-467: the tab leads with the shared header VerdictDecision — stub it so this
// machine-zone-fold suite isn't coupled to its subtree.
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

const PASS = {
  round: 1,
  verdict: 'PASS',
  verifierType: 'MACHINE',
  evidencePointer: 'cmd:x#exit=0',
  rejectionReason: null,
  rejectionReasonEnum: null,
  recordedAt: '2026-06-12T00:00:00Z',
}
const FAIL = { ...PASS, verdict: 'FAIL', rejectionReason: 'boom' }

function machine(id: string, statement: string, latestVerdict: unknown) {
  return {
    id,
    statement,
    verifierType: 'MACHINE',
    checkpointer: 'npx jest',
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict,
    // These verdicts are all MACHINE-authored, so a PASS IS a checkpointer pass
    // (LUM-456): machinePassed tracks the latest MACHINE verdict being a PASS.
    machinePassed:
      (latestVerdict as { verdict?: string } | null)?.verdict === 'PASS',
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
  }
}
function humanRow(id: string, statement: string) {
  return {
    id,
    statement,
    verifierType: 'HUMAN',
    checkpointer: null,
    evidenceRequired: false,
    source: 'HUMAN_EDIT',
    addedAtRound: 0,
    latestVerdict: null,
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
  }
}
function setView(machineCriteria: unknown[]) {
  mockUseTaskStatus.mockReturnValue({
    data: {
      version: 1,
      task: {
        id: 't1',
        identifier: 'LUM-451',
        title: 'x',
        status: 'IN_REVIEW',
      },
      currentRound: 1,
      maxRounds: 3,
      escalated: false,
      criteria: [...machineCriteria, humanRow('h1', 'human judgment call')],
      removedCriteria: [],
      verificationHistory: [],
      lastRoundFailures: [],
      nextActions: [],
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

const zoneToggle = () =>
  screen.getByRole('button', { name: /Machine-verified/i })

describe('machine zone collapsible smart default', () => {
  it('machine zone collapsible smart default — collapsed when all machine criteria pass', () => {
    setView([
      machine('m1', 'machine check alpha', PASS),
      machine('m2', 'machine check beta', PASS),
    ])
    render(
      <AcceptanceTab
        taskIdentifier='LUM-451'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByText('machine check alpha')).toBeNull()
    expect(zoneToggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/All 2 machine-verified/i)).toBeInTheDocument()
  })

  it('machine zone collapsible smart default — expanded when a machine criterion fails', () => {
    setView([
      machine('m1', 'machine check alpha', PASS),
      machine('m2', 'machine check beta', FAIL),
    ])
    render(
      <AcceptanceTab
        taskIdentifier='LUM-451'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByText('machine check alpha')).toBeInTheDocument()
    expect(zoneToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/1 machine-verified/)).toBeInTheDocument()
  })

  it('an unjudged machine criterion is surfaced (now as the NEEDS ACTION card, never folded away)', () => {
    // LUM-496: the smart default's purpose — never hide a check that still
    // blocks Done — is now carried by the zone split: with nothing verified
    // there is no Machine-verified record card at all, and the unjudged row
    // sits, always visible, in the NEEDS ACTION card.
    setView([machine('m1', 'machine check alpha', null)])
    render(
      <AcceptanceTab
        taskIdentifier='LUM-451'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByText('machine check alpha')).toBeInTheDocument()
    const awaiting = screen.getByTestId('record-machine-awaiting')
    expect(awaiting).toContainElement(screen.getByText('machine check alpha'))
    expect(
      screen.queryByRole('button', { name: /Machine-verified/i })
    ).toBeNull()
  })

  it('machine zone collapsible smart default — header toggle flips state', () => {
    setView([machine('m1', 'machine check alpha', PASS)])
    render(
      <AcceptanceTab
        taskIdentifier='LUM-451'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByText('machine check alpha')).toBeNull()
    fireEvent.click(zoneToggle())
    expect(screen.getByText('machine check alpha')).toBeInTheDocument()
    fireEvent.click(zoneToggle())
    expect(screen.queryByText('machine check alpha')).toBeNull()
  })
})
