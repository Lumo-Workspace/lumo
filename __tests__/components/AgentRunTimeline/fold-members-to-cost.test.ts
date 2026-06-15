import { foldMembersToCostRows } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/fold-members-to-cost'
import type { AgentRunMemberStat } from '@/app/workspace/[workspaceUrl]/types'

const mem = (
  id: string,
  name: string,
  byModel: {
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
    total: number
  }[]
): AgentRunMemberStat => ({
  workspaceMemberId: id,
  clerkId: id,
  name,
  imageUrl: '',
  runCount: 1,
  loopCount: 0,
  byModel: byModel.map((b, i) => ({ model: `m${i}`, ...b })),
})

describe('foldMembersToCostRows', () => {
  it('sums each member across models into one ModelCost-shaped row keyed by member id', () => {
    const rows = foldMembersToCostRows([
      mem('mA', 'Ada', [
        { input: 10, output: 20, cacheRead: 100, cacheCreation: 5, total: 135 },
        { input: 1, output: 2, cacheRead: 10, cacheCreation: 0, total: 13 },
      ]),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      model: 'mA',
      name: 'Ada',
      input: 11,
      output: 22,
      cacheRead: 110,
      cacheCreation: 5,
      total: 148,
    })
  })

  it('drops members whose total is zero and preserves input order otherwise', () => {
    const rows = foldMembersToCostRows([
      mem('mA', 'Ada', [
        { input: 1, output: 1, cacheRead: 1, cacheCreation: 1, total: 4 },
      ]),
      mem('mZ', 'Zero', [
        { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
      ]),
    ])
    expect(rows.map(r => r.model)).toEqual(['mA'])
  })
})
