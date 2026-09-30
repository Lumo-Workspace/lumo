/**
 * LUM-861 — the only place that touches @vercel/blob for workspace deletion.
 * Kept tiny so the deletion service is testable without the SDK.
 */
import { del, list } from '@vercel/blob'
import { privateBlobToken } from '@/lib/blob/private-store'

/**
 * Delete every blob under `prefix`; returns how many were removed. Each round
 * re-lists from the start instead of following a cursor, because the previous
 * round's deletions shift the listing.
 *
 * `token` picks the store: omitted = the default (public) store; pass
 * `privateBlobToken()` for the private one (LUM-916).
 */
export async function deleteBlobsByPrefix(
  prefix: string,
  token?: string
): Promise<number> {
  let deleted = 0
  for (;;) {
    const page = await list(
      token ? { prefix, limit: 1000, token } : { prefix, limit: 1000 }
    )
    const urls = page.blobs.map(b => b.url)
    if (urls.length === 0) return deleted
    await (token ? del(urls, { token }) : del(urls))
    deleted += urls.length
    if (!page.hasMore) return deleted
  }
}

/**
 * LUM-916: the same prefix can hold blobs in both stores — pre-LUM-916 public
 * evidence/logos in the public store, private evidence/images/exports in the
 * private one. Sweep both; returns the total removed.
 */
export async function deleteBlobsByPrefixInBothStores(
  prefix: string
): Promise<number> {
  const inPublic = await deleteBlobsByPrefix(prefix)
  return inPublic + (await deleteBlobsByPrefix(prefix, privateBlobToken()))
}
