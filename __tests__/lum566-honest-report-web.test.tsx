/** @jest-environment jsdom */
/**
 * LUM-566: the web task-detail Acceptance tab renders the honest-report sections
 * that LUM-559~564 put into `lumo task status` + the server read model — the
 * struggle / rework trail (561), the cost read-out (560), evidence drill-down
 * (563), and the claim-vs-verification pairing with provenance (564). The data
 * already rides on GET /api/tasks/[id]/status; this proves the web renders it
 * same-source, fail-closed, with no rendering drift from the CLI.
 */
// The shared `formatDurationSec` (LUM-642) behind the Cost tile's active-time
// caption uses the `duration.*` keys, which carry no defaultMessage — the mock
// needs their en copy to render a real duration instead of the key.
const mockDurationMessages: Record<string, string> = {
  'duration.hours': '{hours}h',
  'duration.minutes': '{minutes}m',
  'duration.seconds': '{seconds}s',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? mockDurationMessages[id] ?? id
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

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel',
  () => ({
    BoundaryCrossingsPanel: () => <div id='boundary-crossings' />,
  })
)

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock

function statusView(
  over: Partial<TaskAcceptanceStatusView> = {}
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_PROGRESS' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [machinePass()],
    machineVerification: { total: 1, machineVerified: 1, humanOverridden: 0 },
    struggleTrail: emptyTrail(),
    cost: { tokenCost: 12_000, activeTimeSec: 134, reworkRounds: 0 },
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
  }
}

function emptyTrail() {
  return {
    reworkRounds: [],
    sendBacks: [],
    followUps: [],
    pullRequests: [],
    reopens: [],
  }
}

function machinePass(
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
    ...over,
  }
}

function set(data: TaskAcceptanceStatusView) {
  mockStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

function render_() {
  const result = render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
    />
  )
  // LUM-572/620: struggle / trend live inside the collapsed "Run report" group;
  // verification history lives in the collapsed "Evidence & audit trail" card
  // (LUM-620). LUM-496: the cost read-out is now the Run report's Cost KPI tile
  // (visible as soon as the group is open) and the struggle trail folds behind
  // its own heading inside that group. Expand everything so these same-source
  // sections render.
  const runReport = screen.getByRole('button', { name: /Run report/i })
  if (runReport.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(runReport)
  }
  const struggle = screen.queryByRole('button', {
    name: /Struggle \/ rework \/ outstanding/i,
  })
  if (struggle) fireEvent.click(struggle)
  fireEvent.click(screen.getByText('Evidence & audit trail'))
  return result
}

function expandMachine() {
  fireEvent.click(screen.getByRole('button', { name: /Machine-verified/i }))
}

// LUM-789: an un-adjudicated HUMAN criterion is a tacit pass, so a zone with
// nothing but such rows now smart-collapses into "Human-judged" by default.
function expandHuman() {
  fireEvent.click(screen.getByRole('button', { name: /Human-judged/i }))
}

beforeEach(() => jest.clearAllMocks())

// ── LUM-561 ───────────────────────────────────────────────────────────────────
describe('struggle section', () => {
  it('always renders and states the basis when the trail is empty but verified', () => {
    set(statusView({ currentRound: 2, struggleTrail: emptyTrail() }))
    render_()
    expect(
      screen.getByText('Struggle / rework / outstanding')
    ).toBeInTheDocument()
    // Honest basis, not a silent omission nor a bare "nothing outstanding".
    expect(screen.getByText(/None recorded/)).toBeInTheDocument()
    expect(screen.queryByText(/nothing outstanding/i)).toBeNull()
  })

  it('cannot confirm absence of difficulties before any verification has run', () => {
    set(statusView({ currentRound: 0, struggleTrail: emptyTrail() }))
    render_()
    expect(screen.getByText(/cannot confirm/i)).toBeInTheDocument()
  })

  it('lists send-backs, reopens and PR iterations when present', () => {
    set(
      statusView({
        currentRound: 2,
        struggleTrail: {
          reworkRounds: [{ round: 2, failed: 1 }],
          sendBacks: [
            {
              criterionId: 'h1',
              statement: 'the bounced criterion',
              status: 'open',
              failedAtRound: 2,
              resolvedAtRound: null,
            },
          ],
          followUps: [],
          pullRequests: [
            { number: 3, url: 'https://github.com/acme/repo/pull/3' },
            { number: 5, url: 'https://github.com/acme/repo/pull/5' },
          ],
          reopens: [
            {
              from: 'IN_REVIEW',
              to: 'IN_PROGRESS',
              at: '2026-06-11T00:00:00Z',
            },
          ],
        },
      })
    )
    render_()
    expect(screen.getByText('the bounced criterion')).toBeInTheDocument()
    // LUM-496: the Run report also has a "PR iterations" KPI tile, so match the
    // struggle trail's own labelled line ("PR iterations: ") specifically.
    expect(screen.getByText(/PR iterations:/)).toBeInTheDocument()
    expect(screen.getByText(/Reopened/)).toBeInTheDocument()
  })
})

