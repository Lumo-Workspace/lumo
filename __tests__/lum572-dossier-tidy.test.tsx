/** @jest-environment jsdom */
/**
 * LUM-572 — tidy the task-detail dossier. Two structural behaviours:
 *  1. the trailing report sections (Cost / Struggle / Trend) fold into one
 *     collapsible "Run report" group; the boundary panel stays above it.
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
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
  },
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
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
    cost: { tokenCost: 1_200_000, activeTimeSec: 134 },
    struggleTrail: { pullRequests: [], reopens: [] },
    trend: {
      cost: [],
      rework: { reopens: 0, extraPrCycles: 0, total: 0 },
    },
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

function setCrossings(list: unknown[]) {
  mockCrossings.mockReturnValue({
    crossings: list,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

function renderTab() {
  return render(<RecordTab taskIdentifier='LUM-1' enabled={true} />)
}

beforeEach(() => {
  jest.clearAllMocks()
  setCrossings([])
})

describe('run overview', () => {
  // LUM-1009: the overview tiles are always visible — no "Run report" fold —
  // and the narrative sub-sections (struggle trail, trend) are gone.
  it('shows the Cost tile without any fold, and no struggle trail or claim strip', () => {
    setStatus(statusView())
    renderTab()

    expect(screen.queryByRole('button', { name: /Run report/i })).toBeNull()
    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('1.2M')

    // LUM-733: the claim strip is no longer rendered anywhere on the tab.
    expect(screen.queryByText('Claim vs verification')).toBeNull()
    expect(screen.queryByText(/Struggle/)).toBeNull()
    expect(screen.queryByText(/None recorded/)).toBeNull()
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
