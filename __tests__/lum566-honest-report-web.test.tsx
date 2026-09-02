/** @jest-environment jsdom */
/**
 * LUM-566: the web task-detail Acceptance tab renders the honest-report sections
 * that LUM-559~564 put into `lumo task status` + the server read model — the
 * struggle / rework trail (561), the cost read-out (560), evidence drill-down
 * (563), and the claim-vs-verification pairing with provenance (564). The data
 * already rides on GET /api/tasks/[id]/status; this proves the web renders it
 * same-source, fail-closed, with no rendering drift from the CLI.
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
  TaskClaimFaithfulnessView,
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

/** LUM-730: the claim-vs-verification section only renders on a mismatch, so
 *  fixtures that expect it default to an OVERSTATED verdict. */
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
  // cost + verification history moved into the collapsed "Evidence & audit
  // trail" card (LUM-620). Expand both so these same-source sections render. The
  // claim-vs-verification pairing stays above them, unaffected.
  fireEvent.click(screen.getByRole('button', { name: /Run report/i }))
  fireEvent.click(screen.getByText('Evidence & audit trail'))
  return result
}

function expandMachine() {
  fireEvent.click(screen.getByRole('button', { name: /Machine-verified/i }))
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
    expect(screen.getByText(/PR iterations/)).toBeInTheDocument()
    expect(screen.getByText(/Reopened/)).toBeInTheDocument()
  })
})

// ── LUM-560 ───────────────────────────────────────────────────────────────────
describe('cost section', () => {
  it('renders token spend, active time and rework rounds', () => {
    set(
      statusView({
        cost: { tokenCost: 1_200_000, activeTimeSec: 134, reworkRounds: 1 },
      })
    )
    render_()
    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByText(/1\.2M/)).toBeInTheDocument()
  })

  it('shows an explicit not-recorded line when token cost was never measured', () => {
    set(
      statusView({
        cost: { tokenCost: null, activeTimeSec: 0, reworkRounds: 0 },
      })
    )
    render_()
    expect(screen.getByText(/not recorded/i)).toBeInTheDocument()
  })

  it('renders a measured zero as 0, distinct from not-recorded', () => {
    set(
      statusView({ cost: { tokenCost: 0, activeTimeSec: 0, reworkRounds: 0 } })
    )
    render_()
    expect(screen.queryByText(/not recorded/i)).toBeNull()
    expect(screen.getByTestId('cost-tokens')).toHaveTextContent('0')
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
    expect(screen.getByText(/evidence pending/i)).toBeInTheDocument()
  })
})

// ── LUM-564 ───────────────────────────────────────────────────────────────────
describe('claim vs verification', () => {
  it('pairs the agent claim with an estimated provenance badge against the measured rollup', () => {
    set(
      statusView({
        currentRound: 1,
        claim: {
          text: 'Implemented the four sections and wired them in.',
          source: 'RUN_SUMMARY',
        },
        // LUM-730: the pairing only renders on a mismatch.
        faithfulness: overstated(),
        machineVerification: {
          total: 2,
          machineVerified: 2,
          humanOverridden: 0,
        },
        criteria: [
          machinePass(),
          machinePass({ id: 'm2', statement: 'second' }),
        ],
      })
    )
    render_()
    expect(screen.getByText('Claim vs verification')).toBeInTheDocument()
    expect(
      screen.getByText('Implemented the four sections and wired them in.')
    ).toBeInTheDocument()
    // LUM-597: a RUN_SUMMARY claim is a summarizer paraphrase fallback, so the
    // provenance reads SYNTHESIZED (the authoritative source is the agent's own
    // self-report, source AGENT).
    expect(screen.getByTestId('claim-provenance')).toHaveTextContent(/synthes/i)
    // the measured rollup phrase — distinct from the machine-zone header.
    expect(
      screen.getByText(/2 machine-verified · 0 human override/)
    ).toBeInTheDocument()
  })

  it('omits the whole claim-vs-verification section when there is no claim (no empty box)', () => {
    set(statusView({ claim: { text: null, source: null } }))
    render_()
    // LUM-597 decision-first collapsed the reality-check row; LUM-730 takes it
    // to its end — with nothing to compare there is no mismatch, so the whole
    // section (verification block included) is absent from the tab.
    expect(screen.queryByTestId('claim-reality-check')).toBeNull()
    expect(screen.queryByTestId('verification-main')).toBeNull()
    expect(screen.queryByText('Claim vs verification')).toBeNull()
  })

  it('omits the section for a faithful claim and shows it once the claim mismatches (LUM-730)', () => {
    set(
      statusView({
        claim: { text: 'did the thing', source: 'AGENT' },
        faithfulness: overstated({ state: 'FAITHFUL', verdict: 'FAITHFUL' }),
      })
    )
    const { unmount } = render_()
    expect(screen.queryByText('Claim vs verification')).toBeNull()
    unmount()

    set(
      statusView({
        claim: { text: 'did the thing', source: 'AGENT' },
        faithfulness: overstated({
          state: 'UNDERREPORT',
          verdict: 'UNDERREPORT',
        }),
      })
    )
    render_()
    expect(screen.getByText('Claim vs verification')).toBeInTheDocument()
    expect(screen.getByTestId('faithfulness-chip')).toHaveTextContent(
      /Under-reported/
    )
  })

  it('marks the verification side unconfirmed before any round has run', () => {
    set(
      statusView({
        currentRound: 0,
        claim: { text: 'did the thing', source: 'DIGEST' },
        // LUM-730: a stale mismatch from an earlier claim keeps the section up.
        faithfulness: overstated({ state: 'STALE', verdict: 'OVERSTATED' }),
      })
    )
    render_()
    expect(screen.getByText(/unconfirmed/i)).toBeInTheDocument()
  })
})
