import {
  formatLineageMarkdown,
  formatSignalHealth,
  type LineageResponse,
} from '../../src/commands/task-lineage'

const BASE_TOTALS: LineageResponse['totals'] = {
  runCount: 1,
  fragmentCount: 2,
  edgeCount: 2,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
  loopCount: 0,
  outcomes: { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
  funnel: { impressions: 2, index: 0, pulled: 0, used: 0 },
  topOperations: [],
}

it('renders a usage marker per fragment', () => {
  const md = formatLineageMarkdown({
    task: { identifier: 'LUM-1', title: 'T', status: 'DONE' },
    totals: BASE_TOTALS,
    groups: [
      {
        kind: 'session',
        sessionId: 's1',
        label: 'Session s1',
        includedAt: '',
        cost: null,
        fragments: [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'm1',
            sourceLabel: 'drift',
            outcome: 'MERGED',
            used: true,
            disclosure: 'FULL',
            pulled: false,
          },
          {
            fragmentType: 'WEB_LINK',
            fragmentId: 'w1',
            sourceLabel: 'neon',
            outcome: 'MERGED',
            used: null,
            disclosure: 'FULL',
            pulled: false,
          },
        ],
      },
    ],
  })
  expect(md).toMatch(/✓[^\n]*drift/)
  expect(md).toMatch(/·[^\n]*neon/)
})

it('renders signal health discrimination line', () => {
  const out = formatSignalHealth({
    distribution: { used: 6, unused: 0, abstained: 4 },
    perSessionVariance: 0.18,
    votedSessions: 2,
    usedMergeRate: 0.71,
    baseMergeRate: 0.46,
    usedResolvedTasks: 7,
    baseResolvedTasks: 20,
    usedFailedTasks: 2,
    baseFailedTasks: 11,
    spinoffsDuringInFlight: 0,
    disclosureFunnel: { impressions: 0, index: 0, pulled: 0, used: 0 },
  })
  expect(out).toContain('used 6')
  expect(out).toMatch(/71%/)
  expect(out).toMatch(/46%/)
})

it('renders unused marker for used: false', () => {
  const md = formatLineageMarkdown({
    task: { identifier: 'LUM-2', title: 'U', status: 'DONE' },
    totals: BASE_TOTALS,
    groups: [
      {
        kind: 'session',
        sessionId: 's2',
        label: 'Session s2',
        includedAt: '',
        cost: null,
        fragments: [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'm2',
            sourceLabel: 'old',
            outcome: 'REJECTED',
            used: false,
            disclosure: 'FULL',
            pulled: false,
          },
        ],
      },
    ],
  })
  expect(md).toMatch(/✗[^\n]*old/)
})

it('renders the legend line in a group with fragments', () => {
  const md = formatLineageMarkdown({
    task: { identifier: 'LUM-3', title: 'L', status: 'IN_PROGRESS' },
    totals: BASE_TOTALS,
    groups: [
      {
        kind: 'session',
        sessionId: 's3',
        label: 'Session s3',
        includedAt: '',
        cost: null,
        fragments: [
          {
            fragmentType: 'PR',
            fragmentId: 'p1',
            sourceLabel: 'pr title',
            outcome: 'UNKNOWN',
            used: null,
            disclosure: 'FULL',
            pulled: false,
          },
        ],
      },
    ],
  })
  expect(md).toContain('✓ used')
  expect(md).toContain('✗ unused')
})

it('renders the top operations by token cost section', () => {
  const md = formatLineageMarkdown({
    task: { identifier: 'LUM-4', title: 'Ops', status: 'DONE' },
    totals: {
      ...BASE_TOTALS,
      topOperations: [
        { tool: 'Bash', total: 12345 },
        { tool: 'Edit', total: 678 },
      ],
    },
    groups: [
      {
        kind: 'session',
        sessionId: 's4',
        label: 'Session s4',
        includedAt: '',
        cost: null,
        fragments: [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'm4',
            sourceLabel: 'note',
            outcome: 'MERGED',
            used: true,
            disclosure: 'FULL',
            pulled: false,
          },
        ],
      },
    ],
  })
  expect(md).toContain('Top operations by token cost')
  expect(md).toContain('Bash')
  expect(md).toContain('12,345 tokens')
  expect(md).toContain('lumo usage show --task')
})

