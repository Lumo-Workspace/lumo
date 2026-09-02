/** @jest-environment jsdom */
/**
 * LUM-730 — the "Claim vs verification" section is hidden by default and only
 * appears when the claim disagrees with the delivery. LUM-597 made the claim
 * "quiet when faithful, loud on a mismatch"; this takes it to its end — a
 * faithful / unjudged / absent claim renders no section at all (not merely a
 * collapsed one), so the Acceptance tab loses a block of noise on the common
 * path and the section itself becomes the alarm.
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
import { render, screen, within } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { ClaimVsVerification } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/HonestReportSections'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import {
  shouldShowClaimVsVerification,
  type ClaimFaithfulnessState,
} from '@/lib/claim-faithfulness/claim-mismatch'
import type { ClaimVerdict } from '@/lib/claim-faithfulness/types'
import type {
  TaskAcceptanceStatusView,
  TaskClaimFaithfulnessView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock

const TITLE = 'Claim vs verification'

function faithfulness(
  over: Partial<TaskClaimFaithfulnessView> = {}
): TaskClaimFaithfulnessView {
  return {
    state: 'FAITHFUL',
    verdict: 'FAITHFUL',
    evidence: [],
    reasoning: null,
    diffShas: [],
    prNumbers: [],
    judgedAt: '2026-06-20T12:00:00.000Z',
    judgedClaimAt: '2026-06-20T10:00:00.000Z',
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
      evidencePointer: null,
      rejectionReason: null,
      rejectionReasonEnum: null,
      recordedAt: '2026-06-20T12:00:00.000Z',
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

function statusView(
  over: Partial<TaskAcceptanceStatusView> = {}
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-730', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [machinePass()],
    machineVerification: { total: 1, machineVerified: 1, humanOverridden: 0 },
    claim: { text: 'I hid the claim section.', source: 'AGENT' },
    faithfulness: faithfulness(),
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

// Every state × verdict the client type admits. The `satisfies` + the
// exhaustiveness check below fail to compile if a state is added to the union
// without being listed here — a new state cannot slip past the table.
const STATES = [
  'FAITHFUL',
  'OVERSTATED',
  'UNDERREPORT',
  'UNJUDGEABLE',
  'PENDING',
  'STALE',
] as const satisfies readonly ClaimFaithfulnessState[]
type Listed = (typeof STATES)[number]
const _exhaustive: [ClaimFaithfulnessState] extends [Listed] ? true : never =
  true
void _exhaustive

const VERDICTS = [
  'FAITHFUL',
  'OVERSTATED',
  'UNDERREPORT',
  'UNJUDGEABLE',
  null,
] as const satisfies readonly (ClaimVerdict | null)[]

const MISMATCH = new Set<ClaimVerdict | null>(['OVERSTATED', 'UNDERREPORT'])

describe('LUM-730 · Claim vs verification hidden unless the claim mismatches', () => {
  it('LUM-730 · shouldShowClaimVsVerification is true only for a mismatched faithfulness verdict', () => {
    // Absent faithfulness (no claim yet / older server) is not a conflict.
    expect(shouldShowClaimVsVerification(undefined)).toBe(false)
    expect(shouldShowClaimVsVerification(null)).toBe(false)

    const seen: string[] = []
    for (const state of STATES) {
      for (const verdict of VERDICTS) {
        const expected =
          state === 'OVERSTATED' ||
          state === 'UNDERREPORT' ||
          (state === 'STALE' && MISMATCH.has(verdict))
        expect({
          state,
          verdict,
          show: shouldShowClaimVsVerification({ state, verdict }),
        }).toEqual({ state, verdict, show: expected })
        seen.push(`${state}/${verdict}`)
      }
    }
    expect(seen).toHaveLength(STATES.length * VERDICTS.length)
  })

  it('LUM-730 · ClaimVsVerification renders nothing when the claim is faithful or unjudged', () => {
    const quiet: Array<{ name: string; data: TaskAcceptanceStatusView }> = [
      { name: 'faithful', data: statusView() },
      {
        name: 'pending',
        data: statusView({
          faithfulness: faithfulness({ state: 'PENDING', verdict: null }),
        }),
      },
      {
        name: 'unjudgeable',
        data: statusView({
          faithfulness: faithfulness({
            state: 'UNJUDGEABLE',
            verdict: 'UNJUDGEABLE',
          }),
        }),
      },
      {
        name: 'stale but faithful',
        data: statusView({
          faithfulness: faithfulness({ state: 'STALE', verdict: 'FAITHFUL' }),
        }),
      },
      {
        name: 'no claim',
        data: (() => {
          const { faithfulness: _f, ...rest } = statusView({
            claim: { text: null, source: null },
          })
          return rest
        })(),
      },
      {
        name: 'older server without faithfulness',
        data: (() => {
          const { faithfulness: _f, ...rest } = statusView()
          return rest
        })(),
      },
      {
        // A failed criterion is the criteria list's job — it never pulls the
        // section back on its own.
        name: 'faithful with unmet criteria',
        data: statusView({
          nextActions: [{ criterionId: 'm1', statement: 'x' }] as never,
        }),
      },
    ]
    for (const { name, data } of quiet) {
      const { container, unmount } = render(<ClaimVsVerification data={data} />)
      // The section is gone, not collapsed: no container, no header, no
      // verification block, no reality-check row.
      expect({ name, html: container.innerHTML }).toEqual({ name, html: '' })
      expect(screen.queryByText(TITLE)).toBeNull()
      expect(screen.queryByTestId('verification-main')).toBeNull()
      expect(screen.queryByTestId('claim-reality-check')).toBeNull()
      unmount()
    }
  })

  it('LUM-730 · ClaimVsVerification renders open with the faithfulness row on a mismatch', () => {
    const loud: Array<{
      f: TaskClaimFaithfulnessView
      chip: RegExp
      state: string
    }> = [
      {
        f: faithfulness({ state: 'OVERSTATED', verdict: 'OVERSTATED' }),
        chip: /Overstated/,
        state: 'OVERSTATED',
      },
      {
        f: faithfulness({ state: 'UNDERREPORT', verdict: 'UNDERREPORT' }),
        chip: /Under-reported/,
        state: 'UNDERREPORT',
      },
      {
        f: faithfulness({ state: 'STALE', verdict: 'UNDERREPORT' }),
        chip: /Under-reported.*stale/,
        state: 'STALE',
      },
    ]
    for (const { f, chip, state } of loud) {
      const { unmount } = render(
        <ClaimVsVerification data={statusView({ faithfulness: f })} />
      )
      expect(screen.getByText(TITLE)).toBeInTheDocument()
      // Expanded by default — the alarm is not tucked behind a chevron.
      expect(
        screen.getByRole('button', { name: new RegExp(TITLE) })
      ).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('verification-main')).toBeInTheDocument()
      const row = screen.getByTestId('faithfulness-row')
      expect(row).toHaveAttribute('data-faithfulness-state', state)
      expect(within(row).getByTestId('faithfulness-chip')).toHaveTextContent(
        chip
      )
      unmount()
    }
  })

  it('LUM-730 · AcceptanceTab omits the Claim vs verification container for a faithful task', () => {
    const set = (data: TaskAcceptanceStatusView) =>
      mockStatus.mockReturnValue({
        data,
        loading: false,
        error: null,
        refresh: jest.fn(),
      })
    const tab = () => (
      <AcceptanceTab
        taskIdentifier='LUM-730'
        enabled={true}
        onVerdictRecorded={jest.fn()}
      />
    )

    // Faithful task (criteria present, so the mount gate is open) → no section.
    set(statusView())
    const { rerender } = render(tab())
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(screen.queryByTestId('verification-main')).toBeNull()

    // Same task, the claim judged overstated → the section appears in the tab.
    set(
      statusView({
        faithfulness: faithfulness({
          state: 'OVERSTATED',
          verdict: 'OVERSTATED',
        }),
      })
    )
    rerender(tab())
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    expect(screen.getByTestId('faithfulness-row')).toHaveAttribute(
      'data-faithfulness-state',
      'OVERSTATED'
    )
  })
})
