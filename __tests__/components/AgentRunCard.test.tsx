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

// AgentBadge's brand glyphs are noise for this test — stub it so we render
// only the run header.
jest.mock('@/app/workspace/[workspaceUrl]/components/AgentBadge', () => ({
  AgentBadge: () => null,
}))

// LUM-944: the raw-record delete reads the query client and the API; here we
// only check the card mounts it for a run with a session.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/RunRawRecordDelete',
  () => ({
    RunRawRecordDelete: ({ sessionId }: { sessionId: string }) => (
      <div data-testid='run-raw-record-delete'>{sessionId}</div>
    ),
  })
)

import { fireEvent, render, screen } from '@testing-library/react'
import { AgentRunCard } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard'
import type {
  AgentRunItem,
  AgentRunSession,
} from '@/app/workspace/[workspaceUrl]/types'

const baseRun = (over: Partial<AgentRunSession> = {}): AgentRunSession =>
  ({
    sessionId: 's1',
    agent: 'CLAUDE_CODE',
    runNumber: 1,
    startedAt: '2026-06-07T15:48:00Z',
    lastActivityAt: '2026-06-07T16:00:00Z',
    durationMs: 720_000,
    toolCallCount: 5,
    eventCount: 5,
    memoryCount: 0,
    cost: null,
    member: { workspaceMemberId: 'm1', name: 'Chao Li', imageUrl: '' },
    attribution: null,
    usageResyncedAt: null,
    items: [],
    ...over,
  }) as AgentRunSession

