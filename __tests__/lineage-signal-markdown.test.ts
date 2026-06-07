import { assembleLineageSection } from '@/lib/services/lineage-signal'
import type { ContextFragmentType } from '@/lib/services/task-context.service'

function deps(
  over: Partial<Parameters<typeof assembleLineageSection>[2]> = {}
) {
  return {
    resolveCanonicalFragment: async (_t: string, id: string) => id,
    mergeRateByFragments: async () => [],
    usageMergeRateByFragments: async () => [],
    countResolvedTasks: async () => 0,
    ...over,
  }
}

const frag = (id: string): { type: ContextFragmentType; id: string } => ({
  type: 'MEMORY',
  id,
})

describe('assembleLineageSection markdown (post-refactor parity)', () => {
  it('renders a usage line with the strong-signal suffix', async () => {
    const out = await assembleLineageSection(
      [frag('a')],
      new Map([['a', 'Use waitUntil for side effects']]),
      deps({
        usageMergeRateByFragments: async () => [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'a',
            usedResolvedTasks: 4,
            usedMergedTasks: 3,
          },
        ],
        countResolvedTasks: async () => 10,
      })
    )
    expect(out).toContain('## 飞轮信号 · 历史 merge 贡献')
    expect(out).toContain('用过的 4 个已闭合任务·3 merged (75%) · 真实使用信号')
  })

  it('renders presence line + zero-variance note, usage grouped before presence', async () => {
    const out = await assembleLineageSection(
      [frag('strong'), frag('weak'), frag('global')],
      new Map([
        ['strong', 'S'],
        ['weak', 'W'],
        ['global', 'G'],
      ]),
      deps({
        usageMergeRateByFragments: async () => [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'strong',
            usedResolvedTasks: 5,
            usedMergedTasks: 5,
          },
        ],
        mergeRateByFragments: async () => [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'weak',
            resolvedTasks: 4,
            mergedTasks: 2,
          },
          {
            fragmentType: 'MEMORY',
            fragmentId: 'global',
            resolvedTasks: 6,
            mergedTasks: 6,
          },
        ],
        countResolvedTasks: async () => 6,
      })
    )
    const usageIdx = out.indexOf('真实使用信号')
    const presenceIdx = out.indexOf('仅共同加载,弱信号')
    expect(usageIdx).toBeGreaterThan(-1)
    expect(presenceIdx).toBeGreaterThan(usageIdx) // usage grouped first
    expect(out).toContain('已排除 1 个全量加载')
  })

  it('returns "" when nothing qualifies and nothing excluded', async () => {
    const out = await assembleLineageSection([frag('x')], new Map(), deps())
    expect(out).toBe('')
  })
})
