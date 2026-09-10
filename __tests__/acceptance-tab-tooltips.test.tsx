/** @jest-environment jsdom */
/**
 * LUM-489: Acceptance tab simplification + zone tooltips.
 * - drops the redundant top total-count meta line
 * - drops the "· read-only" machine-zone decoration and the human-zone "/ 7" quota
 * - adds InfoTooltip explanations to the machine and human zone headers
 */
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  // jsdom has no ResizeObserver; Radix tooltip arrow uses it for sizing.
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

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
import { render, screen, fireEvent, act } from '@testing-library/react'
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

/** LUM-733: per-criterion pass / send-back controls only render while a
 *  send-back stands (some criterion's latest verdict is FAIL). */
const SEND_BACK_STANDING = {
  criteria: statusView().criteria.map((c: Record<string, unknown>) =>
    c.id === 'h1'
      ? {
          ...c,
          latestVerdict: {
            round: 1,
            verdict: 'FAIL',
            evidencePointer: null,
            rejectionReason: 'copy still off',
            rejectionReasonEnum: null,
            recordedAt: '2026-06-01T00:00:00.000Z',
          },
        }
      : c
  ),
}

function renderAcceptanceTab(over: Record<string, unknown> = {}) {
  mockUseTaskStatus.mockReturnValue({
    data: statusView(over),
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
  // LUM-620: the machine zone was demoted to a collapsible summary — its meaning
  // is now carried inline by the "Machine-verified" header + a verified-count
  // caption, not by a hover tooltip. Assert that inline self-explanation.
  it('machine zone header explains machine verification inline (summary caption)', () => {
    renderAcceptanceTab()
    // LUM-496: an unverified machine check blocks Done, so the default (unjudged)
    // fixture surfaces it in the NEEDS ACTION card rather than the Machine-verified
    // records card. Same contract as before: the header and its summary caption
    // carry the meaning inline — no hover tooltip.
    expect(
      screen.getByText('Machine checks awaiting verification')
    ).toBeInTheDocument()
    expect(screen.getByText('0 verified · 1 awaiting')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Machine-verified/ })
    ).toBeNull()
  })

  // LUM-620: the human zone matches the machine zone — a collapsible summary
  // whose meaning is carried inline by the "Needs your judgment" / "Human-judged"
  // header + a "not machine-checkable" caption, not by a hover tooltip.
  it('human zone explains itself inline (header + not-machine-checkable caption)', () => {
    renderAcceptanceTab()
    expect(
      screen.getByRole('button', { name: /Needs your judgment/ })
    ).toBeInTheDocument()
    expect(screen.getByText('not machine-checkable')).toBeInTheDocument()
  })
})

