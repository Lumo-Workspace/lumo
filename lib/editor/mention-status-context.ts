'use client'

import { createContext, useContext } from 'react'
import type { MentionStatusItem } from '@/types/mention'

/** Resolves a task identifier (`TEAM-N`) to its live status, or undefined when
 *  unknown / not yet loaded. */
export type MentionStatusLookup = (
  identifier: string
) => MentionStatusItem | undefined

/**
 * Carries the batched live-status map down to the mention node views (LUM-411).
 * Default `null` = no provider → mentions degrade to a plain chip (the editor
 * and any viewer without a provider render exactly as before).
 */
export const MentionStatusContext = createContext<MentionStatusLookup | null>(
  null
)

/** Read the live status for one identifier. Safe with no provider (returns
 *  undefined), so a mention node view can call it unconditionally. */
export function useMentionStatus(
  identifier: string | null | undefined
): MentionStatusItem | undefined {
  const lookup = useContext(MentionStatusContext)
  if (!lookup || !identifier) return undefined
  return lookup(identifier)
}
