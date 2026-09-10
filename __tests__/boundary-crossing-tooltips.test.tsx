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
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BoundaryCrossingsPanel } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'

const mockHook = useBoundaryCrossings as jest.Mock
const refresh = jest.fn()

// A single dispositioned crossing mounts the row's header once: it carries the
// category / severity / disposition badges (rendered regardless of the row's
// collapsed state). LUM-572 moved reversibility + recurrence off the collapsed
// header into the expanded detail, so the recurrence "seen ×N" test expands the
// row (occurrenceCount > 1 surfaces the badge). With no open crossing the panel
// is collapsed by default, so the test expands it via the summary toggle first.
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

// Renders the panel with a single crossing whose disposition is `disposition`.
// A dispositioned crossing leaves the panel collapsed (no open crossings), so
// we expand it via the summary toggle to mount the row's header; an OPEN
// crossing (disposition: null) makes openCount > 0 so the panel and its row
// start expanded already.
function renderWithDisposition(disposition: string | null) {
  jest.clearAllMocks()
  mockHook.mockReturnValue({
    crossings: [{ ...CROSSING, disposition }],
    loading: false,
    error: null,
    refresh,
  })
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-489' enabled />)
  if (disposition != null) {
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    // LUM-496: rows sit inside a per-category fold; a group with nothing open
    // starts collapsed, so open it to mount the row header.
    fireEvent.click(screen.getByTestId('crossing-group-TEST_TAMPERING'))
  }
}

beforeEach(() => {
  // Default harness: a dispositioned crossing, expanded — all four tooltips live
  // on the row's header.
  renderWithDisposition('FALSE_POSITIVE')
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
    // LUM-572 moved reversibility + recurrence off the collapsed row into the
    // expanded detail; expand the row (dispositioned rows start collapsed).
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-1'))
    expect(
      screen.getByLabelText(
        'This same crossing was detected multiple times; the count is how many times.'
      )
    ).toBeInTheDocument()
  })
  it('crossing row toggles collapse on Enter key', () => {
    // The CROSSING fixture has disposition: FALSE_POSITIVE (not null), so the
    // row starts collapsed (aria-expanded="false") — open=false → collapsed=true.
    const toggle = screen.getByTestId('crossing-toggle-bc-1')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Press Enter — should expand the row.
    fireEvent.keyDown(toggle, { key: 'Enter' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // Press Enter again — should collapse it back.
    fireEvent.keyDown(toggle, { key: 'Enter' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('open crossing has no disposition tooltip', () => {
    // Drop the default (dispositioned) render and mount an OPEN crossing
    // (disposition: null); openCount > 0 so the panel/row render expanded.
    cleanup()
    renderWithDisposition(null)
    expect(
      screen.queryByLabelText(
        'How this crossing was resolved: false positive (not a real issue), confirmed (a real issue), or auto-cleared by the system.'
      )
    ).not.toBeInTheDocument()
  })
})
