/** @jest-environment jsdom */
/**
 * LUM-426 criterion 6 — the panel reads clearly (which action, why flagged,
 * how to acknowledge) and the acknowledge button drives the human-only write.
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

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: { acknowledgeBoundaryCrossing: jest.fn().mockResolvedValue({}) },
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BoundaryCrossingsPanel } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
import { tasksClient } from '@/lib/api-client'

const mockHook = useBoundaryCrossings as jest.Mock
const mockAck = tasksClient.acknowledgeBoundaryCrossing as jest.Mock

const refresh = jest.fn()
const CROSSING = {
  id: 'bc-1',
  category: 'PUSH_TO_PROTECTED_BRANCH',
  detail: 'git push origin main --force',
  detectedAt: '2026-06-11T00:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockHook.mockReturnValue({
    crossings: [CROSSING],
    loading: false,
    error: null,
    refresh,
  })
})

describe('BoundaryCrossingsPanel', () => {
  it('renders nothing when there are no open crossings', () => {
    mockHook.mockReturnValue({
      crossings: [],
      loading: false,
      error: null,
      refresh,
    })
    const { container } = render(
      <BoundaryCrossingsPanel taskIdentifier='LUM-426' enabled />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('reads clearly: which action, why flagged, and how to acknowledge', () => {
    render(<BoundaryCrossingsPanel taskIdentifier='LUM-426' enabled />)
    // which action (category label + the raw command)
    expect(screen.getByText('push to a protected branch')).toBeInTheDocument()
    expect(screen.getByText('git push origin main --force')).toBeInTheDocument()
    // why flagged
    expect(screen.getByText(/Forbidden list/)).toBeInTheDocument()
    // how to acknowledge
    expect(screen.getByTestId('boundary-ack-bc-1')).toBeInTheDocument()
    // human-only note
    expect(screen.getByText(/agent\/CLI path is closed/)).toBeInTheDocument()
  })

  it('acknowledging calls the human-only write and refreshes both views', async () => {
    const onAcknowledged = jest.fn()
    render(
      <BoundaryCrossingsPanel
        taskIdentifier='LUM-426'
        enabled
        onAcknowledged={onAcknowledged}
      />
    )
    fireEvent.click(screen.getByTestId('boundary-ack-bc-1'))
    expect(mockAck).toHaveBeenCalledWith('LUM-426', 'bc-1')
    await waitFor(() => expect(onAcknowledged).toHaveBeenCalled())
    expect(refresh).toHaveBeenCalled()
  })
})
