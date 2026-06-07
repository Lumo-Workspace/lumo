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
      renderLineageSection([{ label: '[MEMORY] "x"', resolvedTasks: 2, mergedTasks: 2 }], 0)
    ).toBe('')
  })

  it('renders a header, caveat, and one line per qualifying entry with percent + fraction', () => {
    const out = renderLineageSection([
      { label: '[MEMORY] "use color-mix"', resolvedTasks: 5, mergedTasks: 4 },
      { label: '[PR] #123', resolvedTasks: 2, mergedTasks: 2 },
    ], 0)
    expect(out).toContain('## 飞轮信号 · 历史 merge 贡献')
    expect(out).toContain('历史相关性,非因果')
    expect(out).toContain('- [MEMORY] "use color-mix" — 出现在 5 个已闭合任务·4 merged (80%)')
    expect(out).not.toContain('#123')
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
      { resolveCanonicalFragment, mergeRateByFragments, countResolvedTasks: async () => 99 }
    )

    expect(mergeRateByFragments).toHaveBeenCalledWith([
      { fragmentType: 'MEMORY', fragmentId: 'mem-canon' },
    ])
    expect(out).toContain('- [MEMORY] "use color-mix not hsl(var())" — 出现在 5 个已闭合任务·4 merged (80%)')
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
        countResolvedTasks: async () => 99,
      }
    )
    expect(out).toContain('- [WEB_LINK] weblink1 — 出现在 3 个已闭合任务·3 merged (100%)')
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
        countResolvedTasks: async () => 99,
      }
    )
    // Exactly one signal line, using the first fragment's label
    expect(out).toContain('- [MEMORY] "first label wins" — 出现在 4 个已闭合任务·3 merged (75%)')
    expect(out).not.toContain('second label loses')
    const lineCount = out.split('\n').filter(l => l.startsWith('- ')).length
    expect(lineCount).toBe(1)
  })
})

describe('renderLineageSection — presence-variance note', () => {
  it('renders header + note (no list) when all qualifying entries were excluded', () => {
    const out = renderLineageSection([], 7)
    expect(out).toContain('## 飞轮信号 · 历史 merge 贡献')
    expect(out).toContain('已排除 7 个全量加载')
    // no merge-rate list items (the note legitimately contains "出现在")
    expect(out.split('\n').filter(l => l.startsWith('- '))).toHaveLength(0)
  })

  it('renders list + note when some excluded and some survive', () => {
    const out = renderLineageSection(
      [{ label: '[MEMORY] "x"', resolvedTasks: 3, mergedTasks: 2 }],
      2
    )
    expect(out).toContain('- [MEMORY] "x" — 出现在 3 个已闭合任务·2 merged (67%)')
    expect(out).toContain('已排除 2 个全量加载')
  })

  it('omits the note when nothing was excluded', () => {
    const out = renderLineageSection(
      [{ label: '[MEMORY] "x"', resolvedTasks: 3, mergedTasks: 3 }],
      0
    )
    expect(out).not.toContain('已排除')
  })

  it('returns "" when no survivors and nothing excluded', () => {
    expect(renderLineageSection([], 0)).toBe('')
  })
})

describe('assembleLineageSection — zero-variance exclusion', () => {
  const deps = (universe: number, stats: FragmentMergeRate[]) => ({
    resolveCanonicalFragment: async (_t: string, id: string) => id,
    mergeRateByFragments: async () => stats,
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
    expect(out).toContain('## 飞轮信号') // header still shown
    expect(out).toContain('已排除 1 个全量加载')
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
    expect(out).toContain('- [MEMORY] "selective mem" — 出现在 4 个已闭合任务·3 merged (75%)')
    expect(out).not.toContain('已排除')
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
