/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { SprintTeamPerformanceResponse } from '@/lib/api-client/sprints'

// Minimal ICU-ish interpolation: resolve `{n, plural, one {…} other {…}}` off
// the value, then fill plain {name} placeholders. Every message in this
// component carries a defaultMessage, so the mock resolves off that.
function interpolate(msg: string, values?: Record<string, unknown>): string {
  if (!values) return msg
  const withPlurals = msg.replace(
    /\{(\w+), plural,([^]*?)\}\s*$/,
    (whole, key: string, body: string) => {
      const n = Number(values[key])
      if (!Number.isFinite(n)) return whole
      const forms = new Map<string, string>()
      for (const m of body.matchAll(/(\w+)\s*\{([^{}]*)\}/g)) {
        forms.set(m[1]!, m[2]!)
      }
      const form =
        (n === 1 ? forms.get('one') : undefined) ?? forms.get('other') ?? ''
      return form.replace(/#/g, String(n))
    }
  )
  return withPlurals.replace(/\{(\w+)\}/g, (m, k) =>
    k in values ? String(values[k]) : m
  )
}

// `formatDurationSec` reaches for the shared `duration.*` keys, which carry no
// defaultMessage — so the mock needs their en copy to render an agent time.
const DURATION_MESSAGES: Record<string, string> = {
  'duration.hours': '{hours}h',
  'duration.minutes': '{minutes}m',
  'duration.seconds': '{seconds}s',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) =>
      interpolate(d.defaultMessage ?? DURATION_MESSAGES[d.id] ?? d.id, values),
    formatDate: (dt: string | Date) =>
      new Date(dt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
    // The nested per-task breakdown formats its own counts (compact notation).
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en-US', opts).format(n),
  }),
}))

const mockUsePerf = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintTeamPerformance: (...a: unknown[]) => mockUsePerf(...a),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/fields/shared', () => ({
  MemberAvatar: () => <span data-testid='avatar' />,
}))

import { SprintTeamPerformance } from '@/app/workspace/[workspaceUrl]/sprints/components/SprintTeamPerformance'

const members = [
  {
    id: 'mA',
    clerkId: 'c1',
    role: 'Engineer',
    name: 'Alice',
    email: null,
    imageUrl: null,
    joinedAt: '2026-01-01',
    actorId: 'act1',
  },
]

const perf: SprintTeamPerformanceResponse = {
  measuredTasks: 2,
  totalTokenCost: 1_000_000,
  totalActiveTimeSec: 3600,
  totalRuns: 5,
  rows: [
    {
      memberId: 'mA',
      label: 'Alice',
      tasksDone: 3,
      tokenCost: 800_000,
      activeTimeSec: 3000,
      runs: 4,
      models: [
        {
          model: 'claude-opus-4-8',
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          total: 800_000,
        },
      ],
      modelUnattributedTokens: 0,
      perTask: [
        {
          taskId: 't1',
          identifier: 'LUM-1',
          title: 'Build the thing',
          status: 'DONE',
          priority: 'HIGH',
          tokenCost: 800_000,
          activeTimeSec: 3000,
          topModel: 'claude-opus-4-8',
          models: [
            {
              model: 'claude-opus-4-8',
              input: 20_000,
              output: 80_000,
              cacheRead: 600_000,
              cacheCreation: 100_000,
              total: 800_000,
            },
          ],
          updatedAt: '2026-07-15T00:00:00.000Z',
        },
      ],
    },
    {
      memberId: null,
      label: null,
      tasksDone: 1,
      tokenCost: 200_000,
      activeTimeSec: 600,
      runs: 1,
      models: [],
      modelUnattributedTokens: 0,
      perTask: [],
    },
  ],
}

const renderPanel = () =>
  render(<SprintTeamPerformance sprintId='s1' members={members} />)

beforeEach(() => jest.clearAllMocks())

