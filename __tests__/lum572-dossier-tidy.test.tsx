/** @jest-environment jsdom */
/**
 * LUM-572 — tidy the task-detail dossier. Two structural behaviours:
 *  1. the five trailing report sections (Verification history / Cost / Struggle
 *     / Trend / Removed) fold into one collapsible "Run report" group, collapsed
 *     by default; the decision surface, criteria and boundary panel stay above it.
 *  2. a collapsed boundary-crossing row shows only its severity + disposition;
 *     the reversibility and recurrence chips it used to pile inline move into the
 *     expanded detail.
 *
 * This supersedes LUM-567's "③ cost-and-risk open by default" reading — cost now
 * lives inside the collapsed Run-report group. The LUM-566 same-source suite is
 * updated in lockstep to expand the group before asserting on cost/struggle/trend.
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
  },
}))

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
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
import type { TaskAcceptanceStatusView } from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock
const mockCrossings = useBoundaryCrossings as jest.Mock

function statusView(
  over: Partial<TaskAcceptanceStatusView> = {}
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
    currentRound: 2,
    maxRounds: 3,
    escalated: false,
    criteria: [
      {
        id: 'm1',
        statement: 'route returns 409 on lock',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest x',
        evidenceRequired: false,
        judgeSteps: null,
        source: 'AGENT_DRAFT',
        addedAtRound: 0,
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          verifierType: 'MACHINE',
          evidencePointer: 'cmd:npx jest x#exit=0',
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-06-10T10:00:00.000Z',
        },
        machinePassed: true,
        verdictStale: false,
        checkMismatch: false,
        changeState: null,
        changedAtRound: null,
        lastEdit: null,
      },
    ],
    machineVerification: { total: 1, machineVerified: 1, humanOverridden: 0 },
    cost: { tokenCost: 1_200_000, activeTimeSec: 134, reworkRounds: 0 },
    struggleTrail: {
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    },
    trend: {
      passRate: [{ round: 1, passed: 1, failed: 0 }],
      cost: [],
      rework: { reworkRounds: 0, reopens: 0, extraPrCycles: 0, total: 0 },
    },
    claim: { text: null, source: null },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  } as TaskAcceptanceStatusView
}

function setStatus(data: TaskAcceptanceStatusView) {
  mockStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

function setCrossings(list: unknown[]) {
  mockCrossings.mockReturnValue({
    crossings: list,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

function renderTab() {
  return render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
    />
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  setCrossings([])
})

describe('run report group', () => {
  it('run report group collapses the trailing report sections by default', () => {
    setStatus(statusView())
    renderTab()

    // The group toggle exists and is collapsed.
    const groupToggle = screen.getByRole('button', { name: /Run report/i })
    expect(groupToggle).toHaveAttribute('aria-expanded', 'false')

    // The folded sections are not in the DOM until the group is expanded.
    expect(screen.queryByText('Cost')).toBeNull()
    expect(screen.queryByText('Struggle / rework / outstanding')).toBeNull()

    // The decision surface and the contract stay above the group, always shown.
    expect(screen.getByText('Acceptance criteria')).toBeInTheDocument()
    expect(screen.getByText('Claim vs verification')).toBeInTheDocument()

    // Expanding the group reveals the same-source report sections.
    fireEvent.click(groupToggle)
    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(
      screen.getByText('Struggle / rework / outstanding')
    ).toBeInTheDocument()
  })
})

describe('boundary crossing row noise', () => {
  const dispositioned = {
    id: 'c1',
    category: 'EDITED_TEST',
    severity: 'LOW',
    disposition: 'FALSE_POSITIVE',
    reversible: true,
    occurrenceCount: 2,
    detail: 'edited a test a check depends on',
    detectedAt: '2026-06-20T01:00:00.000Z',
    dispositionedAt: '2026-06-20T02:00:00.000Z',
    dispositionedById: null,
    dispositionNote: null,
    lastSeenAt: '2026-06-20T01:30:00.000Z',
    attribution: null,
    explanations: [],
    remediationTask: null,
    lastDispositionChange: null,
  }

  it('collapsed boundary crossing row shows only severity and disposition', () => {
    setStatus(statusView())
    setCrossings([dispositioned])
    renderTab()

    // A dispositioned-only panel is collapsed — open it to reach the row.
    fireEvent.click(screen.getByText('Boundary crossings'))

    // Row is collapsed by default (it is already handled). The secondary chips
    // are NOT in the collapsed row.
    expect(screen.queryByTestId('crossing-reversible-c1')).toBeNull()
    expect(screen.queryByTestId('crossing-recurrence-c1')).toBeNull()

    // Expanding the row reveals them.
    fireEvent.click(screen.getByTestId('crossing-toggle-c1'))
    expect(screen.getByTestId('crossing-reversible-c1')).toBeInTheDocument()
    expect(screen.getByTestId('crossing-recurrence-c1')).toBeInTheDocument()
  })

  it('boundary panel drops the warning chrome once every crossing is dispositioned', () => {
    setStatus(statusView())

    // A dispositioned-only panel (0 open) reads as a neutral disclosure row —
    // no warning fill — so it stops shouting once everything is handled.
    setCrossings([dispositioned])
    const resolved = renderTab()
    const resolvedRoot = resolved.container.querySelector(
      '#boundary-crossings'
    )!
    expect(resolvedRoot.className).not.toMatch(/warning-subtle/)
    resolved.unmount()

    // An un-dispositioned (open) crossing brings the warning chrome back.
    setCrossings([{ ...dispositioned, id: 'c9', disposition: null }])
    const open = renderTab()
    const openRoot = open.container.querySelector('#boundary-crossings')!
    expect(openRoot.className).toMatch(/warning-subtle/)
  })
})

describe('human judgment zone', () => {
  function humanCriterion(
    over: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      id: 'h1',
      statement: 'reads naturally',
      verifierType: 'HUMAN',
      checkpointer: null,
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

  const passedVerdict = {
    round: 1,
    verdict: 'PASS',
    verifierType: 'HUMAN',
    evidencePointer: null,
    rejectionReason: null,
    rejectionReasonEnum: null,
    recordedAt: '2026-06-10T10:00:00.000Z',
  }

  it('human judgment zone smart-collapses when all human criteria are resolved', () => {
    // Every human criterion has a PASS → the zone defaults collapsed, mirroring
    // the machine zone's "all verified → folded" smart default.
    setStatus(
      statusView({
        criteria: [
          humanCriterion({ id: 'h1', latestVerdict: passedVerdict }),
        ] as never,
        nextActions: [],
      })
    )
    const { unmount } = renderTab()
    const toggle = screen.getByRole('button', {
      name: /Needs human judgment/i,
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('reads naturally')).toBeNull()
    // The header toggle flips it open.
    fireEvent.click(toggle)
    expect(screen.getByText('reads naturally')).toBeInTheDocument()
    unmount()

    // An unresolved human criterion (no PASS) keeps the zone open by default.
    setStatus(
      statusView({
        criteria: [
          humanCriterion({
            id: 'h2',
            statement: 'still pending judgment',
            latestVerdict: null,
          }),
        ] as never,
      })
    )
    renderTab()
    const toggle2 = screen.getByRole('button', {
      name: /Needs human judgment/i,
    })
    expect(toggle2).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('still pending judgment')).toBeInTheDocument()
  })
})

describe('record tab order and collapsibles', () => {
  const crossing = {
    id: 'c1',
    category: 'EDITED_TEST',
    severity: 'LOW',
    disposition: 'FALSE_POSITIVE',
    reversible: true,
    occurrenceCount: 1,
    detail: 'edited a test',
    detectedAt: '2026-06-20T01:00:00.000Z',
    dispositionedAt: '2026-06-20T02:00:00.000Z',
    dispositionedById: null,
    dispositionNote: null,
    lastSeenAt: null,
    attribution: null,
    explanations: [],
    remediationTask: null,
    lastDispositionChange: null,
  }

  it('boundary crossings leads the record tab, above claim and acceptance criteria', () => {
    setStatus(statusView())
    setCrossings([crossing])
    const { container } = renderTab()
    const boundary = container.querySelector('#boundary-crossings')!
    const claim = screen.getByText('Claim vs verification')
    const criteria = screen.getByText('Acceptance criteria')
    // Boundary comes BEFORE both claim and the contract in DOM order.
    expect(
      boundary.compareDocumentPosition(claim) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      boundary.compareDocumentPosition(criteria) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('claim vs verification is a collapsible section', () => {
    setStatus(statusView())
    renderTab()
    // LUM-597: the verification block is the always-present body of the section
    // (the claim collapsed to a reality-check line, gone here since the fixture
    // has no claim) — use it as the open/closed marker.
    expect(
      screen.getByText('Verification — what was confirmed')
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /Claim vs verification/i })
    )
    expect(screen.queryByText('Verification — what was confirmed')).toBeNull()
  })

  it('acceptance criteria is a collapsible section', () => {
    setStatus(statusView())
    renderTab()
    expect(screen.getByText('Machine-verified')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /^Acceptance criteria$/i })
    )
    expect(screen.queryByText('Machine-verified')).toBeNull()
  })
})
