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
import { render, screen } from '@testing-library/react'
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
