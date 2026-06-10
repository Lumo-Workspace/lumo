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
    expect(out).toContain('## Flywheel signal · historical merge contribution')
    expect(out).toContain('used in 4 resolved tasks · 3 merged (75%) · real-usage signal')
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
    const usageIdx = out.indexOf('real-usage signal')
    const presenceIdx = out.indexOf('co-load only, weak signal')
    expect(usageIdx).toBeGreaterThan(-1)
    expect(presenceIdx).toBeGreaterThan(usageIdx) // usage grouped first
    expect(out).toContain('Excluded 1 always-loaded fragment(s)')
  })

  it('returns "" when nothing qualifies and nothing excluded', async () => {
    const out = await assembleLineageSection([frag('x')], new Map(), deps())
    expect(out).toBe('')
  })
})
