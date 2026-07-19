/**
 * LUM-685: a confirmed cluster has no id — it's identified by its POSITION in
 * the clustering. Stage-2 mints `cluster-<i>` from that index and the ALIGN
 * verdicts echo it back, so this round-trip is the only link from a gate-B
 * verdict to the cluster it judged. If mint/parse ever disagree, gate B goes
 * anonymous again.
 */
import {
  clusterIdForIndex,
  clusterIndexFromId,
} from '@/lib/plan-run/cluster-gate'

describe('clusterIdForIndex / clusterIndexFromId', () => {
  it('round-trips every index back to itself', () => {
    for (const i of [0, 1, 2, 9, 10, 137]) {
      expect(clusterIndexFromId(clusterIdForIndex(i))).toBe(i)
    }
  })

  it('mints the positional id Stage-2 echoes to the align LLM', () => {
    expect(clusterIdForIndex(0)).toBe('cluster-0')
    expect(clusterIdForIndex(3)).toBe('cluster-3')
  })

  it('returns null for ids we did not mint, rather than a wrong index', () => {
    // An LLM that garbles the echo, or a future id scheme, must degrade the
    // card's label — never silently resolve to the wrong cluster.
    expect(clusterIndexFromId('c-1')).toBeNull()
    expect(clusterIndexFromId('cluster-')).toBeNull()
    expect(clusterIndexFromId('cluster-abc')).toBeNull()
    expect(clusterIndexFromId('cluster--1')).toBeNull()
    expect(clusterIndexFromId('cluster-1.5')).toBeNull()
    expect(clusterIndexFromId('cluster-+1')).toBeNull()
    expect(clusterIndexFromId('cluster-01')).toBeNull() // not canonical
    expect(clusterIndexFromId('cluster- 1')).toBeNull()
    expect(clusterIndexFromId('')).toBeNull()
  })

  it('does not treat a numeric-looking suffix as an index by coercion', () => {
    // Number('') === 0 and Number(' 1') === 1 — the regex guard exists so these
    // can't resolve to a real cluster.
    expect(clusterIndexFromId('cluster-')).not.toBe(0)
  })
})
