/** @jest-environment jsdom */
/**
 * LUM-496 — the Record tab is composed by DECISION, not by data type: a unit
 * sits in NEEDS ACTION iff acting on it changes whether the task can reach
 * Done (open boundary crossings, blocking security findings); everything else
 * is a record below. These tests pin zone membership per state, the anchors the
 * status strip links to (including the legacy #boundary-crossings deep link),
 * and the Run report's default folds. (LUM-942: acceptance criteria and
 * verification rounds are gone from this tab.)
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
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
    explainBoundaryCrossing: jest.fn().mockResolvedValue({}),
  },
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { RecordTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
import type { TaskStatusView } from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock
const mockCrossings = useBoundaryCrossings as jest.Mock

function statusView(over: Partial<TaskStatusView> = {}): TaskStatusView {
  return {
    version: 2,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
    cost: { tokenCost: 1_200_000, activeTimeSec: 60 },
    struggleTrail: { pullRequests: [], reopens: [] },
    trend: {
      cost: [],
      rework: { reopens: 1, extraPrCycles: 1, total: 2 },
    },
    ...over,
  }
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

function setStatus(data: TaskStatusView) {
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
  return render(<RecordTab taskIdentifier='LUM-1' enabled={true} {...extra} />)
}

const needsAction = () => screen.getByTestId('record-needs-action')
const records = () => screen.getByTestId('record-records')

beforeEach(() => {
  jest.clearAllMocks()
  setCrossings([])
})

describe('boundary crossings by state', () => {
  it('open crossings render in NEEDS ACTION at #record-crossings, keeping the legacy anchor alive', () => {
    setStatus(statusView())
    setCrossings([crossing()])
    const { container } = renderTab()

    const panel = container.querySelector('#record-crossings')!
    expect(panel).not.toBeNull()
    expect(needsAction()).toContainElement(panel as HTMLElement)
    // The legacy deep link still lands on the panel (LUM-454).
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
    setStatus(statusView())
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
    setStatus(statusView())
    renderTab({
      securitySlot: <div data-testid='security-slot' />,
      securityBlocking: 1,
    })

    const slot = screen.getByTestId('security-slot')
    expect(needsAction()).toContainElement(slot)
    expect(screen.getAllByTestId('security-slot')).toHaveLength(1)
  })

  it('with nothing blocking the scan section is a record', () => {
    setStatus(statusView())
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
    expect(records()).toBeInTheDocument()
  })

  it('with no crossings at all the strip is not drawn', () => {
    setStatus(statusView())
    renderTab()
    expect(screen.queryByTestId('gap-none')).toBeNull()
    expect(screen.queryByTestId('record-needs-action')).toBeNull()
  })
})

describe('the needs-action note tells the truth about what is in the zone', () => {
  // Review F4: crossings can land after acceptance (a late-arriving session
  // report). They still need dispositioning — but nothing is waiting on them.
  it('a DONE task with open crossings never says "and the task can be marked Done"', () => {
    setStatus(
      statusView({
        task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'DONE' },
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
    setStatus(statusView())
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
    setStatus(statusView())
    setCrossings([crossing()])
    renderTab()

    expect(screen.getByTestId('record-needs-action-note')).toHaveTextContent(
      'Clear these and the task can be marked Done.'
    )
  })

  it('an advisory crossing alongside a real blocker keeps the blocking note', () => {
    setStatus(statusView())
    setCrossings([
      crossing({ id: 'bc-adv', advisory: true, severity: 'LOW' }),
      crossing(),
    ])
    renderTab()

    expect(screen.getByTestId('record-needs-action-note')).toHaveTextContent(
      'Clear these and the task can be marked Done.'
    )
  })
})

describe('run report defaults', () => {
  it('shows the KPI tiles by default and keeps the struggle trail collapsed', () => {
    setStatus(statusView())
    renderTab()

    expect(screen.getByTestId('tile-prIterations')).toBeInTheDocument()
    expect(screen.queryByTestId('tile-passRateR1')).toBeNull()
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('1.2M')
    expect(screen.getByTestId('tile-rework')).toHaveTextContent('2')

    const struggle = screen.getByRole('button', {
      name: /Struggle \/ rework \/ outstanding/i,
    })
    expect(struggle).toHaveAttribute('aria-expanded', 'false')
    // Its body (the empty-trail basis line) has not mounted yet.
    expect(screen.queryByText(/None recorded/)).toBeNull()
  })

  it('renders no acceptance-criteria surface at all', () => {
    setStatus(statusView())
    renderTab()
    expect(screen.queryByText('Acceptance')).toBeNull()
    expect(screen.queryByText(/Machine-verified/)).toBeNull()
    expect(screen.queryByText(/acceptance criteria/i)).toBeNull()
  })
})
