import {
  formatLineageMarkdown,
  formatSignalHealth,
} from '../../cli/src/commands/task-lineage'
import type {
  LineageResponse,
  UsageSignalHealth,
} from '../../cli/src/commands/task-lineage'

const base: LineageResponse = {
  task: { identifier: 'LUM-1', title: 'Add lineage', status: 'DONE' },
  totals: {
    runCount: 1,
    fragmentCount: 2,
    edgeCount: 2,
    tokens: {
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheCreation: 100,
      total: 1800,
    },
    loopCount: 4,
    outcomes: { MERGED: 2, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
    funnel: { impressions: 2, index: 0, pulled: 0, used: 0 },
    topOperations: [],
  },
  groups: [
    {
      kind: 'session',
      sessionId: 'sess-12345678',
      label: 'Session sess-1234',
      includedAt: '2026-06-01T00:00:00.000Z',
      cost: {
        input: 1000,
        output: 500,
        cacheRead: 200,
        cacheCreation: 100,
        total: 1800,
        loopCount: 4,
      },
      fragments: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'mem-1',
          sourceLabel: '[PROJECT] use the service layer',
          outcome: 'MERGED',
          used: true,
          disclosure: 'FULL',
          pulled: false,
        },
        {
          fragmentType: 'PR',
          fragmentId: 'pr-1',
          sourceLabel: '#42 Add table',
          outcome: 'MERGED',
          used: null,
          disclosure: 'FULL',
          pulled: false,
        },
      ],
    },
  ],
}