describe('AgentRunCard — run-header attribution (LUM-308)', () => {
  it('shows the owning member name + avatar chip in the header', () => {
    render(<AgentRunCard run={baseRun()} />)
    expect(screen.getByTestId('run-member')).toBeInTheDocument()
    expect(screen.getByText('Chao Li')).toBeInTheDocument()
    // Shared MemberAvatar: labelled with the name, xs shows one initial.
    expect(screen.getByRole('img', { name: 'Chao Li' })).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('omits the member chip for an orphan run with no member', () => {
    render(<AgentRunCard run={baseRun({ member: null })} />)
    expect(screen.queryByTestId('run-member')).not.toBeInTheDocument()
  })
})

describe('AgentRunCard — in-flight cost label (LUM-345)', () => {
  const mc = (model: string, total: number) => ({
    model,
    input: total,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    total,
  })

  it('labels the sentinel "in progress" in the multi-model header join', () => {
    render(
      <AgentRunCard
        run={baseRun({
          cost: {
            byModel: [mc('claude-opus-4-8', 170), mc('__in_flight__', 60)],
            loopCount: 1,
          },
        })}
      />
    )
    expect(screen.getByText(/in progress 60/)).toBeInTheDocument()
    expect(screen.queryByText(/__in_flight__/)).not.toBeInTheDocument()
    // Real models still get the claude- prefix stripped.
    expect(screen.getByText(/opus-4-8 170/)).toBeInTheDocument()
  })

  it('shows a bare total for a lone in-flight row (live first turn)', () => {
    render(
      <AgentRunCard
        run={baseRun({
          cost: { byModel: [mc('__in_flight__', 10600)], loopCount: 0 },
        })}
      />
    )
    expect(screen.getByText('10600 tok')).toBeInTheDocument()
  })
})

describe('AgentRunCard summary region', () => {
  const stopItem = (
    id: string,
    turnSummary: string | null,
    createdAt: string
  ) =>
    ({
      id,
      kind: 'hook',
      type: 'STOP',
      toolName: null,
      payload: null,
      turnSummary,
      turnCost: null,
      createdAt,
    }) as AgentRunItem

  it('renders the LLM summary when present', () => {
    render(<AgentRunCard run={baseRun({ runSummary: 'polished text' })} />)
    expect(screen.getByTestId('run-summary')).toHaveTextContent('polished text')
    expect(screen.queryByTestId('run-digest')).not.toBeInTheDocument()
  })

  it('falls back to raw digest when no runSummary', () => {
    render(
      <AgentRunCard
        run={baseRun({
          runSummary: null,
          items: [
            stopItem('h1', 'first turn did a thing', '2026-06-07T15:50:00Z'),
            stopItem('h2', 'second turn did another', '2026-06-07T15:55:00Z'),
          ],
        })}
      />
    )
    expect(screen.getByTestId('run-digest')).toBeInTheDocument()
    expect(screen.getByText('first turn did a thing')).toBeInTheDocument()
    expect(screen.queryByTestId('run-summary')).not.toBeInTheDocument()
  })

  it('renders no summary region when empty', () => {
    render(<AgentRunCard run={baseRun({ runSummary: null, items: [] })} />)
    expect(screen.queryByTestId('run-summary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('run-digest')).not.toBeInTheDocument()
  })
})

describe('AgentRunCard — collapsible token details (LUM-501)', () => {
  const mc = (model: string, total: number) => ({
    model,
    input: total,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    total,
  })

  it('collapses per-run model details by default when the run is expanded (new style)', () => {
    const run = baseRun({
      cost: {
        byModel: [mc('claude-opus-4-8', 1000), mc('claude-sonnet-4-6', 500)],
        loopCount: null,
      },
      items: [],
    })
    render(<AgentRunCard run={run} defaultExpanded />)
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    // four detail rows are now hidden until per-model toggle
    expect(screen.queryByText('output')).not.toBeInTheDocument()
  })
})

describe('AgentRunCard — attribution (LUM-932)', () => {
  it('shows the badge collapsed and the why-panel after expanding', () => {
    render(
      <AgentRunCard
        run={baseRun({
          attribution: {
            mode: 'INFERRED',
            approximate: true,
            subagents: [],
            segments: [
              {
                source: 'INFERRED',
                confidence: 'HIGH',
                fromTurn: 0,
                toTurn: 2,
                fromAt: '2026-06-07T15:48:00Z',
                toAt: null,
                evidence: [
                  {
                    kind: 'BRANCH',
                    identifier: 'LUM-12',
                    at: '2026-06-07T15:49:00Z',
                  },
                ],
              },
            ],
          },
        })}
      />
    )
    expect(screen.getByTestId('run-attribution-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('run-attribution-panel')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('run-attribution-panel')).toBeInTheDocument()
  })

  it('lets the header wrap so the badge and metadata stay visible', () => {
    render(
      <AgentRunCard
        run={baseRun({
          attribution: {
            mode: 'EXPLICIT',
            approximate: false,
            subagents: [],
            segments: [],
          },
        })}
      />
    )
    const header = screen.getByRole('button')
    expect(header.className).toContain('flex-wrap')
    const badge = screen.getByTestId('run-attribution-badge')
    expect(header.contains(badge)).toBe(true)
    expect(header.className).not.toContain('overflow-hidden')
  })
})

const PRE_DEDUPE_NOTICE =
  'Token figures recorded before Oct 3, 2026 are overstated by about 2× (an older CLI counted each message several times). Newer figures are accurate.'

describe('AgentRunCard — pre-dedupe token marker (LUM-932)', () => {
  const cost = {
    byModel: [
      {
        model: 'claude-opus-4-8',
        input: 100,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 100,
      },
    ],
    loopCount: 1,
  }

  it('marks a run that started before the dedupe cutoff', () => {
    render(
      <AgentRunCard
        run={baseRun({ startedAt: '2026-10-01T10:00:00Z', cost })}
      />
    )
    const marker = screen.getByTestId('run-pre-dedupe')
    expect(marker).toHaveTextContent('≈2× overstated')
    expect(marker).toHaveAttribute('title', PRE_DEDUPE_NOTICE)
    expect(marker).toHaveClass('text-warning-text')
  })

  it('shows the notice in the expanded token breakdown for a pre-cutoff run', () => {
    render(
      <AgentRunCard
        run={baseRun({ startedAt: '2026-10-01T10:00:00Z', cost })}
        defaultExpanded
      />
    )
    expect(screen.getByTestId('run-pre-dedupe-notice')).toHaveClass(
      'text-warning-text'
    )
  })

  it('does not mark a run that started after the cutoff', () => {
    render(
      <AgentRunCard
        run={baseRun({ startedAt: '2026-10-04T10:00:00Z', cost })}
        defaultExpanded
      />
    )
    expect(screen.queryByTestId('run-pre-dedupe')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('run-pre-dedupe-notice')
    ).not.toBeInTheDocument()
  })

  it('does not mark a pre-cutoff run that shows no token cost', () => {
    render(
      <AgentRunCard run={baseRun({ startedAt: '2026-10-01T10:00:00Z' })} />
    )
    expect(screen.queryByTestId('run-pre-dedupe')).not.toBeInTheDocument()
  })
})

describe('usage resync command and resynced runs', () => {
  const cost = {
    byModel: [
      {
        model: 'claude-opus-4-8',
        input: 100,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 100,
      },
    ],
    loopCount: 1,
  }

  it('hides the marker and notice for a pre-cutoff run that was resynced', () => {
    render(
      <AgentRunCard
        run={baseRun({
          startedAt: '2026-10-01T10:00:00Z',
          usageResyncedAt: '2026-10-05T10:00:00Z',
          cost,
        })}
        defaultExpanded
      />
    )
    expect(screen.queryByTestId('run-pre-dedupe')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('run-pre-dedupe-notice')
    ).not.toBeInTheDocument()
  })

  it('still marks a pre-cutoff run that was not resynced', () => {
    render(
      <AgentRunCard
        run={baseRun({
          startedAt: '2026-10-01T10:00:00Z',
          usageResyncedAt: null,
          cost,
        })}
        defaultExpanded
      />
    )
    expect(screen.getByTestId('run-pre-dedupe')).toBeInTheDocument()
    expect(screen.getByTestId('run-pre-dedupe-notice')).toBeInTheDocument()
  })
})

describe('AgentRunCard — session raw record delete (LUM-944)', () => {
  it('mounts the raw record delete in the expanded run card of a session', () => {
    render(<AgentRunCard run={baseRun()} />)
    expect(screen.queryByTestId('run-raw-record-delete')).toBeNull()
    fireEvent.click(screen.getAllByRole('button')[0]!)
    expect(screen.getByTestId('run-raw-record-delete')).toHaveTextContent('s1')
  })

  it('omits it for the unlinked run that has no session', () => {
    render(<AgentRunCard run={baseRun({ sessionId: null })} defaultExpanded />)
    expect(screen.queryByTestId('run-raw-record-delete')).toBeNull()
  })
})

// LUM-966: decoration carries no hue — the run pill, memory count and summary
// label are set apart by weight and neutral foreground, so colour stays
// reserved for meaning.
describe('AgentRunCard — neutral decoration (LUM-966)', () => {
  const hueClass = /(^|\s)(dark:)?(bg|text)-(blue|violet)-/

  it('sets the run number pill in muted background and foreground weight', () => {
    render(<AgentRunCard run={baseRun({ runNumber: 3 })} />)
    const pill = screen.getByTestId('run-number')
    expect(pill).toHaveTextContent('Run #3')
    expect(pill).toHaveClass('bg-muted', 'text-foreground', 'font-semibold')
    expect(pill.className).not.toMatch(hueClass)
  })

  it('emphasises the memory count by weight, not colour', () => {
    render(<AgentRunCard run={baseRun({ memoryCount: 2 })} />)
    const count = screen.getByTestId('run-memory-count')
    expect(count).toHaveTextContent('+2 memories')
    expect(count).toHaveClass('font-semibold', 'text-foreground')
    expect(count.className).not.toMatch(hueClass)
  })

  it('sets the summary label in foreground weight above the muted body', () => {
    render(<AgentRunCard run={baseRun({ runSummary: 'polished text' })} />)
    const label = screen.getByTestId('run-summary-label')
    expect(label).toHaveClass('font-semibold', 'text-foreground')
    expect(label.className).not.toMatch(hueClass)
    expect(label.querySelector('svg')).not.toBeNull()
  })
})