it('formatSignalHealth shows insufficient-data message when merge rates are null', () => {
  const out = formatSignalHealth({
    distribution: { used: 1, unused: 0, abstained: 2 },
    perSessionVariance: 0,
    votedSessions: 1,
    usedMergeRate: null,
    baseMergeRate: null,
    usedResolvedTasks: 0,
    baseResolvedTasks: 5,
    usedFailedTasks: 0,
    baseFailedTasks: 0,
    spinoffsDuringInFlight: 0,
    disclosureFunnel: { impressions: 0, index: 0, pulled: 0, used: 0 },
  })
  expect(out).toContain('insufficient resolved tasks')
})

describe('formatSignalHealth negative-class display', () => {
  it('shows the honesty guard when the negative class is empty', () => {
    const out = formatSignalHealth({
      distribution: { used: 6, unused: 0, abstained: 4 },
      perSessionVariance: 0,
      votedSessions: 2,
      usedMergeRate: 1,
      baseMergeRate: 1,
      usedResolvedTasks: 6,
      baseResolvedTasks: 20,
      usedFailedTasks: 0,
      baseFailedTasks: 0,
      spinoffsDuringInFlight: 0,
      disclosureFunnel: { impressions: 0, index: 0, pulled: 0, used: 0 },
    })
    expect(out).toContain('cannot discriminate')
    expect(out).not.toMatch(/100%/)
    expect(out).not.toContain('merge-rate(used)')
  })

  it('shows rates with negative-class size when non-empty', () => {
    const out = formatSignalHealth({
      distribution: { used: 6, unused: 0, abstained: 4 },
      perSessionVariance: 0.18,
      votedSessions: 2,
      usedMergeRate: 0.71,
      baseMergeRate: 0.46,
      usedResolvedTasks: 7,
      baseResolvedTasks: 20,
      usedFailedTasks: 2,
      baseFailedTasks: 11,
      spinoffsDuringInFlight: 0,
      disclosureFunnel: { impressions: 0, index: 0, pulled: 0, used: 0 },
    })
    expect(out).toMatch(/46%/)
    expect(out).toContain('11 failed')
    expect(out).toContain('2 failed')
  })
})

it('prints the top commands under a Bash row', () => {
  const md = formatLineageMarkdown({
    task: { identifier: 'LUM-5', title: 'Ops', status: 'DONE' },
    totals: {
      ...BASE_TOTALS,
      topOperations: [
        {
          tool: 'Bash · read/search',
          total: 9000,
          commands: [
            { command: 'grep', total: 4999.5 },
            { command: 'sed', total: 2500 },
            { command: 'cat', total: 1000 },
            { command: 'ls', total: 500 },
          ],
        },
        { tool: 'Edit', total: 678 },
      ],
    },
    groups: [
      {
        kind: 'session',
        sessionId: 's5',
        label: 'Session s5',
        includedAt: '',
        cost: null,
        fragments: [],
      },
    ],
  })
  const lines = md.split('\n')
  const parent = lines.findIndex(l => l.includes('Bash · read/search'))
  expect(lines[parent + 1]).toBe('    ↳ grep — 5,000 tokens')
  expect(lines[parent + 2]).toBe('    ↳ sed — 2,500 tokens')
  expect(lines[parent + 3]).toBe('    ↳ cat — 1,000 tokens')
  // Top 3 only; the full list lives in `lumo usage show`.
  expect(md).not.toContain('↳ ls')
  expect(lines[parent + 4]).toBe('  Edit — 678 tokens')
})
