import {
  LINEAGE_MIN_RESOLVED_TASKS,
  renderLineageSection,
  assembleLineageSection,
} from '@/lib/services/lineage-signal'
import type { FragmentMergeRate } from '@/lib/repositories/lineage-edge.repository'

describe('LINEAGE_MIN_RESOLVED_TASKS', () => {
  it('is 3', () => {
    expect(LINEAGE_MIN_RESOLVED_TASKS).toBe(3)
  })
})

describe('renderLineageSection', () => {
  it('returns "" when no entry meets the threshold', () => {
    expect(
      renderLineageSection([], [{ label: '[MEMORY] "x"', resolvedTasks: 2, mergedTasks: 2 }], 0)
    ).toBe('')
  })

  it('renders a header, caveat, and one line per qualifying entry with percent + fraction', () => {
    const out = renderLineageSection([], [
      { label: '[MEMORY] "use color-mix"', resolvedTasks: 5, mergedTasks: 4 },
      { label: '[PR] #123', resolvedTasks: 2, mergedTasks: 2 },
    ], 0)
    expect(out).toContain('## Flywheel signal · historical merge contribution')
    expect(out).toContain('Historical correlation, not causation')
    expect(out).toContain('- [MEMORY] "use color-mix" — appeared in 5 resolved tasks · 4 merged (80%)')
    expect(out).toContain('co-load only, weak signal')
    expect(out).not.toContain('#123')
  })

  it('renders usage entries with the real-usage signal marker', () => {
    const out = renderLineageSection(
      [{ label: '[MEMORY] "used"', usedResolvedTasks: 4, usedMergedTasks: 3 }],
      [],
      0
    )
    expect(out).toContain('- [MEMORY] "used" — used in 4 resolved tasks · 3 merged (75%) · real-usage signal')
    // no presence fallback list line (the caveat line mentions co-load only)
    const presenceLines = out
      .split('\n')
      .filter(l => l.startsWith('- ') && l.includes('co-load only'))
    expect(presenceLines).toHaveLength(0)
  })
})

describe('assembleLineageSection', () => {
  const memContent = new Map([['mem-1', '   use color-mix not hsl(var())   ']])

  it('maps + resolves canonical + joins stats + gates, returning the section', async () => {
    const resolveCanonicalFragment = jest
      .fn()
      .mockImplementation(async (_t: string, id: string) =>
        id === 'mem-1' ? 'mem-canon' : id
      )
    const mergeRateByFragments = jest
      .fn()
      .mockResolvedValue([
        { fragmentType: 'MEMORY', fragmentId: 'mem-canon', resolvedTasks: 5, mergedTasks: 4 },
      ] as FragmentMergeRate[])

    const out = await assembleLineageSection(
      [
        { type: 'MEMORY', id: 'mem-1' },
        { type: 'ARTIFACT', id: 'art-1' },
      ],
      memContent,
      { resolveCanonicalFragment, mergeRateByFragments, usageMergeRateByFragments: async () => [], countResolvedTasks: async () => 99 }
    )

    expect(mergeRateByFragments).toHaveBeenCalledWith([
      { fragmentType: 'MEMORY', fragmentId: 'mem-canon' },
    ])
    expect(out).toContain('- [MEMORY] "use color-mix not hsl(var())" — appeared in 5 resolved tasks · 4 merged (80%)')
  })

  it('returns "" when a fragment has stats but is below threshold', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      memContent,
      {
        resolveCanonicalFragment: async (_t, id) => id,
        mergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 2, mergedTasks: 2 },
        ],
        usageMergeRateByFragments: async () => [],
        countResolvedTasks: async () => 99,
      }
    )
    expect(out).toBe('')
  })

  it('degrades to "" (does not throw) when the query errors', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      memContent,
      {
        resolveCanonicalFragment: async (_t, id) => id,
        mergeRateByFragments: async () => {
          throw new Error('db down')
        },
        usageMergeRateByFragments: async () => [],
        countResolvedTasks: async () => 99,
      }
    )
    expect(out).toBe('')
  })

  it('falls back to a generic label when no friendly label is available', async () => {
    const out = await assembleLineageSection(
      [{ type: 'WEB_LINK', id: 'weblink12345678' }],
      new Map(),
      {
        resolveCanonicalFragment: async (_t, id) => id,
        mergeRateByFragments: async () => [
          { fragmentType: 'WEB_LINK', fragmentId: 'weblink12345678', resolvedTasks: 3, mergedTasks: 3 },
        ],
        usageMergeRateByFragments: async () => [],
        countResolvedTasks: async () => 99,
      }
    )
    expect(out).toContain('- [WEB_LINK] weblink1 — appeared in 3 resolved tasks · 3 merged (100%)')
  })

  it('dedupes fragments that resolve to the same canonical id (first wins)', async () => {
    const out = await assembleLineageSection(
      [
        { type: 'MEMORY', id: 'mem-a' },
        { type: 'MEMORY', id: 'mem-b' },
      ],
      new Map([
        ['mem-a', 'first label wins'],
        ['mem-b', 'second label loses'],
      ]),
      {
        resolveCanonicalFragment: async (_t, _id) => 'mem-canon', // both collapse
        mergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'mem-canon', resolvedTasks: 4, mergedTasks: 3 },
        ],
        usageMergeRateByFragments: async () => [],
        countResolvedTasks: async () => 99,
      }
    )
    // Exactly one signal line, using the first fragment's label
    expect(out).toContain('- [MEMORY] "first label wins" — appeared in 4 resolved tasks · 3 merged (75%)')
    expect(out).not.toContain('second label loses')
    const lineCount = out.split('\n').filter(l => l.startsWith('- ')).length
    expect(lineCount).toBe(1)
  })
})

