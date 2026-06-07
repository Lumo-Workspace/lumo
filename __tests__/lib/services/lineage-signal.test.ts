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
      renderLineageSection([{ label: '[MEMORY] "x"', resolvedTasks: 2, mergedTasks: 2 }])
    ).toBe('')
  })

  it('renders a header, caveat, and one line per qualifying entry with percent + fraction', () => {
    const out = renderLineageSection([
      { label: '[MEMORY] "use color-mix"', resolvedTasks: 5, mergedTasks: 4 },
      { label: '[PR] #123', resolvedTasks: 2, mergedTasks: 2 },
    ])
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
      { resolveCanonicalFragment, mergeRateByFragments }
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
      }
    )
    expect(out).toContain('- [WEB_LINK] weblink1 — 出现在 3 个已闭合任务·3 merged (100%)')
  })
})
