'use client'

import type { AgentRunMemoryItem } from '../../types'
import { MemoryCard } from '../memory/MemoryCard'

/**
 * Memory entry inside a TurnCard. Thin wrapper around the shared
 * MemoryCard so the Agent Run timeline matches the spec-section
 * memory list. The "沉淀记忆" header pill stays on (the user is
 * scanning a stream of mixed content here, not a category-grouped
 * list).
 */
export function InlineMemoryCard({ item }: { item: AgentRunMemoryItem }) {
  return <MemoryCard item={item} />
}
