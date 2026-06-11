/** @jest-environment jsdom */
/**
 * LUM-423: the read-only Acceptance tab renders the LUM-344 status read model —
 * each criterion's statement + type + provenance + latest verdict glyph +
 * evidence, the human-override marker, and the round / failures / next-actions
 * blocks. No new backend; the tab just consumes the read model.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
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

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import type { TaskAcceptanceStatusView } from '@/app/workspace/[workspaceUrl]/types'

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
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

function render_(identifier = 'LUM-1') {
  return render(<AcceptanceTab taskIdentifier={identifier} enabled={true} />)
}

beforeEach(() => jest.clearAllMocks())

it('renders an empty state when the task has no criteria', () => {
  mockStatus.mockReturnValue({
    data: statusView({ criteria: [] }),
    loading: false,
    error: null,
  })
  render_()
  expect(screen.getByText('此任务暂无验收标准')).toBeInTheDocument()
})

it('renders each criterion with type, provenance, and its latest verdict', () => {
  mockStatus.mockReturnValue({
    data: statusView({
      criteria: [
        {
          id: 'c1',
          statement: 'route returns 409 on lock',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest x',
          evidenceRequired: false,
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
        },
        {
          id: 'c2',
          statement: 'gap found in review',
          verifierType: 'HUMAN',
          checkpointer: null,
          evidenceRequired: false,
          source: 'REVIEW_ADDED',
          addedAtRound: 2,
          latestVerdict: null,
        },
      ],
    }),
    loading: false,
    error: null,
  })
  render_()

  expect(screen.getByText('route returns 409 on lock')).toBeInTheDocument()
  expect(screen.getByText('cmd:jest#exit=0')).toBeInTheDocument()
  // REVIEW_ADDED provenance is explicitly visible; unjudged criterion shown.
  expect(screen.getByText('REVIEW_ADDED')).toBeInTheDocument()
  expect(screen.getByText('not yet judged')).toBeInTheDocument()
})

it('marks a human-authored PASS as a human override, but not a machine PASS', () => {
  mockStatus.mockReturnValue({
    data: statusView({
      criteria: [
        {
          id: 'c1',
          statement: 'machine passed',
          verifierType: 'MACHINE',
          checkpointer: 'x',
          evidenceRequired: false,
          source: 'AGENT_DRAFT',
          addedAtRound: 0,
          latestVerdict: {
            round: 1,
            verdict: 'PASS',
            verifierType: 'MACHINE',
            evidencePointer: null,
            rejectionReason: null,
            rejectionReasonEnum: null,
            recordedAt: '2026-06-10T10:00:00.000Z',
          },
        },
        {
          id: 'c2',
          statement: 'human judged',
          verifierType: 'HUMAN',
          checkpointer: null,
          evidenceRequired: false,
          source: 'AGENT_DRAFT',
          addedAtRound: 0,
          latestVerdict: {
            round: 1,
            verdict: 'PASS',
            verifierType: 'HUMAN',
            evidencePointer: null,
            rejectionReason: null,
            rejectionReasonEnum: null,
            recordedAt: '2026-06-10T11:00:00.000Z',
          },
        },
      ],
    }),
    loading: false,
    error: null,
  })
  render_()

  // Exactly one human-override badge — the HUMAN PASS, not the MACHINE PASS.
  expect(screen.getAllByText('human override')).toHaveLength(1)
})

it('renders last-round failures and next actions blocks', () => {
  mockStatus.mockReturnValue({
    data: statusView({
      currentRound: 2,
      criteria: [
        {
          id: 'c1',
          statement: 'still failing',
          verifierType: 'MACHINE',
          checkpointer: 'x',
          evidenceRequired: false,
          source: 'AGENT_DRAFT',
          addedAtRound: 0,
          latestVerdict: {
            round: 2,
            verdict: 'FAIL',
            verifierType: 'MACHINE',
            evidencePointer: null,
            rejectionReason: 'exit code 1',
            rejectionReasonEnum: null,
            recordedAt: '2026-06-10T12:00:00.000Z',
          },
        },
      ],
      lastRoundFailures: [
        {
          criterionId: 'c1',
          statement: 'still failing',
          rejectionReason: 'exit code 1',
          rejectionReasonEnum: null,
        },
      ],
      nextActions: [
        {
          criterionId: 'c1',
          statement: 'still failing',
          verifierType: 'MACHINE',
          checkpointer: 'x',
          source: 'AGENT_DRAFT',
          addedAtRound: 0,
          rejectionReason: 'exit code 1',
        },
      ],
    }),
    loading: false,
    error: null,
  })
  render_()

  expect(screen.getByText('Last round failures')).toBeInTheDocument()
  expect(screen.getByText('Next actions')).toBeInTheDocument()
  // The FAIL reason surfaces (appears in the criterion row + the failures list).
  expect(screen.getAllByText(/exit code 1/).length).toBeGreaterThan(0)
})
