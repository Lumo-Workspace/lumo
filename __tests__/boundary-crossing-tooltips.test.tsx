/** @jest-environment jsdom */
/**
 * LUM-489 (Task 5): BoundaryCrossingsPanel surfaces jargon explanations as
 * InfoTooltips on the per-crossing header — category, severity, disposition,
 * and the recurrence "seen ×N" badge. Each tooltip's accessible name is its
 * explanatory text, asserted via getByLabelText.
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

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))
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
const refresh = jest.fn()

// A single dispositioned crossing makes all four sites render exactly once: its
// per-crossing header carries the category / severity / disposition /
// recurrence badges (always rendered regardless of the row's collapsed state),
// and occurrenceCount > 1 surfaces the "seen ×N" badge. With no open crossing
// the panel is collapsed by default, so the test expands it via the summary
// toggle to mount the row.
const CROSSING = {
  id: 'bc-1',
  category: 'TEST_TAMPERING',
  detail: 'edited a test file',
  detectedAt: '2026-06-11T00:00:00.000Z',
  reversible: true,
  severity: 'MEDIUM',
  disposition: 'FALSE_POSITIVE',
  dispositionNote: null,
  dispositionedAt: '2026-06-11T01:00:00.000Z',
  dispositionedById: null,
  occurrenceCount: 3,
  lastSeenAt: '2026-06-12T00:00:00.000Z',
  remediationTask: null,
  attribution: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockHook.mockReturnValue({
    crossings: [CROSSING],
    loading: false,
    error: null,
    refresh,
  })
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-489' enabled />)
  // No open crossing → panel starts collapsed; expand it to mount the row's
  // header (where all four tooltips live).
  fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
})

describe('Boundary crossing tooltips', () => {
  it('category label has a tooltip', () => {
    expect(
      screen.getByLabelText(
        'A boundary crossing is a forbidden or risky action the agent took. The category says what kind.'
      )
    ).toBeInTheDocument()
  })
  it('severity badge has a tooltip', () => {
    expect(
      screen.getByLabelText(
        'How serious this crossing is. HIGH crossings block marking the task Done until resolved.'
      )
    ).toBeInTheDocument()
  })
  it('disposition badge has a tooltip', () => {
    expect(
      screen.getByLabelText(
        'How this crossing was resolved: false positive (not a real issue), confirmed (a real issue), or auto-cleared by the system.'
      )
    ).toBeInTheDocument()
  })
  it('recurrence "seen ×N" has a tooltip', () => {
    expect(
      screen.getByLabelText(
        'This same crossing was detected multiple times; the count is how many times.'
      )
    ).toBeInTheDocument()
  })
})
