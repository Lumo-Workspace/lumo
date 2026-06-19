/**
 * @jest-environment node
 */
const mockListForProject = jest.fn()
const mockJudged = jest.fn()

jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    listForProject: (...a: unknown[]) => mockListForProject(...a),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    judgedUsageByFragments: (...a: unknown[]) => mockJudged(...a),
  },
}))

import { memorySyncService } from '@/lib/services/memory/memory-sync.service'

beforeEach(() => jest.clearAllMocks())

const conv = (id: string, rule: string) => ({
  id,
  scope: 'PROJECT',
  category: 'CONVENTION',
  content: { rule, scope: 'x' },
})

describe('memorySyncService.buildBundle', () => {
  it('returns file-shaped entries for ACTIVE project memories', async () => {
    mockListForProject.mockResolvedValue([
      {
        id: 'm1',
        scope: 'PROJECT',
        category: 'CONVENTION',
        content: { rule: 'r', scope: 's' },
      },
    ])
    mockJudged.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'm1',
        judgedUsedTasks: 4,
        auditedTasks: 5,
        appearanceTasks: 5,
      },
    ])

    const bundle = await memorySyncService.buildBundle('proj_1', {
      syncedAtIso: 'T',
    })

    expect(bundle.projectId).toBe('proj_1')
    expect(bundle.entries).toHaveLength(1)
    expect(bundle.entries[0]!.relPath).toBe('team/m1.md')
    expect(mockJudged).toHaveBeenCalledWith([
      { fragmentType: 'MEMORY', fragmentId: 'm1' },
    ])
  })

  it('returns an empty bundle when the project has no memories', async () => {
    mockListForProject.mockResolvedValue([])
    mockJudged.mockResolvedValue([])
    const bundle = await memorySyncService.buildBundle('proj_empty', {
      syncedAtIso: 'T',
    })
    expect(bundle.entries).toEqual([])
  })

  // LUM-552: sync = mirror the whole project's ACTIVE memory, no task-level
  // routing. "Which one is relevant" is recall's job (Claude Code native), not
  // sync's; the old per-recipient anchor filter deleted the unknown-unknowns a
  // dev most needs. buildBundle now takes no routing input at all.
  it('mirrors the full ACTIVE project memory set regardless of recipient', async () => {
    mockListForProject.mockResolvedValue([
      conv('m1', 'alpha'),
      conv('m2', 'beta'),
      conv('m3', 'gamma'),
    ])
    mockJudged.mockResolvedValue([]) // all cold-start: pre-LUM-552 these would
    // have been scored against an anchor and culled below the 0.2 floor.

    // Two recipients (a heavy task load vs. none) hit the SAME entry point — the
    // bundle no longer depends on who is asking.
    const first = await memorySyncService.buildBundle('p', { syncedAtIso: 'T' })
    const second = await memorySyncService.buildBundle('p', {
      syncedAtIso: 'T',
    })

    expect(first.entries.map(e => e.id).sort()).toEqual(['m1', 'm2', 'm3'])
    expect(second.entries.map(e => e.id)).toEqual(first.entries.map(e => e.id))
  })

  // LUM-552: MEMORY.md is "one-line index resident + pull body on demand", so
  // the corpus is no longer token-budget-capped (the old applyTokenBudget at
  // ~1000 tokens dropped all but a handful of the 264 real entries).
  it('does not token-budget-cap the sync corpus', async () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      conv(`m${i}`, `rule number ${i} with enough text to exceed the old cap`)
    )
    mockListForProject.mockResolvedValue(many)
    mockJudged.mockResolvedValue([])

    const bundle = await memorySyncService.buildBundle('p', {
      syncedAtIso: 'T',
    })

    expect(bundle.entries).toHaveLength(300)
  })
})
