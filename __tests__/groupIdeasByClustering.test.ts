/**
 * LUM-677: the pure idea-grouping helper. Groups the pool by a run's clustering,
 * dropping empty clusters and bucketing everything the clustering doesn't
 * reference (incl. ideas captured since) into `ungrouped`. Null clustering →
 * null (caller falls back to a flat list).
 */
import { groupIdeasByClustering } from '@/app/workspace/[workspaceUrl]/utils/groupIdeasByClustering'
import type { ApiIdea } from '@/app/workspace/[workspaceUrl]/types'

const idea = (id: string): ApiIdea => ({
  id,
  number: 0,
  identifier: `LUM-I${id}`,
  statement: `idea ${id}`,
  status: 'CAPTURED',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
  createdAt: '2026-07-04T10:00:00.000Z',
  planRunId: null,
  initiative: null,
})

describe('groupIdeasByClustering', () => {
  it('returns null when there is no clustering (flat-list fallback)', () => {
    expect(groupIdeasByClustering([idea('a')], null)).toBeNull()
  })

  it('places each idea under its cluster and the rest in ungrouped', () => {
    const result = groupIdeasByClustering([idea('a'), idea('b'), idea('c')], {
      runId: 'run-1',
      clusters: [
        { name: 'A', ideaIds: ['a'] },
        { name: 'B', ideaIds: ['b'] },
      ],
    })

    expect(result).not.toBeNull()
    expect(result!.clusters.map(c => c.name)).toEqual(['A', 'B'])
    expect(result!.clusters.map(c => c.ideas.map(i => i.id))).toEqual([
      ['a'],
      ['b'],
    ])
    // 'c' is not referenced by the clustering → ungrouped.
    expect(result!.ungrouped.map(i => i.id)).toEqual(['c'])
  })

  it('drops clusters whose ideas are all gone', () => {
    const result = groupIdeasByClustering([idea('a')], {
      runId: 'run-1',
      clusters: [
        { name: 'A', ideaIds: ['a'] },
        { name: 'Empty', ideaIds: ['deleted'] },
      ],
    })

    expect(result!.clusters.map(c => c.name)).toEqual(['A'])
  })

  it('never double-counts an idea listed in two clusters', () => {
    const result = groupIdeasByClustering([idea('a')], {
      runId: 'run-1',
      clusters: [
        { name: 'A', ideaIds: ['a'] },
        { name: 'B', ideaIds: ['a'] },
      ],
    })

    expect(result!.clusters.map(c => c.name)).toEqual(['A'])
    expect(result!.ungrouped).toEqual([])
  })
})
