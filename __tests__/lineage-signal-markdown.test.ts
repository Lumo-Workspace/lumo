import { assembleLineageSection } from '@/lib/services/lineage-signal'
import type { ContextFragmentType } from '@/lib/services/task-context.service'
import type { FragmentJudgedUsage } from '@/lib/repositories/lineage-edge.repository'

function deps(
  over: Partial<Parameters<typeof assembleLineageSection>[2]> = {}
) {
  return {
    resolveCanonicalFragment: async (_t: string, id: string) => id,
    judgedUsageByFragments: async () => [],
    ...over,
  }
}

const frag = (id: string): { type: ContextFragmentType; id: string } => ({
  type: 'MEMORY',
  id,
})
const judged = (
  id: string,
  judgedUsedTasks: number,
  auditedTasks: number,
  appearanceTasks: number
): FragmentJudgedUsage => ({
  fragmentType: 'MEMORY',
  fragmentId: id,
  judgedUsedTasks,
  auditedTasks,
  appearanceTasks,
})

describe('assembleLineageSection markdown (judged-used track record)', () => {
  it('renders judged-used track record line', async () => {
    const out = await assembleLineageSection(
      [frag('a')],
      new Map([['a', 'Use waitUntil for side effects']]),
      deps({
        judgedUsageByFragments: async () => [judged('a', 4, 5, 7)],
      })
    )
    expect(out).toContain('## Memory usefulness · judged-used track record')
    expect(out).toContain('judged-used in 4 of 7 tasks · proven')
    // The retired merge-rate framing is gone.
    expect(out).not.toContain('merged')
    expect(out).not.toContain('merge contribution')
  })

  it('tags a proven fragment and a retire candidate distinctly', async () => {
    const out = await assembleLineageSection(
      [frag('proven'), frag('retire')],
      new Map([
        ['proven', 'P'],
        ['retire', 'R'],
      ]),
      deps({
        judgedUsageByFragments: async () => [
          judged('proven', 5, 5, 5),
          judged('retire', 0, 4, 8),
        ],
      })
    )
    expect(out).toContain('judged-used in 5 of 5 tasks · proven')
    expect(out).toContain('judged-used in 0 of 8 tasks · retire candidate')
  })

  it('omits cold-start fragments (below the audit floor) and returns "" when nothing qualifies', async () => {
    const out = await assembleLineageSection(
      [frag('x')],
      new Map([['x', 'X']]),
      deps({
        judgedUsageByFragments: async () => [judged('x', 0, 1, 3)],
      })
    )
    expect(out).toBe('')
  })
})
