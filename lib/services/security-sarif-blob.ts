/**
 * LUM-735 — the only place that touches @vercel/blob for SARIF ingest. Kept
 * tiny so the ingest service is testable without the SDK.
 */
import { del, get, list } from '@vercel/blob'

export const SARIF_BLOB_PREFIX = 'security-sarif/'

/** Bytes of a private blob, or null when it no longer exists (already ingested). */
export async function fetchPrivateBlob(url: string): Promise<Buffer | null> {
  const res = await get(url, { access: 'private', useCache: false })
  if (!res || res.statusCode !== 200 || !res.stream) return null
  const arrayBuffer = await new Response(res.stream).arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function deleteBlob(url: string): Promise<void> {
  await del(url)
}

export async function listSarifBlobs(): Promise<
  { url: string; uploadedAt: Date }[]
> {
  const out: { url: string; uploadedAt: Date }[] = []
  let cursor: string | undefined
  do {
    const page = await list({
      prefix: SARIF_BLOB_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    })
    for (const b of page.blobs)
      out.push({ url: b.url, uploadedAt: b.uploadedAt })
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}
