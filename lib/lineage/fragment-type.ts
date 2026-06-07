import type { LineageFragmentType } from '@prisma/client'
import type { ContextFragmentType } from '@/lib/services/task-context.service'

/**
 * Map a context-assembly fragment type to its LineageEdge enum value. Returns
 * null for fragment types that have no lineage counterpart (ARTIFACT, DOCUMENT,
 * COMMENT) — those are never edge-recorded, so they get no merge-rate signal.
 * Single source of truth for read (LUM-278) and future edge-birth (LUM-275).
 */
export function toLineageFragmentType(
  t: ContextFragmentType
): LineageFragmentType | null {
  switch (t) {
    case 'MEMORY':
      return 'MEMORY'
    case 'SLACK_CONTEXT':
      return 'SLACK_CONTEXT'
    case 'WEB_LINK':
      return 'WEB_LINK'
    case 'FIGMA_LINK':
      return 'FIGMA'
    case 'PULL_REQUEST':
      return 'PR'
    case 'PR_REVIEW_TODO':
      return 'PR_REVIEW_TODO'
    case 'SESSION':
      return 'SESSION'
    case 'ARTIFACT':
    case 'DOCUMENT':
    case 'COMMENT':
      return null
  }
}
