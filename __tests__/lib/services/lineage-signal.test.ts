import {
  LINEAGE_MIN_AUDITED_TASKS,
  LINEAGE_PROVEN_USED_TASKS,
  renderLineageSection,
  assembleLineageSection,
  type TrackRecordEntry,
} from '@/lib/services/lineage-signal'
import type { FragmentJudgedUsage } from '@/lib/repositories/lineage-edge.repository'

const entry = (over: Partial<TrackRecordEntry> = {}): TrackRecordEntry => ({
  label: '[MEMORY] "x"',
  judgedUsedTasks: 4,
  appearanceTasks: 6,
  qualified: true,
  retireCandidate: false,
  ...over,
})
const judged = (
  id: string,
  judgedUsedTasks: number,
  auditedTasks: number,
  appearanceTasks: number,
  fragmentType: FragmentJudgedUsage['fragmentType'] = 'MEMORY'
): FragmentJudgedUsage => ({
  fragmentType,
  fragmentId: id,
  judgedUsedTasks,
  auditedTasks,
  appearanceTasks,
})

describe('cold-start constants', () => {
  it('default to 3', () => {
    expect(LINEAGE_MIN_AUDITED_TASKS).toBe(3)
    expect(LINEAGE_PROVEN_USED_TASKS).toBe(3)
  })
})

describe('renderLineageSection', () => {
  it('returns "" with no entries', () => {
    expect(renderLineageSection([])).toBe('')
  })

  it('renders the judged-used header + one line per entry, no merge framing', () => {
    const out = renderLineageSection([
      entry({
        label: '[MEMORY] "use color-mix"',
        judgedUsedTasks: 4,
        appearanceTasks: 6,
      }),
    ])
    expect(out).toContain('## Memory usefulness · judged-used track record')
    expect(out).toContain(
      '- [MEMORY] "use color-mix" — judged-used in 4 of 6 tasks · proven'
    )
    expect(out).not.toContain('merged')
  })

  it('tags retire candidates and unproven entries', () => {
    const out = renderLineageSection([
      entry({
        label: '[MEMORY] "r"',
        judgedUsedTasks: 0,
        appearanceTasks: 8,
        qualified: false,
        retireCandidate: true,
      }),
      entry({
        label: '[MEMORY] "u"',
        judgedUsedTasks: 1,
        appearanceTasks: 5,
        qualified: false,
        retireCandidate: false,
      }),
    ])
    expect(out).toContain(
      '- [MEMORY] "r" — judged-used in 0 of 8 tasks · retire candidate'
    )
    expect(out).toContain('- [MEMORY] "u" — judged-used in 1 of 5 tasks')
    // an unproven, non-retire line carries no suffix
    expect(out).not.toContain('1 of 5 tasks · proven')
  })
})

describe('assembleLineageSection', () => {
  const memContent = new Map([['mem-1', '   use color-mix not hsl(var())   ']])

  it('resolves canonical id, joins stats, gates, and renders', async () => {
    const resolveCanonicalFragment = jest
      .fn()
      .mockImplementation(async (_t: string, id: string) =>
        id === 'mem-1' ? 'mem-canon' : id
      )
    const judgedUsageByFragments = jest
      .fn()
      .mockResolvedValue([judged('mem-canon', 4, 5, 6)])

    const out = await assembleLineageSection(
      [
        { type: 'MEMORY', id: 'mem-1' },
        { type: 'ARTIFACT', id: 'art-1' }, // no lineage type → filtered out
      ],
      memContent,
      { resolveCanonicalFragment, judgedUsageByFragments }
    )

    expect(judgedUsageByFragments).toHaveBeenCalledWith([
      { fragmentType: 'MEMORY', fragmentId: 'mem-canon' },
    ])
    expect(out).toContain(
      '- [MEMORY] "use color-mix not hsl(var())" — judged-used in 4 of 6 tasks · proven'
    )
  })

  it('returns "" when a fragment is below the cold-start audit floor', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      memContent,
      {
        resolveCanonicalFragment: async (_t, id) => id,
        judgedUsageByFragments: async () => [judged('mem-1', 1, 2, 5)],
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
        judgedUsageByFragments: async () => {
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
        judgedUsageByFragments: async () => [
          judged('weblink12345678', 3, 3, 3, 'WEB_LINK'),
        ],
      }
    )
    expect(out).toContain('- [WEB_LINK] weblink1 — judged-used in 3 of 3 tasks')
  })

  it('dedupes fragments that resolve to the same canonical id (first label wins)', async () => {
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
        resolveCanonicalFragment: async (_t, _id) => 'mem-canon',
        judgedUsageByFragments: async () => [judged('mem-canon', 3, 4, 4)],
      }
    )
    expect(out).toContain(
      '- [MEMORY] "first label wins" — judged-used in 3 of 4 tasks'
    )
    expect(out).not.toContain('second label loses')
    expect(out.split('\n').filter(l => l.startsWith('- '))).toHaveLength(1)
  })
})