// ── LUM-560 ───────────────────────────────────────────────────────────────────
// LUM-496: the cost read-out is the Run report's Cost / Rework KPI tiles — the
// same `data.cost` fields, same fail-closed rule (a null reads "not recorded",
// never 0). The tests below moved onto the tiles; the honesty contract they
// pin is unchanged.
describe('cost tiles', () => {
  it('renders token spend, active time and rework rounds', () => {
    set(
      statusView({
        cost: { tokenCost: 1_200_000, activeTimeSec: 134, reworkRounds: 1 },
      })
    )
    render_()
    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('1.2M')
    // LUM-560/LUM-642: active time is the Cost tile's second sub-caption,
    // through the one shared duration formatter — it did not survive the tile
    // rewrite as a heading of its own, but the reading itself must not vanish.
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent(
      'Active time 2m 14s'
    )
    expect(screen.getByTestId('tile-rework')).toHaveTextContent('1')
  })

  it('shows an explicit not-recorded value when token cost was never measured', () => {
    set(
      statusView({
        cost: { tokenCost: null, activeTimeSec: 0, reworkRounds: 0 },
      })
    )
    render_()
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent(
      /not recorded/i
    )
  })

  it('renders a measured zero as 0, distinct from not-recorded', () => {
    set(
      statusView({ cost: { tokenCost: 0, activeTimeSec: 0, reworkRounds: 0 } })
    )
    render_()
    const tile = screen.getByTestId('tile-costTokens')
    expect(tile).not.toHaveTextContent(/not recorded/i)
    expect(tile).toHaveTextContent('0')
  })
})

// ── LUM-563 ───────────────────────────────────────────────────────────────────
describe('evidence drilldown', () => {
  it('renders a commit pointer as a link to the repo commit url', () => {
    set(
      statusView({
        criteria: [
          machinePass({
            latestVerdict: {
              round: 1,
              verdict: 'PASS',
              verifierType: 'MACHINE',
              evidencePointer: 'commit:abc123def4567',
              rejectionReason: null,
              rejectionReasonEnum: null,
              recordedAt: '2026-06-10T10:00:00.000Z',
            },
          }),
        ],
        struggleTrail: {
          ...emptyTrail(),
          pullRequests: [
            { number: 3, url: 'https://github.com/acme/repo/pull/3' },
          ],
        },
      })
    )
    render_()
    expandMachine()
    fireEvent.click(screen.getByRole('button', { name: /view check output/i }))
    const link = screen.getByRole('link', { name: /commit abc123def4/i })
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/acme/repo/commit/abc123def4567'
    )
  })

  it('renders a file pointer as a path:line locator', () => {
    set(
      statusView({
        criteria: [
          machinePass({
            latestVerdict: {
              round: 1,
              verdict: 'PASS',
              verifierType: 'MACHINE',
              evidencePointer: 'file:lib/services/x.ts:42',
              rejectionReason: null,
              rejectionReasonEnum: null,
              recordedAt: '2026-06-10T10:00:00.000Z',
            },
          }),
        ],
      })
    )
    render_()
    expandMachine()
    fireEvent.click(screen.getByRole('button', { name: /view check output/i }))
    expect(screen.getByText('lib/services/x.ts:42')).toBeInTheDocument()
  })

  it('renders a cmd pointer as the command plus its exit, with a copy affordance', () => {
    set(statusView({ criteria: [machinePass()] }))
    render_()
    expandMachine()
    fireEvent.click(screen.getByRole('button', { name: /view check output/i }))
    expect(screen.getByText(/exit code 0/)).toBeInTheDocument()
    expect(screen.getByTestId('evidence-copy-m1')).toBeInTheDocument()
    // never the raw cmd: encoding
    expect(screen.queryByText(/cmd:npx jest x#exit=0/)).toBeNull()
  })

  it('shows evidence pending for a criterion that requires evidence but has none', () => {
    set(
      statusView({
        criteria: [
          {
            id: 'h1',
            statement: 'human-judged with required proof',
            verifierType: 'HUMAN',
            checkpointer: null,
            evidenceRequired: true,
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
          },
        ],
      })
    )
    render_()
    // LUM-789: the lone criterion is unjudged, hence a tacit pass — its zone
    // now smart-collapses into "Human-judged" by default.
    expandHuman()
    expect(screen.getByText(/evidence pending/i)).toBeInTheDocument()
  })
})

// ── LUM-564 ───────────────────────────────────────────────────────────────────
