import { apiFetch } from './base'
import type { MentionSearchItem } from '@/types/mention'

export const mentionSearchClient = {
  async search(query: string, limit = 5): Promise<MentionSearchItem[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const res = await apiFetch<{ items: MentionSearchItem[] }>(
      `/api/workspaces/mention-search?${params}`
    )
    return res.items
  },
}
