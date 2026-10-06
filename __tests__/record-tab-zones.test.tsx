/** @jest-environment jsdom */
/**
 * LUM-496 / LUM-1009 — the Record tab is four fixed sections: ① the Done gate,
 * ② Needs action (iff acting on something changes whether the task can reach
 * Done: open boundary crossings, blocking security findings), ③ the Run
 * overview tiles, ④ Records. These tests pin section membership per state, the
 * anchors the gate links to (including the legacy #boundary-crossings deep
 * link), and that the full security report never leaves Records. (LUM-942:
 * acceptance criteria and verification rounds are gone from this tab.)
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      const en = require('@/lib/i18n/en.json') as Record<string, string>
      let msg = en[id] ?? defaultMessage ?? id
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

describe('the Done gate', () => {
  it('is always drawn, even with no crossings and no scanned PR', () => {
    setStatus(statusView())
    renderTab()
    const gate = screen.getByTestId('record-done-gate')
    expect(gate).toHaveAttribute('data-headline', 'ready')
    expect(gate).toHaveTextContent('Nothing left — the task can be marked Done')
    expect(screen.getByTestId('gate-crossings')).toHaveTextContent(
      'None recorded'
    )
    // No PR scanned is never reported as "no blocking findings".
    expect(screen.getByTestId('gate-security')).toHaveTextContent(
      'Not scanned — no linked pull request yet'
    )
  })

  // LUM-1009: the old strip only counted crossings and returned null without
  // one — a task held back only by a security finding showed nothing.
  it('shows a blocking security row when only a security finding blocks Done', () => {
    setStatus(statusView())
    renderTab({ securityBlocking: 1, securityScanned: true })

    const gate = screen.getByTestId('record-done-gate')
    expect(gate).toHaveAttribute('data-headline', 'blocked')
    expect(gate).toHaveTextContent('1 item blocks Done')
    const row = screen.getByTestId('gate-security')
    expect(row).toHaveAttribute('data-blocked', 'true')
    expect(row).toHaveTextContent('1 blocking finding not dispositioned')
    expect(row.querySelector('a')).toHaveAttribute(
      'href',
      '#record-needs-action'
    )
    expect(screen.getByTestId('gate-crossings')).toHaveAttribute(
      'data-blocked',
      'false'
    )
  })

  it('counts blocking crossings and findings together in the headline', () => {
    setStatus(statusView())
    setCrossings([crossing(), crossing({ id: 'bc-2' })])
    renderTab({ securityBlocking: 1, securityScanned: true })
    expect(screen.getByTestId('record-done-gate')).toHaveTextContent(
      '3 items block Done'
    )
    expect(screen.getByTestId('gate-crossings')).toHaveTextContent(
      '2 blocking, not dispositioned · Dispositioned 0/2'
    )
  })

  it('collapses to one accepted line on a DONE task', () => {
    setStatus(
      statusView({
        task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'DONE' },
      })
    )
    setCrossings([crossing({ id: 'bc-done', disposition: 'CONFIRMED' })])
    renderTab({ securityScanned: true })

    const gate = screen.getByTestId('record-done-gate')
    expect(gate).toHaveAttribute('data-headline', 'accepted')
    expect(gate).toHaveTextContent('Accepted — this task is Done')
    expect(gate).toHaveTextContent('Dispositioned 1/1 · No blocking findings')
    expect(screen.queryByTestId('gate-crossings')).toBeNull()
    expect(screen.queryByTestId('record-needs-action')).toBeNull()
  })
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

    // The gate's blocked row links at the section that exists.
    expect(
      screen.getByTestId('gate-crossings').querySelector('a')
    ).toHaveAttribute('href', '#record-needs-action')
    expect(needsAction()).toHaveAttribute('id', 'record-needs-action')
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
    // LUM-1009: in Records its header is a plain row — the chevron only, no
    // status icon — so it lines up with the other Records rows.
    const toggle = screen.getByTestId('boundary-summary-toggle')
    expect(toggle.querySelectorAll('svg')).toHaveLength(1)
    expect(toggle).toHaveClass('px-4', 'py-3', 'gap-x-2.5')
    // Nothing to act on — the gate rows link nowhere.
    expect(screen.getByTestId('gate-crossings').querySelector('a')).toBeNull()
  })
})

describe('security findings by state', () => {
  // LUM-1009: the full report never moves; only the blocking findings come
  // up in Needs action.
  it('a blocking finding comes up in NEEDS ACTION while the full report stays in Records', () => {
    setStatus(statusView())
    renderTab({
      securityRecordSlot: <div data-testid='security-record' />,
      blockingSecuritySlot: <div data-testid='security-blocking' />,
      securityBlocking: 1,
      securityScanned: true,
    })

    expect(needsAction()).toContainElement(
      screen.getByTestId('security-blocking')
    )
    expect(records()).toContainElement(screen.getByTestId('security-record'))
    expect(screen.getAllByTestId('security-record')).toHaveLength(1)
  })

  it('with nothing blocking the report is a record and no queue is drawn', () => {
    setStatus(statusView())
    renderTab({
      securityRecordSlot: <div data-testid='security-record' />,
      blockingSecuritySlot: <div data-testid='security-blocking' />,
      securityBlocking: 0,
      securityScanned: true,
    })

    expect(screen.queryByTestId('record-needs-action')).toBeNull()
    expect(screen.queryByTestId('security-blocking')).toBeNull()
    expect(records()).toContainElement(screen.getByTestId('security-record'))
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

    expect(needsAction()).toHaveTextContent(
      'Open items recorded after the task was accepted.'
    )
    expect(
      screen.queryByText('Clear these and the task can be marked Done.')
    ).toBeNull()
  })

  // Review F5: advisory crossings (or any open crossing with the gate off)
  // need a disposition for the record, but Done never waited on them.
  it('advisory-only crossings get the non-blocking note and do not block the gate', () => {
    setStatus(statusView())
    setCrossings([crossing({ advisory: true, severity: 'MEDIUM' })])
    renderTab()

    expect(needsAction()).toHaveTextContent(
      'These do not block Done, but each still needs a disposition.'
    )
    const row = screen.getByTestId('gate-crossings')
    expect(row).toHaveAttribute('data-blocked', 'false')
    expect(row).toHaveTextContent('1 advisory')
    expect(screen.getByTestId('record-done-gate')).toHaveAttribute(
      'data-headline',
      'ready'
    )
  })

  it('keeps the blocking note when something actually blocks Done', () => {
    setStatus(statusView())
    setCrossings([crossing()])
    renderTab()

    expect(needsAction()).toHaveTextContent(
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

    expect(needsAction()).toHaveTextContent(
      'Clear these and the task can be marked Done.'
    )
  })
})

describe('run overview', () => {
  // LUM-1009: Rework, Trend and the Struggle trail are gone (user ruling).
  it('shows exactly Cost, PR iterations and Sessions, with no rework / trend / struggle', () => {
    setStatus(statusView())
    renderTab({ attribution: { explicit: 4, inferred: 2 } })

    const overview = screen.getByTestId('record-overview')
    const tiles = Array.from(
      overview.querySelectorAll('[data-testid^="tile-"]')
    ).map(el => el.getAttribute('data-testid'))
    expect(tiles).toEqual([
      'tile-costTokens',
      'tile-prIterations',
      'tile-sessions',
    ])
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('1.2M')
    expect(screen.getByTestId('tile-sessions')).toHaveTextContent(
      '64 bound · 2 auto-detected'
    )

    expect(screen.queryByTestId('tile-rework')).toBeNull()
    expect(screen.queryByText(/Struggle/)).toBeNull()
    expect(screen.queryByText('Trend')).toBeNull()
    expect(screen.queryByText('Run report')).toBeNull()
  })

  it('renders no acceptance-criteria surface at all', () => {
    setStatus(statusView())
    renderTab()
    expect(screen.queryByText('Acceptance')).toBeNull()
    expect(screen.queryByText(/Machine-verified/)).toBeNull()
    expect(screen.queryByText(/acceptance criteria/i)).toBeNull()
  })
})

// LUM-1011: test cases moved from their own tab into the Record tab.
describe('test cases', () => {
  // LUM-1012: Test cases is the first row of Records, not a section of its own.
  it('is the first row inside Records, with no section of its own', () => {
    setStatus(statusView())
    renderTab({
      testCasesSlot: <div data-testid='tests-row' />,
      securityRecordSlot: <div data-testid='security-row' />,
    })
    expect(screen.queryByTestId('record-tests')).toBeNull()
    const records = screen.getByTestId('record-records')
    expect(records).toContainElement(screen.getByTestId('tests-row'))
    expect(
      screen
        .getByTestId('tests-row')
        .compareDocumentPosition(screen.getByTestId('security-row')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('the gate has a test-case row that never reads "passing" without cases', () => {
    setStatus(statusView())
    renderTab()
    expect(screen.getByTestId('gate-tests')).toHaveTextContent('No test cases')
    expect(screen.getByTestId('gate-tests')).toHaveAttribute(
      'data-blocked',
      'false'
    )
  })

  // Before LUM-1011 a proven test defect blocked DONE server-side (LUM-812)
  // while the Record page's gate said "the task can be marked Done".
  it('a proven test defect blocks the gate and comes up in Needs action', () => {
    setStatus(statusView())
    renderTab({
      testsBlocking: 1,
      testsSummary: { total: 3, passing: 2 },
      blockingTestsSlot: <div data-testid='defect-queue' />,
    })
    expect(screen.getByTestId('record-done-gate')).toHaveTextContent(
      '1 item blocks Done'
    )
    const row = screen.getByTestId('gate-tests')
    expect(row).toHaveAttribute('data-blocked', 'true')
    expect(row).toHaveTextContent('1 proven defect awaiting a ruling')
    expect(needsAction()).toContainElement(screen.getByTestId('defect-queue'))
    expect(needsAction()).toHaveTextContent(
      'Clear these and the task can be marked Done.'
    )
  })

  it('with no defect the queue slot is not drawn and the row says how many pass', () => {
    setStatus(statusView())
    renderTab({
      testsSummary: { total: 3, passing: 2 },
      blockingTestsSlot: <div data-testid='defect-queue' />,
    })
    expect(screen.queryByTestId('defect-queue')).toBeNull()
    expect(screen.getByTestId('gate-tests')).toHaveTextContent(
      'No proven defects · 2 of 3 passing'
    )
  })
})
