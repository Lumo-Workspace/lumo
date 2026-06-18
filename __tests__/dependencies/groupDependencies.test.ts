import {
  groupDependencies,
  computeLiveBlockers,
} from '@/app/workspace/[workspaceUrl]/dependencies/groupDependencies'
import type { DependencyEdge } from '@/app/workspace/[workspaceUrl]/dependencies/types'

const edge = (o: Partial<DependencyEdge>): DependencyEdge => ({
  id: 'e1',
  direction: 'BLOCKED_BY',
  kind: 'BLOCKS',
  source: 'MANUAL',
  status: 'CONFIRMED',
  reason: null,
  detail: null,
  other: { identifier: 'LUM-9', title: 'X', status: 'TODO' },
  ...o,
})

describe('groupDependencies', () => {
  it('splits confirmed edges into blockedBy / blocks / related and collects suggested', () => {
    const edges = [
      edge({ id: 'a', direction: 'BLOCKED_BY', kind: 'BLOCKS' }),
      edge({ id: 'b', direction: 'BLOCKS', kind: 'BLOCKS' }),
      edge({ id: 'c', direction: 'BLOCKED_BY', kind: 'RELATES' }),
      edge({ id: 'd', direction: 'BLOCKS', kind: 'RELATES' }),
      edge({ id: 's', status: 'SUGGESTED' }),
      edge({ id: 'x', status: 'DISMISSED' }),
    ]
    const g = groupDependencies(edges)
    expect(g.blockedBy.map(e => e.id)).toEqual(['a'])
    expect(g.blocks.map(e => e.id)).toEqual(['b'])
    expect(g.related.map(e => e.id).sort()).toEqual(['c', 'd'])
    expect(g.suggested.map(e => e.id)).toEqual(['s'])
  })

  it('excludes DISMISSED edges from every group', () => {
    const g = groupDependencies([edge({ id: 'x', status: 'DISMISSED' })])
    expect([
      ...g.blockedBy,
      ...g.blocks,
      ...g.related,
      ...g.suggested,
    ]).toHaveLength(0)
  })
})

describe('computeLiveBlockers', () => {
  it('returns confirmed BLOCKS blocked-by edges whose blocker is not DONE', () => {
    const live = edge({
      id: 'live',
      other: { identifier: 'LUM-1', title: 'a', status: 'IN_PROGRESS' },
    })
    const done = edge({
      id: 'done',
      other: { identifier: 'LUM-2', title: 'b', status: 'DONE' },
    })
    const suggested = edge({ id: 'sug', status: 'SUGGESTED' })
    const blocks = edge({ id: 'blk', direction: 'BLOCKS' })
    const relates = edge({ id: 'rel', kind: 'RELATES' })
    const result = computeLiveBlockers([live, done, suggested, blocks, relates])
    expect(result.map(e => e.id)).toEqual(['live'])
  })
})
