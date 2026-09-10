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
import type {
  TaskAcceptanceStatusView,
  TaskClaimFaithfulnessView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock
const mockCrossings = useBoundaryCrossings as jest.Mock

/** LUM-730: the claim-vs-verification section only renders on a mismatch, so
 *  the default fixture carries a claim judged OVERSTATED — the structural
 *  assertions below (section present, collapsible, ordered after the boundary
 *  panel) need the section to exist at all. */
function overstated(
  over: Partial<TaskClaimFaithfulnessView> = {}
): TaskClaimFaithfulnessView {
  return {
    state: 'OVERSTATED',
    verdict: 'OVERSTATED',
    evidence: [],
    reasoning: null,
    diffShas: [],
    prNumbers: [],
    judgedAt: '2026-06-20T12:00:00.000Z',
    judgedClaimAt: '2026-06-20T10:00:00.000Z',
    ...over,
  }
}

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
    claim: { text: 'did the thing', source: 'AGENT' },
    faithfulness: overstated(),
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
  // LUM-496 supersedes the "collapses by default" reading: the Run report group
  // opens with its KPI tiles (Cost among them) as the glanceable summary, while
  // the narrative sub-sections — struggle trail, removed — stay collapsed one
  // more click down. Nothing that used to be folded away is now shouting.
  it('run report shows its KPI tiles by default and keeps the narrative sub-sections collapsed', () => {
    setStatus(statusView())
    renderTab()

    const groupToggle = screen.getByRole('button', { name: /Run report/i })
    expect(groupToggle).toHaveAttribute('aria-expanded', 'true')

    // The tiles are the summary — cost included (LUM-496 moved it out of the
    // Evidence & audit trail card into the Cost tile).
    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('1.2M')

    // The decision surface and the contract stay above the group, always shown.
    // LUM-620: the criteria contract surfaces via the "Machine-verified" zone.
    expect(screen.getByText('Machine-verified')).toBeInTheDocument()
    // LUM-733: the claim strip is no longer rendered anywhere on the tab.
    expect(screen.queryByText('Claim vs verification')).toBeNull()

    // The struggle trail is behind its own collapsed disclosure: the heading is
    // the toggle, its body only mounts on click.
    const struggleToggle = screen.getByRole('button', {
      name: /Struggle \/ rework \/ outstanding/i,
    })
    expect(struggleToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/None recorded/)).toBeNull()
    fireEvent.click(struggleToggle)
    expect(screen.getByText(/None recorded/)).toBeInTheDocument()

    // Collapsing the group still folds the whole after-the-fact record away.
    fireEvent.click(groupToggle)
    expect(screen.queryByText('Cost')).toBeNull()
    expect(screen.queryByText('Struggle / rework / outstanding')).toBeNull()

    // Cost is not duplicated inside the Evidence & audit trail card.
    fireEvent.click(screen.getByText('Evidence & audit trail'))
    expect(screen.queryByText('Cost')).toBeNull()
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

    // LUM-496: a dispositioned crossing is a record — it renders in the records
    // zone's dispositioned panel, collapsed. Open it to reach the row.
    fireEvent.click(screen.getByText('Boundary crossings · dispositioned'))
    // LUM-496: the row now sits inside its category's group fold, which starts
    // collapsed when nothing in it is open.
    fireEvent.click(screen.getByTestId('crossing-group-EDITED_TEST'))

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

    // A dispositioned-only panel (0 open) reads as a neutral zone row — no
    // state accent — so it stops shouting once everything is handled. LUM-635:
    // the panel is a promoted zone (always mounted, no audit-fold expansion
    // needed) and its blocking accent is danger, not warning. LUM-496: the two
    // subsets are two panels — the settled record (#record-crossings-
    // dispositioned) and the open one in NEEDS ACTION (#record-crossings) —
    // and whichever renders keeps the legacy #boundary-crossings deep-link
    // anchor alive.
    setCrossings([dispositioned])
    const resolved = renderTab()
    const resolvedRoot = resolved.container.querySelector(
      '#record-crossings-dispositioned'
    )!
    expect(resolvedRoot.className).not.toMatch(/danger/)
    expect(
      resolved.container.querySelector('#boundary-crossings')
    ).not.toBeNull()
    resolved.unmount()

    // An un-dispositioned (open, blocking) crossing brings the accent back.
    setCrossings([{ ...dispositioned, id: 'c9', disposition: null }])
    const open = renderTab()
    const openRoot = open.container.querySelector('#record-crossings')!
    expect(openRoot.className).toMatch(/border-danger-border/)
    expect(open.container.querySelector('#boundary-crossings')).not.toBeNull()
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
    // LUM-620: an all-resolved human zone relabels its toggle to "Human-judged"
    // (the state-aware header — no longer a pending "Needs your judgment" call).
    const toggle = screen.getByRole('button', {
      name: /Human-judged/i,
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
      name: /Needs your judgment/i,
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

  // LUM-635 supersedes the LUM-619/620 demotion: the boundary crossings are a
  // promoted zone again — after the criteria zones (verdict basis leads) but
  // BEFORE the claim strip and the collapsed Evidence & audit trail card (an
  // open crossing is an actionable Done-blocker, not forensics).
  it('criteria lead the record tab, above the boundary crossings', () => {
    setStatus(statusView())
    setCrossings([crossing])
    const { container } = renderTab()
    const criteria = screen.getByText('Machine-verified')
    // The panel is always mounted now — no audit-card expansion needed.
    const boundary = container.querySelector('#boundary-crossings')!
    // Criteria come BEFORE the boundary panel.
    expect(
      criteria.compareDocumentPosition(boundary) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    // LUM-733: the claim strip is gone from the front-end entirely.
    expect(screen.queryByText('Claim vs verification')).toBeNull()
  })

  // LUM-619/620: the criteria live inside the collapsible "Acceptance" container
  // (default open). Collapsing it hides the criteria zones.
  it('the acceptance container is a collapsible section', () => {
    setStatus(statusView())
    renderTab()
    expect(screen.getByText('Machine-verified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Acceptance$/i }))
    expect(screen.queryByText('Machine-verified')).toBeNull()
  })
})
