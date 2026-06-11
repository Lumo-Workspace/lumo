import { apiFetch } from './base'
import type { MentionStatusItem } from '@/types/mention'

export const mentionStatusClient = {
  /** Resolve a batch of `TEAM-N` identifiers to their live status + PR state.
   *  Returns [] for an empty input without hitting the network. */
  async fetch(identifiers: string[]): Promise<MentionStatusItem[]> {
    const ids = identifiers.filter(Boolean)
    if (ids.length === 0) return []
    const params = new URLSearchParams({ ids: ids.join(',') })
    const res = await apiFetch<{ items: MentionStatusItem[] }>(
      `/api/workspaces/mention-status?${params}`
    )
    return res.items
  },
}
