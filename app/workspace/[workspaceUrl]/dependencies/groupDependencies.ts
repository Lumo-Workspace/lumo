import type { DependencyEdge, GroupedDependencies } from './types'

export function groupDependencies(
  edges: DependencyEdge[]
): GroupedDependencies {
  const g: GroupedDependencies = {
    blockedBy: [],
    blocks: [],
    related: [],
    suggested: [],
  }
  for (const e of edges) {
    if (e.status === 'DISMISSED') continue
    if (e.status === 'SUGGESTED') {
      g.suggested.push(e)
      continue
    }
    // CONFIRMED
    if (e.kind === 'RELATES') g.related.push(e)
    else if (e.direction === 'BLOCKED_BY') g.blockedBy.push(e)
    else g.blocks.push(e)
  }
  return g
}

export function computeLiveBlockers(edges: DependencyEdge[]): DependencyEdge[] {
  return edges.filter(
    e =>
      e.direction === 'BLOCKED_BY' &&
      e.kind === 'BLOCKS' &&
      e.status === 'CONFIRMED' &&
      e.other.status !== 'DONE'
  )
}
