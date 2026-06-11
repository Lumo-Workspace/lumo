'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { mentionStatusClient } from '@/lib/api-client/mention-status'
import {
  MentionStatusContext,
  type MentionStatusLookup,
} from '@/lib/editor/mention-status-context'
import type { MentionStatusItem } from '@/types/mention'

/**
 * Fetches live status (+ PR) for every task identifier referenced in a doc in a
 * SINGLE batched request, and exposes it to the mention node views via context
 * (LUM-411). A failed lookup leaves the map empty, so chips degrade to plain
 * text rather than throwing.
 */
export function MentionStatusProvider({
  identifiers,
  children,
}: {
  identifiers: string[]
  children: ReactNode
}) {
  const [map, setMap] = useState<Map<string, MentionStatusItem>>(
    () => new Map()
  )
  // Stable dependency: refetch only when the set of identifiers actually changes.
  const key = identifiers.join(',')

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setMap(new Map())
      return
    }
    let cancelled = false
    mentionStatusClient
      .fetch(ids)
      .then(items => {
        if (cancelled) return
        const next = new Map<string, MentionStatusItem>()
        for (const it of items) next.set(it.identifier.toUpperCase(), it)
        setMap(next)
      })
      .catch(() => {
        if (!cancelled) setMap(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [key])

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
