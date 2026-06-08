import { formatLineageMarkdown } from '../../cli/src/commands/task-lineage'
import type { LineageResponse } from '../../cli/src/commands/task-lineage'

const base: LineageResponse = {
  task: { identifier: 'LUM-1', title: 'Add lineage', status: 'DONE' },
  totals: {
    runCount: 1,
    fragmentCount: 2,
    edgeCount: 2,
    tokens: { input: 1000, output: 500, cacheRead: 200, cacheCreation: 100, total: 1800 },
    loopCount: 4,
    outcomes: { MERGED: 2, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
  },
  groups: [
    {
      kind: 'session',
      sessionId: 'sess-12345678',
      label: 'Session sess-1234',
      includedAt: '2026-06-01T00:00:00.000Z',
      cost: { input: 1000, output: 500, cacheRead: 200, cacheCreation: 100, total: 1800, loopCount: 4 },
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', sourceLabel: '[PROJECT] use the service layer', outcome: 'MERGED' },
        { fragmentType: 'PR', fragmentId: 'pr-1', sourceLabel: '#42 Add table', outcome: 'MERGED' },
      ],
    },
  ],
}

describe('formatLineageMarkdown', () => {
  it('renders the totals banner, the group cost once, and per-fragment outcomes', () => {
    const out = formatLineageMarkdown(base)
    expect(out).toContain('# Lineage: LUM-1')
    expect(out).toContain('Add lineage')
    expect(out).toContain('1,800') // grouped-thousands cost
    expect(out).toContain('Session sess-1234')
    expect(out).toContain('[MERGED] MEMORY')
    expect(out).toContain('use the service layer')
    expect(out).toContain('[MERGED] PR')
    expect(out).toContain('#42 Add table')
    expect(out).toContain('2 MERGED') // group summary + totals
  })

  it('renders a cold-start note when there are no edges', () => {
    const empty: LineageResponse = {
      ...base,
      totals: { ...base.totals, runCount: 0, fragmentCount: 0, edgeCount: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }, loopCount: 0, outcomes: { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 } },
      groups: [],
    }
    const out = formatLineageMarkdown(empty)
    expect(out).toContain('# Lineage: LUM-1')
    expect(out).toContain('No lineage edges recorded yet')
    expect(out).not.toContain('## Totals')
  })

  it('renders a session group with no captured cost and no outcome summary suffix', () => {
    const sessionOnly: LineageResponse = {
      task: { identifier: 'LUM-2', title: 'Session only', status: 'IN_PROGRESS' },
      totals: {
        runCount: 1,
        fragmentCount: 1,
        edgeCount: 1,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
        loopCount: 0,
        outcomes: { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 1 },
      },
      groups: [
        {
          kind: 'session',
          sessionId: 'sess-abcd',
          label: 'Session sess-abc',
          includedAt: '2026-06-02T12:00:00.000Z',
          cost: null,
          fragments: [
            { fragmentType: 'WEB_LINK', fragmentId: 'web-1', sourceLabel: 'Some article', outcome: 'UNKNOWN' },
          ],
        },
      ],
    }
    const out = formatLineageMarkdown(sessionOnly)
    expect(out).toContain('## Session sess-abc · 2026-06-02')
    expect(out).toContain('**Cost**: (no captured cost)')
    // UNKNOWN:1 > 0 → outcomeSummary returns "1 UNKNOWN" → suffix IS present
    expect(out).toContain('**Fragments** (1: 1 UNKNOWN):')
    expect(out).toContain('[UNKNOWN] WEB_LINK — Some article')
  })
})
