// Mock react-intl: return the (interpolated) defaultMessage so assertions can
// match real visible text, and provide a deterministic formatNumber.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number) => `${n}`,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskLineage', () => ({
  useTaskLineage: jest.fn(),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { LineageTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab'
import { useTaskLineage } from '@/app/workspace/[workspaceUrl]/hooks/useTaskLineage'
import type {
  LineageResponse,
  LineageFragment,
} from '@/app/workspace/[workspaceUrl]/types'

const mockHook = useTaskLineage as jest.Mock

function makeFragments(n: number): LineageFragment[] {
  return Array.from({ length: n }, (_, i) => ({
    fragmentType: 'MEMORY',
    fragmentId: `frag-${i}`,
    sourceLabel: `Source label ${i}`,
    outcome: 'MERGED' as const,
  }))
}

function makeData(overrides: Partial<LineageResponse> = {}): LineageResponse {
  const fragments = makeFragments(3)
  return {
    task: { identifier: 'LUM-1', title: 'T', status: 'DONE' },
    totals: {
      runCount: 1,
      fragmentCount: fragments.length,
      edgeCount: fragments.length,
      tokens: {
        input: 46000,
        output: 297000,
        cacheRead: 20300000,
        cacheCreation: 1900000,
        total: 22543000,
      },
      // A distinctive non-zero loops value: it must NEVER surface as a number.
      loopCount: 7,
      outcomes: {
        MERGED: fragments.length,
        REJECTED: 0,
        REWORKED: 0,
        UNKNOWN: 0,
      },
    },
    groups: [
      {
        kind: 'session',
        sessionId: 'sess-1',
        label: 'Session sess-1',
        includedAt: '2026-01-01T00:00:00.000Z',
        cost: {
          input: 46000,
          output: 297000,
          cacheRead: 20300000,
          cacheCreation: 1900000,
          total: 22543000,
          loopCount: 7,
        },
        fragments,
      },
    ],
    ...overrides,
  }
}

const baseProps = { taskIdentifier: 'LUM-1', enabled: true }

beforeEach(() => jest.clearAllMocks())

describe('LineageTab', () => {
  it('shows the loading state', () => {
    mockHook.mockReturnValue({ data: null, loading: true, error: null })
    render(<LineageTab {...baseProps} />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('shows the error state', () => {
    mockHook.mockReturnValue({ data: null, loading: false, error: 'boom' })
    render(<LineageTab {...baseProps} />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('shows the empty state when there are no groups', () => {
    mockHook.mockReturnValue({
      data: makeData({ groups: [] }),
      loading: false,
      error: null,
    })
    render(<LineageTab {...baseProps} />)
    expect(screen.getByText('此任务暂无 lineage 记录')).toBeInTheDocument()
  })

  it('renders cost block without a "loops n/a" chip (LUM-313)', () => {
    mockHook.mockReturnValue({ data: makeData(), loading: false, error: null })
    render(<LineageTab {...baseProps} />)
    // The "loops n/a" pill was removed — absence is now silent.
    expect(screen.queryByText('loops n/a')).not.toBeInTheDocument()
    // The cost block itself still renders: caliber chip + token-type rows.
    expect(screen.getByText('会话级')).toBeInTheDocument()
    expect(screen.getByText('cache-read')).toBeInTheDocument()
  })

  it('never renders a numeric loops value (null coalesced to 0 would lie)', () => {
    mockHook.mockReturnValue({ data: makeData(), loading: false, error: null })
    render(<LineageTab {...baseProps} />)
    // The distinctive loopCount (7) must not appear anywhere as text.
    expect(screen.queryByText(/\bloops?\b.*\d|\d.*\bloops?\b/i)).toBeNull()
    expect(screen.queryByText('7')).toBeNull()
  })

  it('renders fragment rows with outcome badges', () => {
    mockHook.mockReturnValue({ data: makeData(), loading: false, error: null })
    render(<LineageTab {...baseProps} />)
    expect(screen.getByText(/Source label 0/)).toBeInTheDocument()
    expect(screen.getAllByText('MERGED').length).toBeGreaterThan(0)
  })

  it('collapses to 10 fragments and expands on toggle', () => {
    const fragments = makeFragments(12)
    mockHook.mockReturnValue({
      data: makeData({
        groups: [
          {
            kind: 'session',
            sessionId: 'sess-1',
            label: 'Session sess-1',
            includedAt: '2026-01-01T00:00:00.000Z',
            cost: null,
            fragments,
          },
        ],
        totals: {
          runCount: 1,
          fragmentCount: 12,
          edgeCount: 12,
          tokens: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheCreation: 0,
            total: 0,
          },
          loopCount: 0,
          outcomes: { MERGED: 12, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
        },
      }),
      loading: false,
      error: null,
    })
    render(<LineageTab {...baseProps} />)

    // First 10 visible, 11th hidden.
    expect(screen.getByText(/Source label 9/)).toBeInTheDocument()
    expect(screen.queryByText(/Source label 10/)).toBeNull()

    fireEvent.click(screen.getByText(/展开全部 12 条/))
    expect(screen.getByText(/Source label 10/)).toBeInTheDocument()
    expect(screen.getByText(/Source label 11/)).toBeInTheDocument()

    // Cost block falls back to the "no cost" note when total is 0.
    expect(screen.getByText('此条线索暂无采集到的成本')).toBeInTheDocument()
  })
})
