import type { DependencyEdge, GroupedDependencies } from './types'
import { isClosedTaskStatus } from '@/lib/task/status-semantics'

export function groupDependencies(
  edges: DependencyEdge[]
): GroupedDependencies {
  const g: GroupedDependencies = {
    blockedBy: [],
    blocks: [],
    related: [],
    duplicateOf: [],
    duplicatedBy: [],
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
    else if (e.kind === 'DUPLICATES')
      (e.direction === 'BLOCKED_BY' ? g.duplicateOf : g.duplicatedBy).push(e)
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
      // LUM-1282: a closed blocker (DONE or CANCELED) no longer blocks.
      !isClosedTaskStatus(e.other.status)
  )
}
