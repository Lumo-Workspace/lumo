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
    fireEvent.click(screen.getByTestId('boundary-spawn-remediation-bc-c'))
    expect(mockSpawn).toHaveBeenCalledWith('LUM-435', 'bc-c')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
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
    expect(screen.getByText(/Remediated by/)).toBeInTheDocument()
    expect(screen.getByText('LUM-441')).toBeInTheDocument()
    expect(screen.getByText('Restore migration')).toBeInTheDocument()
    expect(screen.getByText('DONE')).toBeInTheDocument()
    // the linked task is reachable — the whole row is an anchor to its detail page
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/workspace/lumo/my-tasks/LUM-441')
  })
})