describe('formatLineageMarkdown', () => {
  it('renders the totals banner, the group cost once, and per-fragment outcomes', () => {
    const out = formatLineageMarkdown(base)
    expect(out).toContain('# Lineage: LUM-1')
    expect(out).toContain('Add lineage')
    // LUM-1232 N-2: summary lines are compact (exact counts are in --json).
    expect(out).toContain('Tokens: 1.8K (input 1K · output 500')
    expect(out).toContain('Session sess-1234')
    expect(out).toContain('[MERGED] MEMORY')
    expect(out).toContain('use the service layer')
    expect(out).toContain('[MERGED] PR')
    expect(out).toContain('#42 Add table')
    expect(out).toContain('2 MERGED') // group summary + totals
  })

  // LUM-559: an empty report means NO session was ever bound to the task, so
  // its cost could not be measured. The copy must say "not measured", never
  // imply "zero cost" — fail-closed honesty (distinguish 花了0 from 没测到).
  it('renders a not measured empty state when no session was ever bound', () => {
    const empty: LineageResponse = {
      ...base,
      totals: {
        ...base.totals,
        runCount: 0,
        fragmentCount: 0,
        edgeCount: 0,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          total: 0,
        },
        loopCount: 0,
        outcomes: { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
        funnel: { impressions: 0, index: 0, pulled: 0, used: 0 },
      },
      groups: [],
    }
    const out = formatLineageMarkdown(empty)
    expect(out).toContain('# Lineage: LUM-1')
    expect(out).toContain('not measured')
    expect(out).toContain('no session was ever bound')
    // It must NOT claim zero cost, and must not print the totals banner.
    expect(out).not.toContain('No lineage edges recorded yet')
    expect(out).not.toContain('## Totals')
  })

  // LUM-559: a session with cost but no edges surfaces as an edgeless group.
  // Its cost is shown; the empty fragment list carries an explicit note so the
  // reader knows the trail is "not captured", not "the session used nothing".
  it('renders an edgeless cost group with a fragments not captured note', () => {
    const costOnly: LineageResponse = {
      task: { identifier: 'LUM-3', title: 'Late bind', status: 'DONE' },
      totals: {
        runCount: 1,
        fragmentCount: 0,
        edgeCount: 0,
        tokens: {
          input: 20,
          output: 4,
          cacheRead: 1,
          cacheCreation: 0,
          total: 25,
        },
        loopCount: 1,
        outcomes: { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
        funnel: { impressions: 0, index: 0, pulled: 0, used: 0 },
        topOperations: [],
      },
      groups: [
        {
          kind: 'session',
          sessionId: 'sess-abcdef12',
          label: 'Session sess-abc',
          includedAt: '2026-06-02T12:00:00.000Z',
          cost: {
            input: 20,
            output: 4,
            cacheRead: 1,
            cacheCreation: 0,
            total: 25,
            loopCount: 1,
          },
          fragments: [],
        },
      ],
    }
    const out = formatLineageMarkdown(costOnly)
    expect(out).toContain('## Totals')
    expect(out).toContain('Session sess-abc')
    expect(out).toContain('25') // the cost is shown
    expect(out).toContain('not captured') // honest note for the empty trail
    // The usage legend is for real fragment lists; suppress it on an empty one.
    expect(out).not.toContain('✓ used · · abstained')
  })

  it('renders a session group with no captured cost and no outcome summary suffix', () => {
    const sessionOnly: LineageResponse = {
      task: {
        identifier: 'LUM-2',
        title: 'Session only',
        status: 'IN_PROGRESS',
      },
      totals: {
        runCount: 1,
        fragmentCount: 1,
        edgeCount: 1,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          total: 0,
        },
        loopCount: 0,
        outcomes: { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 1 },
        funnel: { impressions: 1, index: 0, pulled: 0, used: 0 },
        topOperations: [],
      },
      groups: [
        {
          kind: 'session',
          sessionId: 'sess-abcd',
          label: 'Session sess-abc',
          includedAt: '2026-06-02T12:00:00.000Z',
          cost: null,
          fragments: [
            {
              fragmentType: 'WEB_LINK',
              fragmentId: 'web-1',
              sourceLabel: 'Some article',
              outcome: 'UNKNOWN',
              used: null,
              disclosure: 'FULL',
              pulled: false,
            },
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

describe('formatLineageMarkdown disclosure funnel', () => {
  const withDisclosure: LineageResponse = {
    task: { identifier: 'LUM-3', title: 'Funnel', status: 'DONE' },
    totals: {
      runCount: 1,
      fragmentCount: 3,
      edgeCount: 3,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
      loopCount: 0,
      outcomes: { MERGED: 3, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
      funnel: { impressions: 3, index: 2, pulled: 1, used: 1 },
      topOperations: [],
    },
    groups: [
      {
        kind: 'session',
        sessionId: 'sess-1',
        label: 'Session sess-1',
        includedAt: '2026-06-01T00:00:00.000Z',
        cost: null,
        fragments: [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'm1',
            sourceLabel: 'A',
            outcome: 'MERGED',
            used: true,
            disclosure: 'INDEX',
            pulled: true,
          },
          {
            fragmentType: 'MEMORY',
            fragmentId: 'm2',
            sourceLabel: 'B',
            outcome: 'MERGED',
            used: null,
            disclosure: 'INDEX',
            pulled: false,
          },
          {
            fragmentType: 'PR',
            fragmentId: 'p1',
            sourceLabel: '#1',
            outcome: 'MERGED',
            used: null,
            disclosure: 'FULL',
            pulled: false,
          },
        ],
      },
    ],
  }

  it('renders the totals funnel line with INDEX-scoped pull%', () => {
    const out = formatLineageMarkdown(withDisclosure)
    expect(out).toContain(
      '- Disclosure funnel: 3 impressions · 2 INDEX (67%) · 1 pulled (50% of INDEX) · 1 used (33%)'
    )
  })

  it('annotates each fragment with its disclosure and pull state', () => {
    const out = formatLineageMarkdown(withDisclosure)
    expect(out).toContain('INDEX pulled')
    expect(out).toContain('INDEX not-pulled')
    expect(out).toContain('· FULL')
  })

  it('guards divide-by-zero when there are no INDEX fragments', () => {
    const noIndex: LineageResponse = {
      ...withDisclosure,
      totals: {
        ...withDisclosure.totals,
        funnel: { impressions: 1, index: 0, pulled: 0, used: 0 },
      },
      groups: [
        {
          ...withDisclosure.groups[0]!,
          fragments: [
            {
              fragmentType: 'PR',
              fragmentId: 'p1',
              sourceLabel: '#1',
              outcome: 'MERGED',
              used: null,
              disclosure: 'FULL',
              pulled: false,
            },
          ],
        },
      ],
    }
    const out = formatLineageMarkdown(noIndex)
    expect(out).toContain(
      '1 impressions · 0 INDEX (0%) · 0 pulled (0% of INDEX) · 0 used (0%)'
    )
    expect(out).not.toContain('NaN')
  })
})

describe('formatSignalHealth disclosure funnel', () => {
  const signalBase: UsageSignalHealth = {
    distribution: { used: 0, unused: 0, abstained: 0 },
    perSessionVariance: 0,
    votedSessions: 0,
    usedMergeRate: null,
    baseMergeRate: null,
    usedResolvedTasks: 0,
    baseResolvedTasks: 0,
    usedFailedTasks: 0,
    baseFailedTasks: 0,
    spinoffsDuringInFlight: 0,
    disclosureFunnel: { impressions: 277, index: 277, pulled: 0, used: 12 },
  }

  it('renders a workspace disclosure funnel line', () => {
    const out = formatSignalHealth(signalBase)
    expect(out).toContain(
      '- Disclosure funnel: 277 impressions · 277 INDEX (100%) · 0 pulled (0% of INDEX) · 12 used (4%)'
    )
  })

  it('guards divide-by-zero for an empty funnel', () => {
    const out = formatSignalHealth({
      ...signalBase,
      disclosureFunnel: { impressions: 0, index: 0, pulled: 0, used: 0 },
    })
    expect(out).toContain(
      '0 impressions · 0 INDEX (0%) · 0 pulled (0% of INDEX) · 0 used (0%)'
    )
    expect(out).not.toContain('NaN')
  })
})
