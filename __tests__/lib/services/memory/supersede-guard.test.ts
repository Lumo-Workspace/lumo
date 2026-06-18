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

  it('guards only targets with a qualified judged-used verdict, not unproven/none', async () => {
    fragmentTrustForMemories.mockResolvedValue({
      mem_used: {
        judgedUsedTasks: 4,
        auditedTasks: 5,
        appearanceTasks: 6,
        usefulnessPct: 80,
        qualified: true,
      },
      mem_coloaded: {
        judgedUsedTasks: 1,
        auditedTasks: 6,
        appearanceTasks: 6,
        usefulnessPct: 17,
        qualified: false,
      },
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
