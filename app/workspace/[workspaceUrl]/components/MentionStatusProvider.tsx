'use client'

import { useCallback, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { mentionStatusClient } from '@/lib/api-client/mention-status'
import {
  MentionStatusContext,
  type MentionStatusLookup,
} from '@/lib/editor/mention-status-context'
import { queryKeys } from '@/lib/query/keys'
import type { MentionStatusItem } from '@/types/mention'

/** Index a status batch by upper-cased identifier, the form the chips look up. */
export function indexMentionStatus(
  items: MentionStatusItem[]
): Map<string, MentionStatusItem> {
  const map = new Map<string, MentionStatusItem>()
  for (const it of items) map.set(it.identifier.toUpperCase(), it)
  return map
}

/**
 * Fetches live status (+ PR) for every task identifier referenced in a doc in a
 * SINGLE batched request, and exposes it to the mention node views via context
 * (LUM-411). The batch is cached by its sorted identifier set (LUM-1340), so
 * two viewers of the same doc share one request. A failed lookup leaves the map
 * empty, so chips degrade to plain text rather than throwing.
 */
export function MentionStatusProvider({
  identifiers,
  children,
}: {
  identifiers: string[]
  children: ReactNode
}) {
  const query = useQuery({
    queryKey: queryKeys.mentionStatus(identifiers),
    queryFn: async () =>
      indexMentionStatus(await mentionStatusClient.fetch(identifiers)),
    enabled: identifiers.length > 0,
  })
  const map = useMemo(
    () => query.data ?? new Map<string, MentionStatusItem>(),
    [query.data]
  )

  const lookup = useCallback<MentionStatusLookup>(
    identifier => map.get(identifier.toUpperCase()),
    [map]
  )

  return (
    <MentionStatusContext.Provider value={lookup}>
      {children}
    </MentionStatusContext.Provider>
  )
}
