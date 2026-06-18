import {
  computeFragmentTrust,
  rankFragmentsByUsefulness,
  isRetireCandidate,
  trustKey,
  LINEAGE_MIN_AUDITED_TASKS,
  LINEAGE_PROVEN_USED_TASKS,
} from '@/lib/services/lineage-signal'
import type {
  FragmentRef,
  FragmentJudgedUsage,
} from '@/lib/repositories/lineage-edge.repository'

const ref = (id: string): FragmentRef => ({
  fragmentType: 'MEMORY',
  fragmentId: id,
})
const key = (id: string) => trustKey('MEMORY', id)
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

describe('computeFragmentTrust (judged-used track record)', () => {
  it('emits a judged-used verdict above the cold-start grace', () => {
    const { verdicts } = computeFragmentTrust([ref('a')], {
      judged: [judged('a', 4, 5, 7)],
    })
    expect(verdicts.get(key('a'))).toEqual({
      judgedUsedTasks: 4,
      auditedTasks: 5,
      appearanceTasks: 7,
      usefulnessPct: 80, // 4/5
      qualified: true, // 4 >= LINEAGE_PROVEN_USED_TASKS
    })
  })

  it('marks a verdict not-qualified below the proven-used bar', () => {
    const { verdicts } = computeFragmentTrust([ref('b')], {
      judged: [judged('b', LINEAGE_PROVEN_USED_TASKS - 1, 5, 5)],
    })
    expect(verdicts.get(key('b'))?.qualified).toBe(false)
  })

  it('cold-start grace and abstention is not negative evidence', () => {
    // Below the audited floor → no verdict at all (cold-start grace).
    const cold = computeFragmentTrust([ref('c')], {
      judged: [judged('c', 0, LINEAGE_MIN_AUDITED_TASKS - 1, 9)],
    })
    expect(cold.verdicts.has(key('c'))).toBe(false)

    // Appeared in many tasks but never audited (auditedTasks=0): abstention is
    // not negative evidence — no verdict, and never a retire candidate.
    const neverAudited = computeFragmentTrust([ref('d')], {
      judged: [judged('d', 0, 0, 12)],
    })
    expect(neverAudited.verdicts.has(key('d'))).toBe(false)
    const ranked = rankFragmentsByUsefulness([ref('d')], {
      judged: [judged('d', 0, 0, 12)],
    })
    expect(ranked).toHaveLength(0) // not rankable, not retired
  })

  it('produces no verdict for a fragment with no edge history', () => {
    const res = computeFragmentTrust([ref('e')], { judged: [] })
    expect(res.verdicts.size).toBe(0)
  })

  it('dedupes repeated refs', () => {
    const res = computeFragmentTrust([ref('f'), ref('f')], {
      judged: [judged('f', 3, 4, 4)],
    })
    expect(res.verdicts.size).toBe(1)
  })
})

describe('isRetireCandidate', () => {
  it('flags an audited-but-never-used fragment, spares a partly-used one', () => {
    expect(
      isRetireCandidate({
        judgedUsedTasks: 0,
        auditedTasks: LINEAGE_MIN_AUDITED_TASKS,
        appearanceTasks: 6,
        usefulnessPct: 0,
        qualified: false,
      })
    ).toBe(true)
    expect(
      isRetireCandidate({
        judgedUsedTasks: 1,
        auditedTasks: LINEAGE_MIN_AUDITED_TASKS,
        appearanceTasks: 6,
        usefulnessPct: 33,
        qualified: false,
      })
    ).toBe(false)
  })
})

describe('rankFragmentsByUsefulness', () => {
  it('ranks fragments and flags retire candidates', () => {
    const refs = [ref('proven'), ref('retire'), ref('mid')]
    const stats = {
      judged: [
        judged('proven', 5, 5, 5), // 100% — proven
        judged('retire', 0, 4, 8), // 0% over 4 audits — retire candidate
        judged('mid', 2, 5, 5), // 40%
      ],
    }
    const ranked = rankFragmentsByUsefulness(refs, stats)
    // coldest (lowest usefulness) first
    expect(ranked.map(r => r.fragmentId)).toEqual(['retire', 'mid', 'proven'])
    const byId = Object.fromEntries(ranked.map(r => [r.fragmentId, r]))
    expect(byId.retire?.retireCandidate).toBe(true)
    expect(byId.mid?.retireCandidate).toBe(false)
    expect(byId.proven?.retireCandidate).toBe(false)
    expect(byId.proven?.verdict.qualified).toBe(true)
  })
})
