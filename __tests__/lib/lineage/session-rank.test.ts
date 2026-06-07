import { rankSessionStartCards } from '@/lib/lineage/session-rank'
import type { RenderableMemory } from '@/lib/memory/render'
import type { FragmentMergeRate } from '@/lib/repositories/lineage-edge.repository'

const mem = (id: string, scope: 'PROJECT' | 'TASK'): RenderableMemory => ({
  id,
  scope,
  category: 'TRAP',
  content: { trigger: id, outcome: id },
})

const identityResolve = async (_t: string, id: string) => id

describe('rankSessionStartCards', () => {
  it('dedupes memories that share a canonical id, keeping the first (PROJECT) row', async () => {
    // task row 'mem-t' resolves to the promoted project row 'mem-p'.
    const resolveCanonical = async (_t: string, id: string) =>
      id === 'mem-t' ? 'mem-p' : id
    const out = await rankSessionStartCards(
      {
        memories: [mem('mem-p', 'PROJECT'), mem('mem-t', 'TASK')],
        slack: [],
        web: [],
        figma: [],
        prs: [],
      },
      { resolveCanonical, mergeRateByFragments: async () => [] }
    )
    expect(out.memories.map(m => m.id)).toEqual(['mem-p'])
  })

  it('floats a high-merge memory above a cold one, scoring by canonical id', async () => {
    const resolveCanonical = async (_t: string, id: string) =>
      id === 'mem-hot' ? 'mem-canon' : id
    const mergeRateByFragments = async (): Promise<FragmentMergeRate[]> => [
      {
        fragmentType: 'MEMORY',
        fragmentId: 'mem-canon',
        resolvedTasks: 4,
        mergedTasks: 4,
      },
    ]
    const out = await rankSessionStartCards(
      {
        memories: [mem('mem-cold', 'PROJECT'), mem('mem-hot', 'TASK')],
        slack: [],
        web: [],
        figma: [],
        prs: [],
      },
      { resolveCanonical, mergeRateByFragments }
    )
    expect(out.memories.map(m => m.id)).toEqual(['mem-hot', 'mem-cold'])
  })

  it('ranks non-memory sections by raw id and preserves cross-section grouping', async () => {
    const mergeRateByFragments = async (): Promise<FragmentMergeRate[]> => [
      {
        fragmentType: 'WEB_LINK',
        fragmentId: 'web-hot',
        resolvedTasks: 3,
        mergedTasks: 3,
      },
    ]
    const out = await rankSessionStartCards(
      {
        memories: [],
        slack: [],
        web: [{ id: 'web-cold' }, { id: 'web-hot' }],
        figma: [],
        prs: [],
      },
      { resolveCanonical: identityResolve, mergeRateByFragments }
    )
    expect(out.web.map(w => w.id)).toEqual(['web-hot', 'web-cold'])
  })

  it('falls back to the input unchanged when scoring throws (never blocks session-start)', async () => {
    const out = await rankSessionStartCards(
      {
        memories: [mem('mem-p', 'PROJECT'), mem('mem-t', 'TASK')],
        slack: [{ id: 's-1' }],
        web: [],
        figma: [],
        prs: [],
      },
      {
        resolveCanonical: identityResolve,
        mergeRateByFragments: async () => {
          throw new Error('db down')
        },
      }
    )
    expect(out.memories.map(m => m.id)).toEqual(['mem-p', 'mem-t'])
    expect(out.slack.map(s => s.id)).toEqual(['s-1'])
  })

  it('falls back when canonical resolution throws', async () => {
    const out = await rankSessionStartCards(
      {
        memories: [mem('mem-p', 'PROJECT')],
        slack: [],
        web: [],
        figma: [],
        prs: [],
      },
      {
        resolveCanonical: async () => {
          throw new Error('resolve down')
        },
        mergeRateByFragments: async () => [],
      }
    )
    expect(out.memories.map(m => m.id)).toEqual(['mem-p'])
  })

  it('dedupes a promoted memory and still scores the survivor by canonical id', async () => {
    // 'mem-t' (task) is the promoted dup of 'mem-p' (project); their shared
    // canonical 'mem-p' has a high merge stat, so the surviving 'mem-p' must
    // outrank the cold 'mem-other'.
    const resolveCanonical = async (_t: string, id: string) =>
      id === 'mem-t' ? 'mem-p' : id
    const mergeRateByFragments = async (): Promise<FragmentMergeRate[]> => [
      {
        fragmentType: 'MEMORY',
        fragmentId: 'mem-p',
        resolvedTasks: 5,
        mergedTasks: 5,
      },
    ]
    const out = await rankSessionStartCards(
      {
        memories: [
          mem('mem-other', 'PROJECT'),
          mem('mem-p', 'PROJECT'),
          mem('mem-t', 'TASK'),
        ],
        slack: [],
        web: [],
        figma: [],
        prs: [],
      },
      { resolveCanonical, mergeRateByFragments }
    )
    expect(out.memories.map(m => m.id)).toEqual(['mem-p', 'mem-other'])
  })
})