describe('renderLineageSection — presence-variance note', () => {
  it('renders header + note (no list) when all qualifying entries were excluded', () => {
    const out = renderLineageSection([], [], 7)
    expect(out).toContain('## Flywheel signal · historical merge contribution')
    expect(out).toContain('Excluded 7 always-loaded fragment(s)')
    // no merge-rate list items (the note legitimately contains "appear in")
    expect(out.split('\n').filter(l => l.startsWith('- '))).toHaveLength(0)
  })

  it('renders list + note when some excluded and some survive', () => {
    const out = renderLineageSection(
      [],
      [{ label: '[MEMORY] "x"', resolvedTasks: 3, mergedTasks: 2 }],
      2
    )
    expect(out).toContain('- [MEMORY] "x" — appeared in 3 resolved tasks · 2 merged (67%)')
    expect(out).toContain('Excluded 2 always-loaded fragment(s)')
  })

  it('omits the note when nothing was excluded', () => {
    const out = renderLineageSection(
      [],
      [{ label: '[MEMORY] "x"', resolvedTasks: 3, mergedTasks: 3 }],
      0
    )
    expect(out).not.toContain('Excluded')
  })

  it('returns "" when no survivors and nothing excluded', () => {
    expect(renderLineageSection([], [], 0)).toBe('')
  })
})

