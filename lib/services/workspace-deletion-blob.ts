/**
 * LUM-861 — the only place that touches @vercel/blob for workspace deletion.
 * Kept tiny so the deletion service is testable without the SDK.
 */
import { del, list } from '@vercel/blob'

/**
 * Delete every blob under `prefix`; returns how many were removed. Each round
 * re-lists from the start instead of following a cursor, because the previous
 * round's deletions shift the listing.
 */
export async function deleteBlobsByPrefix(prefix: string): Promise<number> {
  let deleted = 0
  for (;;) {
    const page = await list({ prefix, limit: 1000 })
    const urls = page.blobs.map(b => b.url)
    if (urls.length === 0) return deleted
    await del(urls)
    deleted += urls.length
    if (!page.hasMore) return deleted
  }
}
