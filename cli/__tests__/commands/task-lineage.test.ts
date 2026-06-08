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
          },
          {
            fragmentType: 'WEB_LINK',
            fragmentId: 'w1',
            sourceLabel: 'neon',
            outcome: 'MERGED',
            used: null,
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
          },
        ],
      },
    ],
  })
  expect(md).toContain('✓ used')
  expect(md).toContain('✗ unused')
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
  })
  expect(out).toContain('insufficient resolved tasks')
})
