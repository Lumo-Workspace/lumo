/** @jest-environment jsdom */
/**
 * LUM-443: Editable two-zone acceptance tab — MACHINE read-only / HUMAN editable.
 * Tests for CriterionRow inline edit/delete + AddCriterionRow + DONE gate.
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

const reviseCriteria = jest.fn().mockResolvedValue({})
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    submitHumanVerdict: jest.fn().mockResolvedValue({}),
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
    reviseCriteria: (...a: unknown[]) => reviseCriteria(...a),
  },
}))

// LUM-467: the tab now leads with the shared header VerdictDecision. Stub it so
// this suite stays focused on the editable contract zone (and avoids pulling its
// next/navigation + comment-editor subtree).
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({
    VerdictDecision: () => <div data-testid='verdict-status' />,
  })
)

import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'

const mockUseTaskStatus = useTaskStatus as jest.Mock

function mockStatusSet(data: ReturnType<typeof statusView>) {
  mockUseTaskStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

// LUM-789: the fixture's lone HUMAN criterion (h1) carries no verdict at
// all — a tacit pass now, not a to-do — so its zone smart-collapses into the
// resolved "Human-judged" record by default. Expand it before interacting
// with the row's Edit/Delete affordances or the add-criterion entry, same as
// this suite always had to for a resolved zone.
function expandHuman() {
  fireEvent.click(
    screen.getByRole('button', {
      name: /Human-judged|Accepted as drafted|Partly judged/i,
    })
  )
}

function statusView(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-443', title: 'x', status: 'IN_REVIEW' },
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
        confirmedAt: null,
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
        confirmedAt: null,
      },
    ],
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  reviseCriteria.mockResolvedValue({})
})

describe('AcceptanceTab editable contract human zone', () => {
  it('AcceptanceTab editable contract human zone — edit sends full desired list with one statement changed', async () => {
    mockStatusSet(statusView())
    render(
      <AcceptanceTab
        taskIdentifier='LUM-443'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expandHuman()
    fireEvent.click(screen.getByLabelText('Edit criterion'))
    const ta = screen.getByDisplayValue('UX feels right')
    fireEvent.change(ta, { target: { value: 'UX feels great' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(reviseCriteria).toHaveBeenCalled())
    const lastCall =
      reviseCriteria.mock.calls[reviseCriteria.mock.calls.length - 1]!
    const [, items] = lastCall
    expect(items).toEqual([
      {
        id: 'm1',
        statement: 'jest green',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest',
        evidenceRequired: false,
      },
      {
        id: 'h1',
        statement: 'UX feels great',
        verifierType: 'HUMAN',
        evidenceRequired: false,
      },
    ])
  })

  it('AcceptanceTab editable contract human zone — delete omits the row from the desired list', async () => {
    mockStatusSet(statusView())
    render(
      <AcceptanceTab
        taskIdentifier='LUM-443'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expandHuman()
    fireEvent.click(screen.getByLabelText('Delete criterion'))
    fireEvent.click(screen.getByText('Remove'))
    await waitFor(() => expect(reviseCriteria).toHaveBeenCalled())
    const deleteCall =
      reviseCriteria.mock.calls[reviseCriteria.mock.calls.length - 1]!
    const [, items] = deleteCall
    expect(items.map((i: { id?: string }) => i.id)).toEqual(['m1'])
  })

  it('AcceptanceTab editable contract human zone — machine zone has no edit affordance', () => {
    mockStatusSet(statusView())
    render(
      <AcceptanceTab
        taskIdentifier='LUM-443'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expandHuman()
    expect(screen.getAllByLabelText('Edit criterion')).toHaveLength(1)
  })

  it('AcceptanceTab editable contract human zone — DONE hides all edit affordances', () => {
    mockStatusSet(
      statusView({
        task: { id: 't1', identifier: 'LUM-443', title: 'x', status: 'DONE' },
      })
    )
    render(
      <AcceptanceTab
        taskIdentifier='LUM-443'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByLabelText('Edit criterion')).toBeNull()
    expect(screen.queryByPlaceholderText(/Add a criterion/i)).toBeNull()
  })

  it('AcceptanceTab editable contract human zone — add appends a HUMAN item with no id', async () => {
    mockStatusSet(statusView())
    render(
      <AcceptanceTab
        taskIdentifier='LUM-443'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expandHuman()
    fireEvent.change(screen.getByPlaceholderText(/Add a criterion/i), {
      target: { value: 'new judgment call' },
    })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(reviseCriteria).toHaveBeenCalled())
    const addCall =
      reviseCriteria.mock.calls[reviseCriteria.mock.calls.length - 1]!
    const [, items] = addCall
    expect(items[items.length - 1]).toEqual({
      statement: 'new judgment call',
      verifierType: 'HUMAN',
    })
  })

  it('AcceptanceTab editable contract human zone — save failure keeps edit open and shows error', async () => {
    reviseCriteria.mockRejectedValueOnce(new Error('network error'))
    mockStatusSet(statusView())
    render(
      <AcceptanceTab
        taskIdentifier='LUM-443'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    expandHuman()
    fireEvent.click(screen.getByLabelText('Edit criterion'))
    const ta = screen.getByDisplayValue('UX feels right')
    fireEvent.change(ta, { target: { value: 'UX feels great' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(screen.getByText("Couldn't save — try again")).toBeInTheDocument()
    )
    // edit panel still open — textarea still visible
    expect(screen.getByDisplayValue('UX feels great')).toBeInTheDocument()
  })
})
