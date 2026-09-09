/** @jest-environment jsdom */
/**
 * LUM-435 criterion 6 — the panel reads clearly across the four crossing states
 * (open / confirmed / remediated / false-positive), offers the human-only
 * disposition, nudges (not forces) remediation, and keeps confirmed crossings
 * on record.
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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BoundaryCrossingsPanel } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
import { tasksClient } from '@/lib/api-client'

const mockHook = useBoundaryCrossings as jest.Mock
const mockDisposition = tasksClient.dispositionBoundaryCrossing as jest.Mock
const mockSpawn = tasksClient.spawnBoundaryRemediation as jest.Mock

const refresh = jest.fn()

const OPEN = {
  id: 'bc-open',
  category: 'PUSH_TO_PROTECTED_BRANCH',
  detail: 'git push origin main --force',
  detectedAt: '2026-06-11T00:00:00.000Z',
  reversible: false,
  severity: 'MEDIUM',
  disposition: null,
  dispositionNote: null,
  dispositionedAt: null,
  dispositionedById: null,
  remediationTask: null,
  attribution: {
    workspaceMemberId: 'member-7',
    sessionId: 'sess-abcdef0123456789',
    agent: 'CLAUDE_CODE',
    worktreeBranch: 'lumo/LUM-469',
    model: 'claude-opus-4-8',
  },
}

function setCrossings(crossings: unknown[]) {
  mockHook.mockReturnValue({ crossings, loading: false, error: null, refresh })
}

beforeEach(() => {
  jest.clearAllMocks()
  setCrossings([OPEN])
})

describe('BoundaryCrossingsPanel', () => {
  it('renders nothing when the task has no crossings', () => {
    setCrossings([])
    const { container } = render(
      <BoundaryCrossingsPanel taskIdentifier='LUM-435' enabled />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('an open crossing reads clearly and offers both human-only dispositions', () => {
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-435' enabled />)
    expect(screen.getByText('push to a protected branch')).toBeInTheDocument()
    expect(screen.getByText('git push origin main --force')).toBeInTheDocument()
    // reversibility is legible
    expect(screen.getByText('irreversible')).toBeInTheDocument()
    // both dispositions present
    expect(
      screen.getByTestId('boundary-false-positive-bc-open')
    ).toBeInTheDocument()
    expect(screen.getByTestId('boundary-confirm-bc-open')).toBeInTheDocument()
    // human-only redline marker
    expect(screen.getByText(/agent\/CLI path is closed/)).toBeInTheDocument()
    // severity tier is legible (LUM-442)…
    expect(screen.getByText('medium severity')).toBeInTheDocument()
    // …and the defense-in-depth limitation is surfaced so the signal isn't over-trusted.
    expect(
      screen.getByText(/Defense-in-depth, not a hard boundary/)
    ).toBeInTheDocument()
  })

  it('surfaces read-only attribution — which model + which agent/session crossed (LUM-469)', () => {
    render(
      <BoundaryCrossingsPanel
        taskIdentifier='LUM-469'
        enabled
        members={[{ id: 'member-7', name: 'Chao' } as never]}
      />
    )
    // The reviewer can read the model and the agent/session that committed it.
    expect(screen.getByText('model: claude-opus-4-8')).toBeInTheDocument()
    expect(
      screen.getByText('agent: CLAUDE_CODE · lumo/LUM-469')
    ).toBeInTheDocument()
    // Session UUID is clipped to a correlatable prefix.
    expect(screen.getByText('session: sess-abc')).toBeInTheDocument()
    // Owner resolves to the member display name from the members list.
    expect(screen.getByText('owner: Chao')).toBeInTheDocument()
  })

  it('attribution degrades to unknown when unresolved, without crashing (LUM-469)', () => {
    setCrossings([{ ...OPEN, id: 'bc-unknown', attribution: undefined }])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-469' enabled />)
    expect(screen.getByText('model: unknown')).toBeInTheDocument()
    expect(screen.getByText('agent: unknown')).toBeInTheDocument()
    expect(screen.getByText('session: unknown')).toBeInTheDocument()
  })

  it('surfaces a HIGH-severity crossing prominently (LUM-442)', () => {
    setCrossings([{ ...OPEN, id: 'bc-high', severity: 'HIGH' }])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-442' enabled />)
    expect(screen.getByText('high severity')).toBeInTheDocument()
  })

  it('shows a recurrence count when a crossing coalesced repeats (LUM-477)', () => {
    // A coalesced crossing carries occurrenceCount > 1 → the reviewer sees it
    // recurred (and still dispositions it once, on the single row).
    setCrossings([
      {
        ...OPEN,
        id: 'bc-rep',
        occurrenceCount: 3,
        lastSeenAt: '2026-06-12T00:00:00.000Z',
      },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-477' enabled />)
    expect(screen.getByTestId('crossing-recurrence-bc-rep')).toHaveTextContent(
      'seen ×3'
    )
    // Still exactly one disposition control for the repeated crossing.
    expect(screen.getByTestId('boundary-confirm-bc-rep')).toBeInTheDocument()
  })

  it('shows no recurrence badge for a single-occurrence crossing (LUM-477)', () => {
    setCrossings([{ ...OPEN, id: 'bc-once', occurrenceCount: 1 }])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-477' enabled />)
    expect(
      screen.queryByTestId('crossing-recurrence-bc-once')
    ).not.toBeInTheDocument()
  })

  it('confirming drives the human-only write and refreshes both views', async () => {
    const onChanged = jest.fn()
    render(
      <BoundaryCrossingsPanel
        taskIdentifier='LUM-435'
        enabled
        onChanged={onChanged}
      />
    )
    fireEvent.click(screen.getByTestId('boundary-confirm-bc-open'))
    expect(mockDisposition).toHaveBeenCalledWith(
      'LUM-435',
      'bc-open',
      'CONFIRMED',
      undefined
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(refresh).toHaveBeenCalled()
  })

  it('a confirmed, unremediated crossing stays on record and nudges remediation', () => {
    setCrossings([
      {
        ...OPEN,
        id: 'bc-confirmed',
        disposition: 'CONFIRMED',
        dispositionedAt: '2026-06-11T01:00:00.000Z',
        dispositionedById: 'actor-1',
      },
    ])
    render(
      <BoundaryCrossingsPanel
        taskIdentifier='LUM-435'
        enabled
        members={[{ actorId: 'actor-1', name: 'Chao' } as never]}
      />
    )
    // all crossings are dispositioned — expand the panel to see body content
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-confirmed'))
    // disposition badge + reviewer attribution
    expect(screen.getByText('confirmed')).toBeInTheDocument()
    expect(screen.getByText(/by Chao/)).toBeInTheDocument()
    // a confirmed crossing is NOT an open one — no disposition buttons
    expect(
      screen.queryByTestId('boundary-confirm-bc-confirmed')
    ).not.toBeInTheDocument()
    // nudge to spawn remediation
    expect(
      screen.getByTestId('boundary-spawn-remediation-bc-confirmed')
    ).toBeInTheDocument()
  })

  it('spawning a remediation task calls the write and refreshes', async () => {
    const onChanged = jest.fn()
    setCrossings([{ ...OPEN, id: 'bc-c', disposition: 'CONFIRMED' }])
    render(
      <BoundaryCrossingsPanel
        taskIdentifier='LUM-435'
        enabled
        onChanged={onChanged}
      />
    )
    // all crossings dispositioned — expand to reach the body
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-c'))
    fireEvent.click(screen.getByTestId('boundary-spawn-remediation-bc-c'))
    expect(mockSpawn).toHaveBeenCalledWith('LUM-435', 'bc-c')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('a dispositioned crossing offers re-disposition: change + reopen (LUM-450)', () => {
    setCrossings([
      {
        ...OPEN,
        id: 'bc-fp',
        disposition: 'FALSE_POSITIVE',
        dispositionedAt: '2026-06-11T01:00:00.000Z',
        dispositionedById: 'actor-1',
      },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-450' enabled />)
    // all crossings dispositioned — expand to reach the body
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-fp'))
    // It is NOT open, so the first-disposition buttons are absent…
    expect(
      screen.queryByTestId('boundary-confirm-bc-fp')
    ).not.toBeInTheDocument()
    // …but a human can still correct it: change to the other verdict, or reopen.
    expect(screen.getByTestId('boundary-change-bc-fp')).toBeInTheDocument()
    expect(screen.getByTestId('boundary-reopen-bc-fp')).toBeInTheDocument()
  })

  it('reopening a crossing reverts it to OPEN via the human-only write (LUM-450)', async () => {
    const onChanged = jest.fn()
    setCrossings([
      {
        ...OPEN,
        id: 'bc-c',
        disposition: 'CONFIRMED',
        dispositionedById: 'a1',
      },
    ])
    render(
      <BoundaryCrossingsPanel
        taskIdentifier='LUM-450'
        enabled
        onChanged={onChanged}
      />
    )
    // all crossings dispositioned — expand to reach the body
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-c'))
    fireEvent.click(screen.getByTestId('boundary-reopen-bc-c'))
    expect(mockDisposition).toHaveBeenCalledWith(
      'LUM-450',
      'bc-c',
      'OPEN',
      undefined
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('changing a FALSE_POSITIVE flips it to CONFIRMED (LUM-450)', () => {
    setCrossings([
      {
        ...OPEN,
        id: 'bc-fp',
        disposition: 'FALSE_POSITIVE',
        dispositionedById: 'a1',
      },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-450' enabled />)
    // all crossings dispositioned — expand to reach the body
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-fp'))
    fireEvent.click(screen.getByTestId('boundary-change-bc-fp'))
    expect(mockDisposition).toHaveBeenCalledWith(
      'LUM-450',
      'bc-fp',
      'CONFIRMED',
      undefined
    )
  })

  it('a re-dispositioned crossing reads as corrected — by whom, from what to what (LUM-450)', () => {
    setCrossings([
      {
        ...OPEN,
        id: 'bc-1',
        disposition: 'CONFIRMED',
        dispositionedById: 'actor-2',
        lastDispositionChange: {
          from: 'FALSE_POSITIVE',
          to: 'CONFIRMED',
          actorId: 'actor-2',
          at: '2026-06-11T02:00:00.000Z',
        },
      },
    ])
    render(
      <BoundaryCrossingsPanel
        taskIdentifier='LUM-450'
        enabled
        members={[{ actorId: 'actor-2', name: 'Chao' } as never]}
      />
    )
    // all crossings dispositioned — expand to reach the body
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-1'))
    // The correction is visible — not a silent swap: who changed it, and the
    // full from -> to transition, all in the dedicated corrected line.
    const corrected = screen.getByTestId('boundary-corrected-bc-1')
    expect(corrected).toHaveTextContent('Corrected by Chao')
    expect(corrected).toHaveTextContent('false positive')
    expect(corrected).toHaveTextContent('confirmed')
  })

  it('a remediated crossing surfaces the linked task as a clickable link', () => {
    setCrossings([
      {
        ...OPEN,
        id: 'bc-r',
        disposition: 'CONFIRMED',
        remediationTask: {
          identifier: 'LUM-441',
          title: 'Restore migration',
          status: 'DONE',
          remediated: true,
        },
      },
    ])
    render(
      <BoundaryCrossingsPanel
        taskIdentifier='LUM-435'
        enabled
        workspaceUrl='lumo'
      />
    )
    // all crossings dispositioned — expand to reach the body
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-r'))
    expect(screen.getByText(/Remediated by/)).toBeInTheDocument()
    expect(screen.getByText('LUM-441')).toBeInTheDocument()
    expect(screen.getByText('Restore migration')).toBeInTheDocument()
    expect(screen.getByText('DONE')).toBeInTheDocument()
    // the linked task is reachable — the whole row is an anchor to its detail page
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/workspace/lumo/my-tasks/LUM-441')
  })

  it('auto-expands while a crossing is undisposed', () => {
    setCrossings([
      { ...OPEN, id: 'a', detail: 'git push origin main', disposition: null },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-7' enabled />)
    expect(screen.getByText('git push origin main')).toBeVisible()
  })

  it('folds to the summary when all crossings are dispositioned', () => {
    setCrossings([
      {
        ...OPEN,
        id: 'a',
        detail: 'git push origin main',
        disposition: 'CONFIRMED',
      },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-7' enabled />)
    expect(screen.queryByText('git push origin main')).toBeNull()
    fireEvent.click(screen.getByTestId('boundary-summary-toggle'))
    fireEvent.click(screen.getByTestId('crossing-toggle-a'))
    expect(screen.getByText('git push origin main')).toBeVisible()
  })

  it('expands a truncated command on click', () => {
    const long = 'git checkout -b x && ' + 'a'.repeat(200)
    setCrossings([{ ...OPEN, id: 'a', detail: long, disposition: null }])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-7' enabled />)
    const cmd = screen.getByTestId('crossing-cmd-a')
    expect(cmd.className).toMatch(/truncate|whitespace-nowrap/)
    fireEvent.click(cmd)
    expect(cmd.className).toMatch(/whitespace-pre-wrap|break/)
  })

  it('collapses a dispositioned crossing by default and expands it on click', () => {
    setCrossings([
      {
        ...OPEN,
        id: 'bc-fp',
        detail: 'edited a test file',
        disposition: 'FALSE_POSITIVE',
        dispositionedById: 'a1',
      },
      { ...OPEN, id: 'bc-open2', detail: 'git push origin main --force' },
    ])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-475' enabled />)
    // The mix has one open crossing, so the panel auto-expands. The OPEN
    // crossing's body is visible by default…
    expect(screen.getByText('git push origin main --force')).toBeVisible()
    // …but the already-dispositioned one is collapsed — only its summary header
    // shows; the detail stays hidden until the row is clicked open.
    expect(screen.queryByText('edited a test file')).toBeNull()
    fireEvent.click(screen.getByTestId('crossing-toggle-bc-fp'))
    expect(screen.getByText('edited a test file')).toBeVisible()
  })
})

// The verdict bar's "Review the crossings below" link deep-links to
// /record#boundary-crossings. The panel mounts AFTER that navigation (the tab
// switch renders it), so the browser's native hash jump finds nothing; the
// panel scrolls itself into view on mount when the hash names it.
describe('BoundaryCrossingsPanel hash deep link', () => {
  const scrollIntoView = jest.fn()
  const original = Element.prototype.scrollIntoView
  beforeEach(() => {
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = original
    window.location.hash = ''
  })

  it('scrolls itself into view on mount when the URL hash targets it', () => {
    window.location.hash = '#boundary-crossings'
    setCrossings([OPEN])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-7' enabled />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.getElementById('boundary-crossings')
    )
  })

  it('does not scroll when the hash names something else', () => {
    window.location.hash = '#elsewhere'
    setCrossings([OPEN])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-7' enabled />)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls once the crossings arrive after mount', () => {
    window.location.hash = '#boundary-crossings'
    setCrossings([])
    const { rerender } = render(
      <BoundaryCrossingsPanel taskIdentifier='LUM-7' enabled />
    )
    expect(scrollIntoView).not.toHaveBeenCalled()
    setCrossings([OPEN])
    rerender(<BoundaryCrossingsPanel taskIdentifier='LUM-7' enabled />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})
