/** @jest-environment jsdom */
/**
 * LUM-455 criterion 3 — when a TEST_TAMPERING crossing's inline diff is truncated
 * (or its content is unavailable), the fallback offers a REAL, clickable link to
 * the task's PR when one exists, and an explicit "No linked PR" note when none —
 * never a dead "open the PR" instruction with no link behind it.
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
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
  },
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { BoundaryCrossingsPanel } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'

const mockHook = useBoundaryCrossings as jest.Mock
const PR = 'https://github.com/acme/repo/pull/42'
const PR_FILE = `${PR}/files#diff-abc123`

/** A TEST_TAMPERING crossing carrying a specific edit-change view. */
const crossing = (editChange: Record<string, unknown>) => ({
  id: 'bc-1',
  category: 'TEST_TAMPERING',
  detail: 'edited __tests__/widget.test.ts',
  detectedAt: '2026-06-12T00:00:00.000Z',
  reversible: false,
  severity: 'MEDIUM',
  disposition: null,
  dispositionNote: null,
  dispositionedAt: null,
  dispositionedById: null,
  remediationTask: null,
  editChange,
})

function renderWith(editChange: Record<string, unknown>) {
  mockHook.mockReturnValue({
    crossings: [crossing(editChange)],
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
  return render(<BoundaryCrossingsPanel taskIdentifier='LUM-455' enabled />)
}

describe('BoundaryCrossingsPanel — PR fallback link (LUM-455)', () => {
  it('truncated TEST_TAMPERING diff links to the task PR or states there is none', () => {
    // (1) Truncated WITH a synced PR → a real anchor pointing straight at the
    //     changed file's diff inside the PR (prFileUrl), not the PR root.
    const withPr = renderWith({
      kind: 'edit',
      oldText: 'expect(x).toBe(1)',
      newText: 'expect(x).toBe(2)',
      truncated: true,
      unavailable: null,
      prUrl: PR,
      prFileUrl: PR_FILE,
    })
    fireEvent.click(screen.getByText('Show what the edit changed'))
    const link = screen.getByRole('link', { name: /View PR/ })
    expect(link).toHaveAttribute('href', PR_FILE)
    withPr.unmount()

    // (2) Truncated WITHOUT a PR → explicit "No linked PR", and NO dead link.
    const noPr = renderWith({
      kind: 'edit',
      oldText: 'expect(x).toBe(1)',
      newText: 'expect(x).toBe(2)',
      truncated: true,
      unavailable: null,
      prUrl: null,
      prFileUrl: null,
    })
    fireEvent.click(screen.getByText('Show what the edit changed'))
    expect(screen.getByText('No linked PR')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /View PR/ })).toBeNull()
    noPr.unmount()

    // (3) Content entirely unavailable WITHOUT a PR → same explicit "No linked PR"
    //     (the fallback is shown without expanding), never a dead instruction.
    renderWith({
      kind: null,
      oldText: null,
      newText: null,
      truncated: false,
      unavailable: 'NO_EVENT',
      prUrl: null,
      prFileUrl: null,
    })
    expect(screen.getByText('No linked PR')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /View PR/ })).toBeNull()
  })

  it('surfaces the agent intent for the turn an edit belongs to (LUM-455)', () => {
    renderWith({
      kind: 'edit',
      oldText: 'expect(x).toBe(1)',
      newText: 'expect(x).toBe(2)',
      truncated: false,
      unavailable: null,
      prUrl: PR,
      prFileUrl: PR_FILE,
      agentTurnContext: 'Loosened the rounding assertion to match the new API',
    })
    expect(screen.getByText(/Agent's intent this turn:/)).toBeInTheDocument()
    expect(
      screen.getByText(/Loosened the rounding assertion/)
    ).toBeInTheDocument()
  })
})
