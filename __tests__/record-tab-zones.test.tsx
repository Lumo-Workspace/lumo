/** @jest-environment jsdom */
/**
 * LUM-496 — the Record tab is composed by DECISION, not by data type: a unit
 * sits in NEEDS ACTION iff acting on it changes whether the task can reach
 * Done (machine checks no checkpointer has passed, an unresolved HUMAN
 * send-back, open boundary crossings, blocking security findings); everything
 * else is a record below. These tests pin zone membership per state, the
 * anchors the status strip links to (including the legacy #boundary-crossings
 * deep link), and the Run report's default folds.
 *
 * LUM-789: a HUMAN criterion that was simply never adjudicated is a tacit
 * pass, not a to-do — only an explicit FAIL (a real send-back) still counts,
 * matching the DONE gate itself (task-state.service.ts's
 * assertNoUnresolvedSendBack only ever blocked on a FAIL). "unjudged human
 * calls" was removed from the sentence above for that reason.
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
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskStatus', () => ({
  useTaskStatus: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    submitHumanVerdict: jest.fn().mockResolvedValue({}),
    reviseCriteria: jest.fn().mockResolvedValue({}),
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
    explainBoundaryCrossing: jest.fn().mockResolvedValue({}),
  },
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({
    VerdictDecision: () => <div data-testid='verdict-status' />,
  })
)

import '@testing-library/jest-dom'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock
const mockCrossings = useBoundaryCrossings as jest.Mock

const MACHINE_PASS = {
  round: 1,
  verdict: 'PASS' as const,
  verifierType: 'MACHINE' as const,
  evidencePointer: 'cmd:npx jest x#exit=0',
  rejectionReason: null,
  rejectionReasonEnum: null,
  recordedAt: '2026-06-10T10:00:00.000Z',
}
const HUMAN_PASS = { ...MACHINE_PASS, verifierType: 'HUMAN' as const }
const HUMAN_FAIL = {
  ...HUMAN_PASS,
  verdict: 'FAIL' as const,
  evidencePointer: null,
}

function criterion(
  over: Partial<TaskStatusCriterionView> = {}
): TaskStatusCriterionView {
  return {
    id: 'm1',
    statement: 'route returns 409 on lock',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest x',
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
  } as TaskStatusCriterionView
}

function machineVerified(over: Partial<TaskStatusCriterionView> = {}) {
  return criterion({
    id: 'm-ok',
    statement: 'verified machine check',
    latestVerdict: MACHINE_PASS,
    machinePassed: true,
    ...over,
  })
}

function machineAwaiting(over: Partial<TaskStatusCriterionView> = {}) {
  return criterion({
    id: 'm-todo',
    statement: 'awaiting machine check',
    ...over,
  })
}

function humanCriterion(over: Partial<TaskStatusCriterionView> = {}) {
  return criterion({
    id: 'h1',
    statement: 'reads naturally',
    verifierType: 'HUMAN',
    checkpointer: null,
    ...over,
  })
}

function statusView(
  over: Partial<TaskAcceptanceStatusView> = {}
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    cost: { tokenCost: 1_200_000, activeTimeSec: 60, reworkRounds: 2 },
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

function crossing(over: Record<string, unknown> = {}) {
  return {
    id: 'bc-1',
    category: 'DESTRUCTIVE_DB_COMMAND',
    detail: 'prisma migrate reset --force',
    detectedAt: '2026-06-11T00:00:00.000Z',
    reversible: false,
    occurrenceCount: 1,
    lastSeenAt: '2026-06-11T00:00:00.000Z',
    severity: 'HIGH',
    disposition: null,
    dispositionNote: null,
    dispositionedAt: null,
    dispositionedById: null,
    remediationTask: null,
    editChange: null,
    lastDispositionChange: null,
    attribution: null,
    explanations: [],
    advisory: false,
    policyRuleRef: null,
    policyRuleText: null,
    agentContext: null,
    systemExplanation: null,
    ...over,
  }
}

function setStatus(data: TaskAcceptanceStatusView) {
  mockStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

function setCrossings(list: unknown[] = [], gateEnabled = true) {
  mockCrossings.mockReturnValue({
    crossings: list,
    gateEnabled,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

function renderTab(extra: Record<string, unknown> = {}) {
  return render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
      {...extra}
    />
  )
}

const needsAction = () => screen.getByTestId('record-needs-action')
const records = () => screen.getByTestId('record-records')

beforeEach(() => {
  jest.clearAllMocks()
  setCrossings([])
})

describe('machine checks by state', () => {
  it('lists only the awaiting checks in the NEEDS ACTION card, verified ones stay a record', () => {
    setStatus(statusView({ criteria: [machineVerified(), machineAwaiting()] }))
    renderTab()

    const card = screen.getByTestId('record-machine-awaiting')
    expect(card).toHaveAttribute('id', 'record-machine')
    expect(needsAction()).toContainElement(card)
    // Only the awaiting statement is listed here…
    expect(within(card).getByText('awaiting machine check')).toBeInTheDocument()
    expect(within(card).queryByText('verified machine check')).toBeNull()
    // …with the honest summary of the split (1 of 2 verified).
    expect(
      within(card).getByText('1 verified · 1 awaiting')
    ).toBeInTheDocument()
    // The row states why it is here, where it came from, and offers the
    // existing evidence disclosure under the mockup's wording.
    expect(
      within(card).getByTestId('machine-awaiting-m-todo')
    ).toHaveTextContent('Awaiting verification')
    expect(
      within(card).getByText('MACHINE · Agent-constructed')
    ).toBeInTheDocument()
    expect(
      within(card).getByRole('button', { name: /View output/ })
    ).toBeInTheDocument()

    // The verified check is a record: the green Machine-verified card below.
    const verifiedCard = screen.getByRole('button', {
      name: /Machine-verified/,
    })
    expect(records()).toContainElement(verifiedCard)
    // A record is folded by default — the rows that still need the reviewer
    // are the ones above, in NEEDS ACTION.
    expect(verifiedCard).toHaveAttribute('aria-expanded', 'false')
  })

  it('the Machine-verified record card starts collapsed and the toggle still opens it', () => {
    setStatus(statusView({ criteria: [machineVerified(), machineAwaiting()] }))
    renderTab()

    const verifiedCard = screen.getByRole('button', {
      name: /Machine-verified/,
    })
    expect(verifiedCard).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('verified machine check')).toBeNull()

    fireEvent.click(verifiedCard)
    expect(verifiedCard).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('verified machine check')).toBeInTheDocument()
  })

  it('with every check verified there is no NEEDS ACTION zone at all', () => {
    setStatus(statusView({ criteria: [machineVerified()] }))
    renderTab()

    expect(screen.queryByTestId('record-needs-action')).toBeNull()
    expect(screen.queryByTestId('record-machine-awaiting')).toBeNull()
    expect(
      records().querySelector('[data-testid="record-machine-awaiting"]')
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: /Machine-verified/ })
    ).toBeInTheDocument()
  })

  it('a human override counts as awaiting — a person carrying a check is not a machine pass', () => {
    setStatus(
      statusView({
        criteria: [
          machineAwaiting({
            id: 'm-override',
            statement: 'passed by a person',
            latestVerdict: HUMAN_PASS,
            machinePassed: false,
          }),
        ],
      })
    )
    renderTab()

    const card = screen.getByTestId('record-machine-awaiting')
    expect(within(card).getByText('passed by a person')).toBeInTheDocument()
    // The honest state badge survives next to the awaiting chip.
    expect(within(card).getByText('Passed')).toBeInTheDocument()
    expect(
      within(card).getByTestId('machine-awaiting-m-override')
    ).toBeInTheDocument()
  })
})

describe('human calls by state', () => {
  // LUM-789 overturns this test's old title/expectations ("an unjudged call
  // sits in NEEDS ACTION") — a criterion that was simply never adjudicated is
  // now a tacit pass, so it reads as a resolved record instead, exactly like
  // an explicit PASS below. See the companion "explicit FAIL" test for the
  // direction that still puts a human call in NEEDS ACTION.
  it('an unjudged call is a tacit pass — it is a record, not a NEEDS ACTION item', () => {
    setStatus(statusView({ criteria: [humanCriterion()] }))
    const { container } = renderTab()

    expect(screen.queryByTestId('record-needs-action')).toBeNull()
    expect(container.querySelector('#record-human')).toBeNull()
    const resolved = screen.getByRole('button', { name: /Human-judged/ })
    expect(records()).toContainElement(resolved)
  })

  it('an explicit FAIL still sits in NEEDS ACTION under the #record-human anchor', () => {
    setStatus(
      statusView({ criteria: [humanCriterion({ latestVerdict: HUMAN_FAIL })] })
    )
    const { container } = renderTab()

    const zone = container.querySelector('#record-human')!
    expect(zone).not.toBeNull()
    expect(needsAction()).toContainElement(zone as HTMLElement)
    // Forced open: the pending call and the add-criterion entry are visible.
    expect(screen.getByText('reads naturally')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('once judged the zone moves into the records, with no NEEDS ACTION left', () => {
    setStatus(
      statusView({ criteria: [humanCriterion({ latestVerdict: HUMAN_PASS })] })
    )
    const { container } = renderTab()

    expect(screen.queryByTestId('record-needs-action')).toBeNull()
    expect(container.querySelector('#record-human')).toBeNull()
    const resolved = screen.getByRole('button', { name: /Human-judged/ })
    expect(records()).toContainElement(resolved)
    // Resolved → collapsed by default (the LUM-572 smart default).
    expect(resolved).toHaveAttribute('aria-expanded', 'false')
  })

  it('with no human criterion yet the editable shell has its own title and no 0/0 count', () => {
    setStatus(statusView({ criteria: [machineVerified()] }))
    renderTab()

    const shell = screen.getByRole('button', {
      name: /Human acceptance criteria/,
    })
    expect(records()).toContainElement(shell)
    // Nothing is pending and nothing is judged — so neither claim is made.
    expect(screen.queryByText('Needs your judgment')).toBeNull()
    expect(shell).not.toHaveTextContent('0/0')
    // The shell's whole purpose survives: the add-criterion entry.
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })
})

describe('boundary crossings by state', () => {
  it('open crossings render in NEEDS ACTION at #record-crossings, keeping the legacy anchor alive', () => {
    setStatus(statusView({ criteria: [machineVerified()] }))
    setCrossings([crossing()])
    const { container } = renderTab()

    const panel = container.querySelector('#record-crossings')!
    expect(panel).not.toBeNull()
    expect(needsAction()).toContainElement(panel as HTMLElement)
    // The verdict bar's old deep link still lands on the panel (LUM-454).
    expect(container.querySelector('#boundary-crossings')).not.toBeNull()
    // The dispositioned panel renders nothing when that subset is empty.
    expect(
      container.querySelector('#record-crossings-dispositioned')
    ).toBeNull()

    // The strip chips link at the anchors that exist.
    expect(screen.getByTestId('gap-crossings')).toHaveAttribute(
      'href',
      '#record-crossings'
    )
  })

  it('dispositioned crossings are a record, and carry the legacy anchor when nothing is open', () => {
    setStatus(statusView({ criteria: [machineVerified()] }))
    setCrossings([crossing({ id: 'bc-done', disposition: 'FALSE_POSITIVE' })])
    const { container } = renderTab()

    expect(screen.queryByTestId('record-needs-action')).toBeNull()
    const panel = container.querySelector('#record-crossings-dispositioned')!
    expect(panel).not.toBeNull()
    expect(records()).toContainElement(panel as HTMLElement)
    expect(container.querySelector('#boundary-crossings')).not.toBeNull()
  })
})

describe('security findings by state', () => {
  it('a blocking finding puts the scan section in NEEDS ACTION, never twice', () => {
    setStatus(statusView({ criteria: [machineVerified()] }))
    renderTab({
      securitySlot: <div data-testid='security-slot' />,
      securityBlocking: 1,
    })

    const slot = screen.getByTestId('security-slot')
    expect(needsAction()).toContainElement(slot)
    expect(screen.getAllByTestId('security-slot')).toHaveLength(1)
  })

  it('with nothing blocking the scan section is a record', () => {
    setStatus(statusView({ criteria: [machineVerified()] }))
    renderTab({
      securitySlot: <div data-testid='security-slot' />,
      securityBlocking: 0,
    })

    expect(screen.queryByTestId('record-needs-action')).toBeNull()
    expect(records()).toContainElement(screen.getByTestId('security-slot'))
  })
})

describe('a task with nothing left to do', () => {
  it('renders no NEEDS ACTION zone and says so on the strip', () => {
    setStatus(
      statusView({
        task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'DONE' },
        criteria: [
          machineVerified(),
          humanCriterion({ latestVerdict: HUMAN_PASS }),
        ],
      })
    )
    setCrossings([crossing({ id: 'bc-done', disposition: 'CONFIRMED' })])
    renderTab()

    expect(screen.queryByTestId('record-needs-action')).toBeNull()
    // Review F3: the task is already accepted — the strip states the outcome
    // instead of instructing a decision that was taken.
    expect(screen.queryByTestId('gap-none')).toBeNull()
    expect(screen.getByTestId('gap-accepted')).toHaveTextContent(
      'Accepted — this task is Done'
    )
    // Everything settled is still on the page, one zone down.
    expect(records()).toBeInTheDocument()
  })

  it('a DONE task never asks for action, even with a check only a human carried', () => {
    // A closed task owes the reviewer nothing — the same rule that zeroes
    // humanPending on DONE zeroes machineAwaiting, so "Clear these and the
    // task can be marked Done" can never appear under a task already Done.
    setStatus(
      statusView({
        task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'DONE' },
        criteria: [
          machineAwaiting({
            id: 'm-override',
            statement: 'passed by a person',
            latestVerdict: HUMAN_PASS,
            machinePassed: false,
          }),
          humanCriterion({ latestVerdict: HUMAN_PASS }),
        ],
      })
    )
    renderTab()

    expect(screen.queryByTestId('record-needs-action')).toBeNull()
    expect(screen.queryByTestId('record-machine-awaiting')).toBeNull()
    expect(
      screen.queryByText('Clear these and the task can be marked Done.')
    ).toBeNull()
    expect(screen.queryByTestId('gap-machine')).toBeNull()
    expect(screen.getByTestId('gap-human')).toHaveTextContent(
      'Human-judged 1/1'
    )
    expect(screen.getByTestId('gap-accepted')).toBeInTheDocument()

    // The override is a record, not a disappearance: the card counts it
    // honestly (0 of 1 machine-verified) and still lists it when opened.
    const card = screen.getByRole('button', { name: /Machine-verified/ })
    expect(records()).toContainElement(card)
    expect(card).toHaveTextContent('0 machine-verified · 1 human override')
    expect(card).toHaveTextContent('0/1')
    fireEvent.click(card)
    expect(screen.getByText('passed by a person')).toBeInTheDocument()
  })
})

describe('the needs-action note tells the truth about what is in the zone', () => {
  // Review F4: crossings can land after acceptance (a late-arriving session
  // report). They still need dispositioning — but nothing is waiting on them.
  it('a DONE task with open crossings never says "and the task can be marked Done"', () => {
    setStatus(
      statusView({
        task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'DONE' },
        criteria: [machineVerified()],
      })
    )
    setCrossings([crossing()])
    renderTab()

    expect(screen.getByTestId('record-needs-action-note')).toHaveTextContent(
      'Open items recorded after the task was accepted.'
    )
    expect(
      screen.queryByText('Clear these and the task can be marked Done.')
    ).toBeNull()
  })

  // Review F5: advisory crossings (or any open crossing with the gate off)
  // need a disposition for the record, but Done never waited on them.
  it('advisory-only crossings get the non-blocking note and an in-review chip', () => {
    setStatus(statusView({ criteria: [machineVerified()] }))
    setCrossings([crossing({ advisory: true, severity: 'MEDIUM' })])
    renderTab()

    expect(screen.getByTestId('record-needs-action-note')).toHaveTextContent(
      'These do not block Done, but each still needs a disposition.'
    )
    const chip = screen.getByTestId('gap-crossings')
    expect(chip).toHaveTextContent('1 advisory crossing to disposition')
    expect(chip.className).toContain('text-status-in-review')
  })

  it('keeps the blocking note when something actually blocks Done', () => {
    setStatus(statusView({ criteria: [machineAwaiting()] }))
    setCrossings([crossing()])
    renderTab()

    expect(screen.getByTestId('record-needs-action-note')).toHaveTextContent(
      'Clear these and the task can be marked Done.'
    )
  })

  it('an advisory crossing alongside a real blocker keeps the blocking note', () => {
    setStatus(statusView({ criteria: [machineAwaiting()] }))
    setCrossings([crossing({ advisory: true, severity: 'LOW' })])
    renderTab()

    expect(screen.getByTestId('record-needs-action-note')).toHaveTextContent(
      'Clear these and the task can be marked Done.'
    )
  })
})

describe('run report defaults', () => {
  it('shows the KPI tiles by default and keeps the struggle trail collapsed', () => {
    setStatus(statusView({ criteria: [machineVerified()] }))
    renderTab()

    expect(screen.getByTestId('tile-prIterations')).toBeInTheDocument()
    expect(screen.getByTestId('tile-passRateR1')).toBeInTheDocument()
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('1.2M')
    expect(screen.getByTestId('tile-rework')).toHaveTextContent('2')

    const struggle = screen.getByRole('button', {
      name: /Struggle \/ rework \/ outstanding/i,
    })
    expect(struggle).toHaveAttribute('aria-expanded', 'false')
    // Its body (the empty-trail basis line) has not mounted yet.
    expect(screen.queryByText(/None recorded/)).toBeNull()
  })
})

describe('a task with no contract', () => {
  it('keeps the empty note as a record while crossings still demand action', () => {
    setStatus(statusView({ criteria: [] }))
    setCrossings([crossing()])
    const { container } = renderTab()

    expect(records()).toContainElement(screen.getByText('此任务暂无验收标准'))
    expect(needsAction()).toContainElement(
      container.querySelector('#record-crossings') as HTMLElement
    )
  })
})
