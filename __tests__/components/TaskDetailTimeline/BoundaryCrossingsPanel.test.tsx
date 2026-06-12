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

  it('surfaces a HIGH-severity crossing prominently (LUM-442)', () => {
    setCrossings([{ ...OPEN, id: 'bc-high', severity: 'HIGH' }])
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-442' enabled />)
    expect(screen.getByText('high severity')).toBeInTheDocument()
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
})
