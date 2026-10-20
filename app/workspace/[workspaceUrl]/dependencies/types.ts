// Mirrors server DependencyEdgeView (lib/services/task-dependency.service.ts).
// Defined client-side so we don't import a server module into client code.
export type DependencyDirection = 'BLOCKED_BY' | 'BLOCKS'
export type DependencyKind = 'BLOCKS' | 'RELATES' | 'DUPLICATES'
export type DependencyStatus = 'SUGGESTED' | 'CONFIRMED' | 'DISMISSED'

export interface DependencyEdge {
  id: string
  direction: DependencyDirection
  kind: DependencyKind
  source: 'MANUAL' | 'DETECTED'
  status: DependencyStatus
  reason: string | null
  detail: unknown
  other: { identifier: string; title: string; status: string }
}

export interface GroupedDependencies {
  blockedBy: DependencyEdge[]
  blocks: DependencyEdge[]
  related: DependencyEdge[]
  /** LUM-1282: this task is a canceled duplicate of these. */
  duplicateOf: DependencyEdge[]
  /** LUM-1282: these canceled tasks duplicate this one. */
  duplicatedBy: DependencyEdge[]
  suggested: DependencyEdge[]
}