describe('SprintTeamPerformance', () => {
  it('renders a skeleton while loading, no section', () => {
    mockUsePerf.mockReturnValue({ performance: null, isLoading: true })
    const { container } = renderPanel()
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(screen.queryByText('Progress')).not.toBeInTheDocument()
  })

  it('renders nothing when there are no rows', () => {
    mockUsePerf.mockReturnValue({
      performance: { ...perf, rows: [] },
      isLoading: false,
    })
    const { container } = renderPanel()
    expect(container).toBeEmptyDOMElement()
  })

  // LUM-718 moved this section into the ~320px right rail, where the old
  // five-column grid (member / tasks done / tokens / agent time / token share)
  // could only overflow. Each member now reads top-down as one card. The
  // section heading still reads "Progress" (LUM-717) — the component keeps its
  // team-performance name, that being the rollup it renders.
  it('renders each member as a compact rail card instead of a five-column table row', () => {
    mockUsePerf.mockReturnValue({ performance: perf, isLoading: false })
    renderPanel()

    // The column header row is gone — no header cell survives as a label.
    expect(screen.queryByText('Member')).not.toBeInTheDocument()
    expect(screen.queryByText('Tasks done')).not.toBeInTheDocument()
    expect(screen.queryByText('Tokens')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent time')).not.toBeInTheDocument()
    expect(screen.queryByText('Token share')).not.toBeInTheDocument()

    // Each member is a card: name + share on the first line, the share bar
    // under it, then the three numbers as one meta line naming their own units.
    expect(screen.getByText('Progress')).toBeInTheDocument()
    const card = screen.getByText('Alice').closest('button')!
    // Token share = 800k / 1M = 80%.
    expect(within(card).getByText('80%')).toBeInTheDocument()
    expect(within(card).getByText('3 tasks done')).toBeInTheDocument()
    expect(within(card).getByText('800K tokens')).toBeInTheDocument()
    expect(within(card).getByText('50m agent time')).toBeInTheDocument()
    // The bar is decoration next to the percentage it repeats.
    expect(card.querySelector('[aria-hidden="true"]')).toBeInTheDocument()

    expect(screen.getByText('Unattributed')).toBeInTheDocument()

    // Prose that LUM-717 took out stays out.
    expect(screen.queryByText(/attributed per member/)).not.toBeInTheDocument()
    expect(screen.queryByText(/sprint total/)).not.toBeInTheDocument()
    expect(screen.queryByText('1 model')).not.toBeInTheDocument()
    expect(screen.queryByText('4 runs')).not.toBeInTheDocument()
  })

  // A sprint hangs off a Team, while `member.role` is the workspace-level
  // WorkspaceRole — a scope this table doesn't speak for. The member cell is
  // name-only; the avatar is the only thing `members` still feeds.
  it('shows the member name without their workspace role', () => {
    mockUsePerf.mockReturnValue({ performance: perf, isLoading: false })
    renderPanel()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Engineer')).not.toBeInTheDocument()
  })

  it('expands a member row to reveal the per-task drill-down', () => {
    mockUsePerf.mockReturnValue({ performance: perf, isLoading: false })
    renderPanel()
    expect(screen.queryByText('LUM-1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Alice'))
    expect(screen.getByText('LUM-1')).toBeInTheDocument()
    expect(screen.getByText('Build the thing')).toBeInTheDocument()
    // The task line stays a one-liner: the model split lives behind its own
    // disclosure, not spread across the drill-down.
    expect(screen.queryByText('claude-opus-4-8')).not.toBeInTheDocument()
  })

  it('expands a task row to reveal its per-model token breakdown', () => {
    mockUsePerf.mockReturnValue({ performance: perf, isLoading: false })
    renderPanel()
    fireEvent.click(screen.getByText('Alice'))

    const taskRow = screen.getByText('Build the thing').closest('button')!
    expect(taskRow).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(taskRow)
    expect(taskRow).toHaveAttribute('aria-expanded', 'true')

    // Model heading + the four token-kind rows with their own values.
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    const panel = taskRow.parentElement!
    expect(within(panel).getByText('output')).toBeInTheDocument()
    expect(within(panel).getByText('80K')).toBeInTheDocument()
    expect(within(panel).getByText('input')).toBeInTheDocument()
    expect(within(panel).getByText('20K')).toBeInTheDocument()
    expect(within(panel).getByText('cache-create')).toBeInTheDocument()
    expect(within(panel).getByText('100K')).toBeInTheDocument()
    expect(within(panel).getByText('cache-read')).toBeInTheDocument()
    expect(within(panel).getByText('600K')).toBeInTheDocument()

    // Collapsing hides it again.
    fireEvent.click(taskRow)
    expect(taskRow).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('claude-opus-4-8')).not.toBeInTheDocument()
    expect(screen.queryByText('cache-read')).not.toBeInTheDocument()
  })

  it('states the spend no model split accounts for', () => {
    const row = perf.rows[0]!
    const task = row.perTask[0]!
    mockUsePerf.mockReturnValue({
      performance: {
        ...perf,
        // Flat columns only (pre-per-model capture): nothing to attribute.
        rows: [{ ...row, perTask: [{ ...task, models: [] }] }],
      },
      isLoading: false,
    })
    renderPanel()
    fireEvent.click(screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Build the thing').closest('button')!)
    expect(
      screen.getByText('800K not attributed to a model')
    ).toBeInTheDocument()
  })
})