// LUM-489 (Task 4): per-row term tooltips on CriterionRow.
function machineCriterion(over: Record<string, unknown> = {}) {
  return {
    id: 'mc1',
    statement: 'jest green',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest',
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

function renderWithCriteria(criteria: Record<string, unknown>[]) {
  mockUseTaskStatus.mockReturnValue({
    data: statusView({ criteria }),
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

// LUM-492 (Task 3): verdict action tooltips are now on the buttons themselves
// (ActionTooltip / Radix), not on a sibling ⓘ (InfoTooltip). The HUMAN
// criterion in the default fixture is unverified so its VerdictControls render.
describe('Verdict action tooltips (send-back)', () => {
  it('send-back button is itself the tooltip trigger — no nested button inside it', () => {
    renderAcceptanceTab(SEND_BACK_STANDING)
    const sendBack = screen.getByTestId('verdict-sendback-h1')
    expect(sendBack.querySelector('button')).toBeNull()
  })

  it('pass button is itself the tooltip trigger — no nested button inside it', () => {
    renderAcceptanceTab(SEND_BACK_STANDING)
    const passBtn = screen.getByTestId('verdict-pass-h1')
    expect(passBtn.querySelector('button')).toBeNull()
  })

  it('focusing the pass button reveals the pass tip text', async () => {
    renderAcceptanceTab(SEND_BACK_STANDING)
    act(() => {
      screen.getByTestId('verdict-pass-h1').focus()
    })
    // Radix renders a visually-hidden duplicate; findAllByText covers both copies.
    const hits = await screen.findAllByText('Mark this criterion met.')
    expect(hits.length).toBeGreaterThan(0)
  })

  it('focusing the send-back button reveals the send-back tip text', async () => {
    renderAcceptanceTab(SEND_BACK_STANDING)
    act(() => {
      screen.getByTestId('verdict-sendback-h1').focus()
    })
    const hits = await screen.findAllByText(
      'Reject this criterion and send the task back to the agent for another round.'
    )
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe('CriterionRow term tooltips', () => {
  it('human-override badge on a criterion has a tooltip', () => {
    // A MACHINE criterion currently passing without a checkpointer pass behind
    // it (machinePassed=false) is the canonical human override. It is not
    // machine-verified, so the machine zone is open by default.
    renderWithCriteria([
      machineCriterion({
        id: 'override-crit',
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          verifierType: 'HUMAN',
          evidencePointer: null,
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-06-13T00:00:00.000Z',
        },
        machinePassed: false,
      }),
    ])
    expect(
      screen.getByLabelText(
        'A person marked this criterion passed without a machine check confirming it.'
      )
    ).toBeInTheDocument()
  })

  it('evidence/checkpointer disclosure has a tooltip explaining the proof', () => {
    // A machine criterion with a checkpointer + passing machine evidence. Its
    // disclosure ("View check output") is collapsed by default; expand it.
    renderWithCriteria([
      machineCriterion({
        id: 'evidence-crit',
        checkpointer: 'npx jest',
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          verifierType: 'MACHINE',
          evidencePointer: 'cmd:npx jest#exit=0',
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-06-13T00:00:00.000Z',
        },
        machinePassed: true,
      }),
    ])
    // Zone may be collapsed (all verified) — open it, then expand the row.
    const zoneToggle = screen.getByRole('button', { name: /Machine-verified/ })
    if (zoneToggle.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(zoneToggle)
    }
    fireEvent.click(screen.getByRole('button', { name: /View check output/ }))
    expect(
      screen.getByLabelText(
        'The command (checkpointer) that was run to verify this criterion, and its exit code. Exit 0 means it passed.'
      )
    ).toBeInTheDocument()
  })

  it('stale-pass marker has a tooltip', () => {
    // A passing MACHINE criterion flagged stale (verdict predates an edit).
    renderWithCriteria([
      machineCriterion({
        id: 'stale-crit',
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          verifierType: 'MACHINE',
          evidencePointer: 'cmd:npx jest#exit=0',
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-06-13T00:00:00.000Z',
        },
        machinePassed: true,
        verdictStale: true,
      }),
    ])
    // A stale-but-verified machine crit collapses the zone — open it.
    const zoneToggle = screen.getByRole('button', { name: /Machine-verified/ })
    if (zoneToggle.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(zoneToggle)
    }
    expect(
      screen.getByLabelText(
        'This passed against an earlier version of the criterion. Re-run lumo verify to re-confirm.'
      )
    ).toBeInTheDocument()
  })
})

// LUM-489 (Task 7): tooltips for the judgeSteps "How to judge" heading and the
// verification record (round history) title.
function humanCriterion(over: Record<string, unknown> = {}) {
  return {
    id: 'hc1',
    statement: 'UX feels right',
    verifierType: 'HUMAN',
    checkpointer: null,
    evidenceRequired: false,
    judgeSteps: null,
    source: 'HUMAN_EDIT',
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

function verificationRound(over: Record<string, unknown> = {}) {
  return {
    round: 1,
    recordedAt: '2026-06-13T00:00:00.000Z',
    passed: 1,
    failed: 0,
    verdicts: [
      {
        criterionId: 'm1',
        verdict: 'PASS',
        verifierType: 'MACHINE',
        evidencePointer: 'cmd:npx jest#exit=0',
        rejectionReason: null,
        rejectionReasonEnum: null,
      },
    ],
    ...over,
  }
}

function renderWithData(over: Record<string, unknown>) {
  mockUseTaskStatus.mockReturnValue({
    data: statusView(over),
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

describe('Judge steps & history tooltips', () => {
  it('judge-steps heading has a tooltip', () => {
    // A HUMAN criterion carrying judgeSteps renders the JudgeStepsBlock, whose
    // "How to judge" heading now carries the explanatory tooltip.
    renderWithCriteria([
      humanCriterion({
        id: 'judged-crit',
        judgeSteps: 'Open the dialog. Confirm the layout. Pass if no overlap.',
      }),
    ])
    expect(
      screen.getByLabelText(
        'Agent-drafted guidance for the human reviewer: where to look and what counts as pass or fail.'
      )
    ).toBeInTheDocument()
  })

  it('verification history title has a tooltip explaining round markers', () => {
    // LUM-620 moved the history section into the collapsed "Evidence & audit
    // trail" card, so expand that card first; the title (a plain div) and its
    // tooltip then render whenever there is at least one round.
    renderWithData({ verificationHistory: [verificationRound()] })
    fireEvent.click(screen.getByText('Evidence & audit trail'))
    expect(
      screen.getByLabelText(
        'Each round is one verification pass. MACHINE = checkpointer run, HUMAN = person verdict, AGENT = agent sent the task back.'
      )
    ).toBeInTheDocument()
  })
})
