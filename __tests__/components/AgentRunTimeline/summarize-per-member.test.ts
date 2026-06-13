import { summarizePerMember } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/summarize-per-member'
import type { AgentRunMemberStat } from '@/app/workspace/[workspaceUrl]/types'

function member(
  id: string,
  name: string,
  totals: number[]
): AgentRunMemberStat {
  return {
    workspaceMemberId: id,
    clerkId: null,
    name,
    imageUrl: '',
    runCount: 1,
    turnCount: 1,
    loopCount: 1,
    byModel: totals.map((t, i) => ({
      model: `m${i}`,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
      total: t,
    })),
  }
}

describe('summarizePerMember', () => {
  it('returns [] for an empty roster', () => {
    expect(summarizePerMember([])).toEqual([])
  })

  it('sums each member byModel totals across models (cross-model total)', () => {
    const rows = summarizePerMember([member('a', 'Ann', [100, 50])])
    expect(rows[0]!.total).toBe(150)
  })

  it('computes each member share of the grand total, preserving input order', () => {
    const rows = summarizePerMember([
      member('a', 'Ann', [80]),
      member('b', 'Bo', [20]),
    ])
    expect(rows.map(r => r.workspaceMemberId)).toEqual(['a', 'b'])
    expect(rows[0]!.pct).toBeCloseTo(0.8)
    expect(rows[1]!.pct).toBeCloseTo(0.2)
  })

  it('yields pct 0 for every row when the grand total is 0 (no divide-by-zero)', () => {
    const rows = summarizePerMember([
      member('a', 'Ann', [0]),
      member('b', 'Bo', [0]),
    ])
    expect(rows.every(r => r.pct === 0)).toBe(true)
  })
})
