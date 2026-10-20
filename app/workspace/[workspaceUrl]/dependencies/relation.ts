import type { DependencyDirection, DependencyKind } from './types'

export type Relation = 'BLOCKED_BY' | 'BLOCKS' | 'RELATES'

/**
 * 把一维关系映射回现有 API 契约。RELATES 是无向的 —— direction 字段
 * 被服务端与 groupDependencies 忽略,固定传 BLOCKED_BY 仅为满足类型。
 */
export function relationToEdge(relation: Relation): {
  // LUM-1282: DUPLICATES is written only by a cancel, never added here.
  kind: Exclude<DependencyKind, 'DUPLICATES'>
  direction: DependencyDirection
} {
  switch (relation) {
    case 'BLOCKED_BY':
      return { kind: 'BLOCKS', direction: 'BLOCKED_BY' }
    case 'BLOCKS':
      return { kind: 'BLOCKS', direction: 'BLOCKS' }
    case 'RELATES':
      return { kind: 'RELATES', direction: 'BLOCKED_BY' }
  }
}
