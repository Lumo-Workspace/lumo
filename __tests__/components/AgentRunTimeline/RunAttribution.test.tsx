/** @jest-environment jsdom */

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        s = s.replace(
          /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
          (_: string, key: string, one: string, other: string) => {
            const n = Number(values[key] ?? 0)
            return (n === 1 ? one : other).replace('#', String(n))
          }
        )
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number) => String(n),
  }),
}))

import { render, screen, within } from '@testing-library/react'
import {
  RunAttributionBadge,
  RunAttributionPanel,
} from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/RunAttribution'
import type {
  RunAttribution,
  RunSegmentView,
  RunSubagentView,
} from '@/app/workspace/[workspaceUrl]/types'

const seg = (over: Partial<RunSegmentView> = {}): RunSegmentView => ({
  source: 'INFERRED',
  confidence: 'HIGH',
  fromTurn: 0,
  toTurn: 2,
  fromAt: '2026-06-07T15:48:00Z',
  toAt: null,
  evidence: [],
  ...over,
})

const sub = (over: Partial<RunSubagentView> = {}): RunSubagentView => ({
  sessionId: 'sub1',
  agentType: 'general-purpose',
  source: 'SUBAGENT_ATTACH',
  confidence: 'EXPLICIT',
  evidence: [],
  followsParent: false,
  ...over,
})

const attr = (over: Partial<RunAttribution> = {}): RunAttribution => ({
  mode: 'INFERRED',
  segments: [],
  subagents: [],
  approximate: true,
  ...over,
})

const renderBoth = (a: RunAttribution) =>
  render(
    <>
      <RunAttributionBadge attribution={a} />
      <RunAttributionPanel attribution={a} />
    </>
  )

describe('flags auto-detected work as approximate', () => {
  it('marks an inferred run approximate and explains why', () => {
    renderBoth(
      attr({
        segments: [
          seg({
            evidence: [
              {
                kind: 'BRANCH',
                identifier: 'LUM-12',
                at: '2026-06-07T15:49:00Z',
              },
            ],
          }),
        ],
      })
    )
    expect(screen.getByTestId('run-attribution-badge')).toHaveTextContent(
      'Auto-detected · High confidence'
    )
    expect(screen.getByTestId('run-approximate')).toHaveClass(
      'text-warning-text'
    )
    const panel = screen.getByTestId('run-attribution-panel')
    expect(within(panel).getByText(/Branch name/)).toBeInTheDocument()
    expect(within(panel).getByText(/LUM-12/)).toBeInTheDocument()
    expect(screen.getByTestId('run-approximate-notice')).toHaveTextContent(
      'Measurement may be inaccurate'
    )
    expect(screen.getByTestId('run-approximate-notice')).toHaveClass(
      'text-warning-text'
    )
  })

  it('shows no approximate marker or notice for a bound run', () => {
    renderBoth(attr({ mode: 'EXPLICIT', approximate: false }))
    expect(screen.getByTestId('run-attribution-badge')).toHaveTextContent(
      'Bound'
    )
    expect(screen.queryByTestId('run-approximate')).toBeNull()
    expect(screen.queryByTestId('run-approximate-notice')).toBeNull()
    expect(
      screen.getByText(/Session attached with lumo session attach/)
    ).toBeInTheDocument()
    expect(screen.queryByText('No recorded signal')).toBeNull()
  })
})

describe('RunAttribution', () => {
  it('lists a subagent attach row for a host run without approximation', () => {
    renderBoth(attr({ mode: 'HOST', approximate: false, subagents: [sub()] }))
    const rows = screen.getAllByTestId('attribution-subagent')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('general-purpose')
    expect(rows[0]).toHaveTextContent(
      'Subagent attached with lumo session attach'
    )
    expect(screen.queryByTestId('run-approximate')).toBeNull()
  })

  it('says no signal for a medium inferred segment without evidence', () => {
    renderBoth(attr({ segments: [seg({ confidence: 'MEDIUM' })] }))
    expect(screen.getByText('No recorded signal')).toBeInTheDocument()
  })

  it('names the parent signal for an inferred subagent that follows its parent', () => {
    renderBoth(
      attr({
        mode: 'HOST',
        subagents: [
          sub({
            source: 'INFERRED',
            confidence: 'HIGH',
            followsParent: true,
            evidence: [
              {
                kind: 'BRANCH',
                identifier: 'LUM-12',
                at: '2026-06-07T15:48:00Z',
              },
            ],
          }),
        ],
      })
    )
    const row = screen.getByTestId('attribution-subagent')
    expect(row).toHaveTextContent("Follows the parent session's attribution")
    expect(row).toHaveTextContent('Branch name · LUM-12')
    expect(within(row).queryByText('No recorded signal')).toBeNull()
  })

  it('uses the weakest confidence across segments and subagents', () => {
    renderBoth(
      attr({
        segments: [seg({ confidence: 'HIGH' })],
        subagents: [sub({ source: 'INFERRED', confidence: 'MEDIUM' })],
      })
    )
    expect(screen.getByTestId('run-attribution-badge')).toHaveTextContent(
      'Auto-detected · Medium confidence'
    )
  })
})

describe('RunAttribution grouping and dedupe', () => {
  it('groups identical subagents into one counted row', () => {
    renderBoth(
      attr({
        mode: 'HOST',
        approximate: false,
        subagents: [
          sub({ sessionId: 'a', source: 'INHERITED' }),
          sub({ sessionId: 'b', source: 'INHERITED' }),
          sub({ sessionId: 'c', source: 'INHERITED' }),
          sub({ sessionId: 'd', agentType: 'Explore' }),
        ],
      })
    )
    const rows = screen.getAllByTestId('attribution-subagent')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('general-purpose ×3')
    expect(rows[0]).toHaveAttribute('data-count', '3')
    expect(rows[1]).not.toHaveTextContent('×')
  })

  it('shows grouped subagents evidence with the per-member maximum, not the sum', () => {
    const e = {
      kind: 'BRANCH' as const,
      identifier: 'LUM-12',
      at: '2026-06-07T15:48:00Z',
    }
    renderBoth(
      attr({
        mode: 'HOST',
        approximate: false,
        subagents: Array.from({ length: 5 }, (_, i) =>
          sub({ sessionId: `s${i}`, source: 'INFERRED', evidence: [e] })
        ),
      })
    )
    const row = screen.getByTestId('attribution-subagent')
    expect(row).toHaveTextContent('general-purpose ×5')
    expect(row).toHaveTextContent('Branch name · LUM-12')
    expect(row).not.toHaveTextContent('LUM-12 ×')
  })

  it('does not show a no-signal line next to a HIGH inferred segment', () => {
    renderBoth(attr({ segments: [seg({ confidence: 'HIGH', evidence: [] })] }))
    expect(screen.queryByText('No recorded signal')).not.toBeInTheDocument()
  })

  it('dedupes repeated evidence with a count and the earliest time', () => {
    const ev = (at: string) => ({
      kind: 'LUMO_CMD' as const,
      identifier: 'LUM-855',
      at,
    })
    renderBoth(
      attr({
        segments: [
          seg({
            evidence: [
              ev('2026-06-07T15:50:00Z'),
              ev('2026-06-07T15:48:00Z'),
              ev('2026-06-07T15:49:00Z'),
            ],
          }),
        ],
      })
    )
    const panel = screen.getByTestId('run-attribution-panel')
    expect(within(panel).getAllByText(/Lumo command/)).toHaveLength(1)
    expect(
      within(panel).getByText(/Lumo command · LUM-855 ×3/)
    ).toBeInTheDocument()
  })
})
