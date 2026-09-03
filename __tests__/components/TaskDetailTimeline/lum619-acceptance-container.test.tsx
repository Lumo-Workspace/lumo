/** @jest-environment jsdom */
/**
 * LUM-619: the Record tab collapses into a single "Acceptance" container.
 * Verdict basis (criteria + Verification record) sits above an audit-only
 * separator; the forensic signals (mechanical gates + boundary crossings)
 * sit below it, clearly marked as not deciding the
 * verdict. The after-the-fact metrics fold into a Run report group tucked at
 * the bottom — which no longer holds the verification record or the gates.
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

// Stub the boundary panel to a bare anchor so ordering can be asserted without
// a full BoundaryCrossingView fixture. `#boundary-crossings` is the real root id.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel',
  () => ({
    BoundaryCrossingsPanel: () => <div id='boundary-crossings' />,
  })
)

// Stub VerdictDecision (its verdict ritual + deps are covered by its own tests).
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({
    VerdictDecision: () => <div data-testid='verdict-status' />,
  })
)

// Stub the honest-report leaf sections to bare anchors so we can assert both
// their Run-report membership (cost /
// struggle / trend) without their data subtrees.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/HonestReportSections',
  () => ({
    CostSection: () => <div data-testid='cost' />,
    StruggleTrailSection: () => <div data-testid='struggle' />,
    TrendSection: () => <div data-testid='trend' />,
  })
)

// For the AgentRunsSection assertion: capture whether DeliveryPanel receives a
// footer at all (the gates footer must be gone). AgentRunList is irrelevant here.
jest.mock('@/app/workspace/[workspaceUrl]/components/DeliveryPanel', () => ({
  DeliveryPanel: ({ footer }: { footer?: React.ReactNode }) => (
    <div data-testid='delivery-panel'>
      {footer !== undefined ? <span data-testid='delivery-footer' /> : null}
    </div>
  ),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunList',
  () => ({
    AgentRunList: () => <div data-testid='agent-run-list' />,
  })
)

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { AgentRunsSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AgentRunsSection'
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
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
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
      evidencePointer: 'cmd:jest#exit=0',
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

const oneRound = [
  {
    round: 1,
    recordedAt: '2026-06-10T10:00:00.000Z',
    passed: 1,
    failed: 0,
    verdicts: [
      {
        criterionId: 'm1',
        verifierType: 'MACHINE' as const,
        verdict: 'PASS' as const,
        evidencePointer: null,
        rejectionReason: null,
        rejectionReasonEnum: null,
      },
    ],
  },
]

function set(data: TaskAcceptanceStatusView) {
  mockStatus.mockReturnValue({
    data,
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
      gatesSlot={<div data-testid='gates-slot' />}
      {...extra}
    />
  )
}

function precedes(a: Element | null, b: Element | null) {
  expect(a).not.toBeNull()
  expect(b).not.toBeNull()
  expect(
    a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
}

beforeEach(() => jest.clearAllMocks())

it('LUM-619 acceptance container orders criteria then verification record then audit signals', () => {
  set(
    statusView({
      criteria: [machinePass()],
      verificationHistory: oneRound,
    })
  )
  const { container } = renderTab()

  // LUM-635 IA: criteria → boundary crossings zone →
  // "Evidence & audit trail" card, whose body (record, gates, cost) is
  // collapsed by default. The boundary panel sits with the zones — an open
  // crossing is an actionable Done-blocker — so its anchor is live even while
  // the audit card is collapsed. Expand the card to assert the remaining
  // forensic signals' order.
  const criteria = screen.getByText('Machine-verified')
  const auditCard = screen.getByText('Evidence & audit trail')
  const boundary = container.querySelector('#boundary-crossings')
  precedes(criteria, boundary)
  precedes(boundary, auditCard)
  // LUM-733: the claim strip no longer exists on the tab.
  expect(screen.queryByTestId('claim-vs')).toBeNull()

  fireEvent.click(auditCard)
  const record = screen.getByText('Verification record')
  const gates = screen.getByTestId('gates-slot')
  // Inside the card: verification record → gates.
  precedes(record, gates)
})

it('LUM-619 audit-only separator marks the forensic signals as not part of the verdict', () => {
  set(
    statusView({
      criteria: [machinePass()],
      verificationHistory: oneRound,
    })
  )
  renderTab()
  // LUM-620: the audit-only-divider testid now lives inside the "Evidence &
  // audit trail" button (present even while the card is collapsed).
  const divider = screen.getByTestId('audit-only-divider')
  // The caption names the verdict — it exists to say these signals don't decide it.
  expect(divider.textContent?.toLowerCase()).toContain('verdict')
  // The divider heads the forensic zone — expand and confirm the signals
  // (verification record + gates) sit below it.
  fireEvent.click(screen.getByText('Evidence & audit trail'))
  const record = screen.getByText('Verification record')
  const gates = screen.getByTestId('gates-slot')
  precedes(divider, record)
  precedes(divider, gates)
})

it('LUM-619 verification record renders in the acceptance container not under run report', () => {
  set(
    statusView({
      criteria: [machinePass()],
      verificationHistory: oneRound,
    })
  )
  renderTab()
  // LUM-620: the verification record lives inside the "Evidence & audit trail"
  // card within the Acceptance container — expand the card to reveal it.
  fireEvent.click(screen.getByText('Evidence & audit trail'))
  const record = screen.getByText('Verification record')
  expect(record).toBeInTheDocument()

  // It is NOT a descendant of the Run report group.
  const runReportBtn = screen.getByRole('button', { name: /Run report/i })
  const runReportGroup = runReportBtn.parentElement as HTMLElement
  expect(runReportGroup.contains(record)).toBe(false)
})

it('LUM-619 mechanical gates render in the acceptance audit-only zone and agent runs section does not mount them', () => {
  set(
    statusView({
      criteria: [machinePass()],
      verificationHistory: oneRound,
    })
  )
  renderTab()
  // LUM-620: gates render inside the collapsed "Evidence & audit trail" card,
  // below the audit-only divider (via the injected slot). Expand it first.
  const divider = screen.getByTestId('audit-only-divider')
  fireEvent.click(screen.getByText('Evidence & audit trail'))
  const gates = screen.getByTestId('gates-slot')
  precedes(divider, gates)

  // The Agent runs sub-section no longer passes a footer to DeliveryPanel — the
  // gates footer is gone from there (no duplication).
  render(
    <AgentRunsSection
      taskId='t1'
      taskStatus='DONE'
      runs={[{ id: 'r1' } as never]}
    />
  )
  expect(screen.getByTestId('delivery-panel')).toBeInTheDocument()
  expect(screen.queryByTestId('delivery-footer')).toBeNull()
})

it('LUM-619 run report holds only the after-the-fact metrics', () => {
  set(
    statusView({
      criteria: [machinePass()],
      verificationHistory: oneRound,
    })
  )
  renderTab({
    evidenceSlot: <div data-testid='evidence-slot' />,
  })
  // Expand both the Evidence & audit trail card (so the verification record
  // actually mounts) and the Run report group.
  fireEvent.click(screen.getByText('Evidence & audit trail'))
  fireEvent.click(screen.getByRole('button', { name: /Run report/i }))
  const runReportGroup = screen.getByRole('button', { name: /Run report/i })
    .parentElement as HTMLElement

  // After-the-fact metrics + evidence live here (struggle / trend / evidence).
  expect(
    runReportGroup.querySelector('[data-testid="struggle"]')
  ).not.toBeNull()
  expect(runReportGroup.querySelector('[data-testid="trend"]')).not.toBeNull()
  expect(
    runReportGroup.querySelector('[data-testid="evidence-slot"]')
  ).not.toBeNull()

  // Verdict basis + forensic signals do NOT live under Run report anymore.
  // LUM-620: run cost moved out of Run report and into the Evidence & audit
  // trail card, so cost is no longer here either.
  expect(runReportGroup.querySelector('[data-testid="cost"]')).toBeNull()
  expect(runReportGroup.contains(screen.getByText('Verification record'))).toBe(
    false
  )
  expect(runReportGroup.querySelector('[data-testid="gates-slot"]')).toBeNull()
  expect(runReportGroup.querySelector('#boundary-crossings')).toBeNull()
})

it('LUM-619 acceptance container keeps boundary crossings without a contract', () => {
  set(statusView({ criteria: [] }))
  const { container } = renderTab()
  // The empty-contract note still shows (criteria block swapped for the note)...
  expect(screen.getByText('此任务暂无验收标准')).toBeInTheDocument()
  // ...and the boundary panel is still rendered (contract-independent), inside
  // the Acceptance container's Evidence & audit trail card (above the Run report
  // group). LUM-620: expand the collapsed card to reveal it.
  fireEvent.click(screen.getByText('Evidence & audit trail'))
  const boundary = container.querySelector('#boundary-crossings')
  expect(boundary).not.toBeNull()
  const runReportBtn = screen.getByRole('button', { name: /Run report/i })
  precedes(boundary, runReportBtn)
})
