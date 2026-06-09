/**
 * @jest-environment node
 */
const fragmentTrustForMemories = jest.fn()
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: {
    fragmentTrustForMemories: (...a: unknown[]) =>
      fragmentTrustForMemories(...a),
  },
}))

import { resolveGuardedSupersedeIds } from '@/lib/services/memory/supersede-guard'

beforeEach(() => jest.clearAllMocks())

describe('resolveGuardedSupersedeIds (LUM-325 A-MEM reuse guardrail)', () => {
  it('returns empty without querying when there are no targets', async () => {
    const guarded = await resolveGuardedSupersedeIds([])
    expect(guarded.size).toBe(0)
    expect(fragmentTrustForMemories).not.toHaveBeenCalled()
  })

  it('guards only targets with a strong usage verdict, not presence/none', async () => {
    fragmentTrustForMemories.mockResolvedValue({
      mem_used: { kind: 'usage', resolvedTasks: 5, mergedTasks: 4, pct: 80 },
      mem_coloaded: { kind: 'presence', resolvedTasks: 6, mergedTasks: 3, pct: 50 },
      // mem_fresh has no verdict → omitted from the map entirely
    })

    const guarded = await resolveGuardedSupersedeIds([
      'mem_used',
      'mem_coloaded',
      'mem_fresh',
    ])

    expect(fragmentTrustForMemories).toHaveBeenCalledWith([
      'mem_used',
      'mem_coloaded',
      'mem_fresh',
    ])
    expect([...guarded]).toEqual(['mem_used'])
  })

  it('guards nothing when the trust lookup degrades to empty (best-effort)', async () => {
    fragmentTrustForMemories.mockResolvedValue({})
    const guarded = await resolveGuardedSupersedeIds(['mem_a', 'mem_b'])
    expect(guarded.size).toBe(0)
  })
})