describe('assembleLineageSection — zero-variance exclusion', () => {
  const deps = (universe: number, stats: FragmentMergeRate[]) => ({
    resolveCanonicalFragment: async (_t: string, id: string) => id,
    mergeRateByFragments: async () => stats,
    usageMergeRateByFragments: async () => [],
    countResolvedTasks: async () => universe,
  })

  it('excludes a fragment present in EVERY resolved task (resolvedTasks === universe)', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      new Map([['mem-1', 'always loaded']]),
      deps(5, [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 5, mergedTasks: 5 },
      ])
    )
    expect(out).toContain('## Flywheel signal') // header still shown
    expect(out).toContain('Excluded 1 always-loaded fragment(s)')
    expect(out).not.toContain('always loaded')
  })

  it('keeps a fragment with presence variance (resolvedTasks < universe, >= 3)', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      new Map([['mem-1', 'selective mem']]),
      deps(5, [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 4, mergedTasks: 3 },
      ])
    )
    expect(out).toContain('- [MEMORY] "selective mem" — appeared in 4 resolved tasks · 3 merged (75%)')
    expect(out).not.toContain('Excluded')
  })

  it('excludes one and keeps another end-to-end (partial exclusion)', async () => {
    const out = await assembleLineageSection(
      [
        { type: 'MEMORY', id: 'always' },
        { type: 'MEMORY', id: 'selective' },
      ],
      new Map([
        ['always', 'always loaded'],
        ['selective', 'selective mem'],
      ]),
      deps(5, [
        { fragmentType: 'MEMORY', fragmentId: 'always', resolvedTasks: 5, mergedTasks: 5 },
        { fragmentType: 'MEMORY', fragmentId: 'selective', resolvedTasks: 4, mergedTasks: 3 },
      ])
    )
    expect(out).toContain('- [MEMORY] "selective mem" — appeared in 4 resolved tasks · 3 merged (75%)')
    expect(out).not.toContain('always loaded')
    expect(out).toContain('Excluded 1 always-loaded fragment(s)')
  })

  it('does NOT exclude when universe is 0 (no resolved edges)', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      new Map([['mem-1', 'x']]),
      deps(0, [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 0, mergedTasks: 0 },
      ])
    )
    expect(out).toBe('') // 0 < 3 cold-start gate, nothing excluded, nothing shown
  })
})

describe('assembleLineageSection — usage preferred over presence', () => {
  const base = {
    resolveCanonicalFragment: async (_t: string, id: string) => id,
    countResolvedTasks: async () => 99,
  }

  it('shows the usage line (real-usage signal) when usedResolvedTasks >= 3', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'm1' }],
      new Map([['m1', 'used mem']]),
      {
        ...base,
        mergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'm1', resolvedTasks: 5, mergedTasks: 5 },
        ],
        usageMergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'm1', usedResolvedTasks: 4, usedMergedTasks: 3 },
        ],
      }
    )
    expect(out).toContain('- [MEMORY] "used mem" — used in 4 resolved tasks · 3 merged (75%) · real-usage signal')
    expect(out).not.toContain('80%') // presence number suppressed in favor of usage
  })

  it('a zero-variance fragment still shows usage signal (usage bypasses exclusion)', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'm1' }],
      new Map([['m1', 'always loaded but used']]),
      {
        ...base,
        countResolvedTasks: async () => 5,
        mergeRateByFragments: async () => [
          // resolvedTasks === universe (5) → would be excluded on the presence path
          { fragmentType: 'MEMORY', fragmentId: 'm1', resolvedTasks: 5, mergedTasks: 5 },
        ],
        usageMergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'm1', usedResolvedTasks: 3, usedMergedTasks: 2 },
        ],
      }
    )
    expect(out).toContain('- [MEMORY] "always loaded but used" — used in 3 resolved tasks · 2 merged (67%) · real-usage signal')
    expect(out).not.toContain('Excluded') // usage preempts the zero-variance exclusion
  })

  it('falls back to presence (weak signal) when usage sample < 3', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'm1' }],
      new Map([['m1', 'mem']]),
      {
        ...base,
        countResolvedTasks: async () => 9, // so presence (resolvedTasks 4) is NOT excluded
        mergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'm1', resolvedTasks: 4, mergedTasks: 3 },
        ],
        usageMergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'm1', usedResolvedTasks: 1, usedMergedTasks: 1 },
        ],
      }
    )
    expect(out).toContain('appeared in 4 resolved tasks · 3 merged (75%) · co-load only, weak signal')
    // no usage list line emitted (the methodology line mentions "used", so scope to list items)
    const usageLines = out
      .split('\n')
      .filter(l => l.startsWith('- ') && l.includes('real-usage signal'))
    expect(usageLines).toHaveLength(0)
  })
})
