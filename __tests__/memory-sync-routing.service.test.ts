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

describe('memorySyncService.buildBundle routing', () => {
  it('routes a differentiated set per recipient (not full broadcast)', async () => {
    mockListForProject.mockResolvedValue([
      conv('m1', 'alpha'),
      conv('m2', 'beta'),
      conv('m3', 'gamma'),
    ])
    mockJudged.mockResolvedValue([]) // all cold-start → relevance decides

    // injected deterministic scorer = the pluggable ranker seam
    const scoreFor = (relevant: string) => (memoryText: string) =>
      memoryText === relevant ? 1 : 0

    const a = await memorySyncService.buildBundle(
      'p',
      { syncedAtIso: 'T', routing: { anchorText: 'recipient-A' } },
      { relevanceScore: scoreFor('alpha') }
    )
    const b = await memorySyncService.buildBundle(
      'p',
      { syncedAtIso: 'T', routing: { anchorText: 'recipient-B' } },
      { relevanceScore: scoreFor('gamma') }
    )

    expect(a.entries.map(e => e.id)).toEqual(['m1'])
    expect(b.entries.map(e => e.id)).toEqual(['m3'])
  })

  it('without routing, returns the full (budget-capped) project set', async () => {
    mockListForProject.mockResolvedValue([
      conv('m1', 'alpha'),
      conv('m2', 'beta'),
    ])
    mockJudged.mockResolvedValue([])
    const all = await memorySyncService.buildBundle('p', { syncedAtIso: 'T' })
    expect(all.entries.map(e => e.id).sort()).toEqual(['m1', 'm2'])
  })

  it('default scorer keeps a memory the anchor text contains', async () => {
    mockListForProject.mockResolvedValue([
      conv('m1', 'alpha widget config'),
      conv('m2', 'zeta'),
    ])
    mockJudged.mockResolvedValue([])
    const out = await memorySyncService.buildBundle('p', {
      syncedAtIso: 'T',
      routing: { anchorText: 'I am working on the alpha widget config today' },
    })
    expect(out.entries.map(e => e.id)).toContain('m1')
  })
})
