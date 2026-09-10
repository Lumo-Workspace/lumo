/** @jest-environment jsdom */
/**
 * LUM-567 — the decision-first task dossier merges the former Delivery / Memory
 * / Lineage tabs into one surface. These tests pin the four contract behaviours:
 *  1. taskTabs offers a single dossier tab (no delivery/memory/lineage tabs);
 *  2. the legacy slugs deep-link into a dossier ④ section (LUM-458 preserved);
 *  3. the dossier renders four ordered regions, ④ collapsed by default;
 *  4. field ownership — the cost total is rendered once (③), never re-printed in
 *     the ④ Agent-runs (no token footer) or Lineage (no cost block) sub-sections.
 */
import {
  TAB_SLUGS,
  tabFromSlug,
  resolveTab,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/taskTabs'

// ── 1 & 2: pure routing (no DOM) ─────────────────────────────────────────────

describe('taskTabs exposes a single dossier tab and drops delivery memory lineage', () => {
  it('replaces the merged trio with one dossier tab', () => {
    expect(tabFromSlug('delivery')).toBeNull()
    expect(tabFromSlug('memory')).toBeNull()
    expect(tabFromSlug('lineage')).toBeNull()
    expect(tabFromSlug('acceptance')).toBeNull()
    // The dossier tab's URL segment is `record` (its English label); the
    // internal TabValue key stays `dossier`. There is no `dossier` slug.
    expect(TAB_SLUGS.dossier).toBe('record')
    expect(tabFromSlug('record')).toBe('dossier')
    expect(tabFromSlug('dossier')).toBeNull()
    expect(Object.keys(TAB_SLUGS).sort()).toEqual([
      'activity',
      'comments',
      'context',
      'dossier',
    ])
  })
})

describe('legacy slugs resolve to the dossier tab with a target section', () => {
  it('maps delivery/lineage/memory onto the dossier with the matching section', () => {
    expect(resolveTab('delivery')).toEqual({ tab: 'dossier', section: 'runs' })
    expect(resolveTab('lineage')).toEqual({
      tab: 'dossier',
      section: 'lineage',
    })
    expect(resolveTab('memory')).toEqual({ tab: 'dossier', section: 'memory' })
    // The dossier's own slug carries no target section.
    expect(resolveTab('record')).toEqual({ tab: 'dossier', section: null })
    // Unknown slugs (including the never-shipped `dossier`) → null.
    expect(resolveTab('dossier')).toBeNull()
    // Unknown slug → null so the caller normalizes the URL.
    expect(resolveTab('nope')).toBeNull()
  })
})

// ── 3 & 4: dossier composition ───────────────────────────────────────────────

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

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useAgentRuns', () => ({
  useAgentRuns: jest.fn(),
}))

// LUM-496: the dossier reads the security scan's blocking count (same
// react-query key the scan section uses) to tell the record tab which zone the
// scan belongs in. Mocked here like every other data hook — this suite is about
// composition, not fetching.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSecurityScans', () => ({
  useSecurityScans: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
  })),
}))

// ①②③ surface — mocked to a single marker carrying ONE cost-home node, so the
// "cost total rendered once" assertion has a unique anchor that the evidence
// sub-section mocks (below) do not reproduce. LUM-572: the evidence sub-sections
// now fold in via the `evidenceSlot` prop (the dossier passes them down rather
// than rendering a separate ④ region), so the mock renders that slot.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab',
  () => ({
    AcceptanceTab: (props: { evidenceSlot?: import('react').ReactNode }) => (
      <div data-testid='acceptance-surface'>
        <span data-testid='cost-home'>cost</span>
        {props.evidenceSlot}
      </div>
    ),
  })
)

// ④ Agent-runs children — DeliveryPanel records whether it got a token footer.
jest.mock('@/app/workspace/[workspaceUrl]/components/DeliveryPanel', () => ({
  DeliveryPanel: (props: { footer?: unknown }) => (
    <div
      data-testid='delivery-panel'
      data-has-footer={props.footer != null ? 'yes' : 'no'}
    />
  ),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunList',
  () => ({ AgentRunList: () => <div data-testid='agent-run-list' /> })
)

// ④ Lineage — records the showCost prop the dossier passes it.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab',
  () => ({
    LineageTab: (props: { showCost?: boolean }) => (
      <div data-testid='lineage-body' data-show-cost={String(props.showCost)} />
    ),
  })
)

// ④ Memory.
jest.mock('@/app/workspace/[workspaceUrl]/components/memory/MemoryTab', () => ({
  MemoryTab: () => <div data-testid='memory-body' />,
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskDossier } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TaskDossier'
import { useAgentRuns } from '@/app/workspace/[workspaceUrl]/hooks/useAgentRuns'

const mockAgentRuns = useAgentRuns as jest.Mock

const baseProps: any = {
  taskId: 'task-1',
  taskIdentifier: 'LUM-1',
  taskStatus: 'IN_REVIEW',
  agentStatus: null,
  workspaceUrl: 'acme',
  members: [],
  agentActors: [],
  enabled: true,
  onVerdictRecorded: jest.fn(),
  memberNames: new Map(),
  hasLineage: true,
  hasMemories: true,
  targetSection: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAgentRuns.mockReturnValue({
    data: { runs: [{ runSummary: 'did things', items: [] }] },
    loading: false,
    error: null,
  })
})

describe('TaskDossier renders four ordered regions with evidence and causality collapsed', () => {
  it('shows the decision surface above a collapsed evidence region', () => {
    render(<TaskDossier {...baseProps} />)

    // ①②③ decision surface present.
    const acceptance = screen.getByTestId('acceptance-surface')
    expect(acceptance).toBeInTheDocument()

    // ④ region header present, with the three named sub-section toggles.
    const evidenceHeading = screen.getByText('Evidence & causality')
    const runsBtn = screen.getByRole('button', { name: /Agent runs/ })
    const lineageBtn = screen.getByRole('button', { name: /Lineage causality/ })
    const memoryBtn = screen.getByRole('button', {
      name: /Injected team memory/,
    })

    // Decision leads: ①②③ surface comes before the ④ region in DOM order.
    expect(
      acceptance.compareDocumentPosition(evidenceHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    // ④ collapsed by default: every sub-section toggle is closed and no body shows.
    for (const btn of [runsBtn, lineageBtn, memoryBtn]) {
      expect(btn).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.queryByTestId('delivery-panel')).toBeNull()
    expect(screen.queryByTestId('lineage-body')).toBeNull()
    expect(screen.queryByTestId('memory-body')).toBeNull()
  })
})

describe('dossier renders the cost total once and not in the evidence and causality region', () => {
  it('keeps cost in the ③ home and strips it from the ④ sub-sections', () => {
    render(<TaskDossier {...baseProps} />)

    // Expand all three ④ sub-sections so their bodies mount and can be inspected.
    fireEvent.click(screen.getByRole('button', { name: /Agent runs/ }))
    fireEvent.click(screen.getByRole('button', { name: /Lineage causality/ }))
    fireEvent.click(
      screen.getByRole('button', { name: /Injected team memory/ })
    )

    // Cost total appears exactly once — in the ③ home (acceptance surface).
    expect(screen.getAllByTestId('cost-home')).toHaveLength(1)

    // ④ Agent runs: the DeliveryPanel carries no token-total footer.
    expect(screen.getByTestId('delivery-panel')).toHaveAttribute(
      'data-has-footer',
      'no'
    )

    // ④ Lineage: rendered with the cost block suppressed.
    expect(screen.getByTestId('lineage-body')).toHaveAttribute(
      'data-show-cost',
      'false'
    )
  })
})
