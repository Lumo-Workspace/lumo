/**
 * LUM-735 — the only place that touches @vercel/blob for SARIF ingest. Kept
 * tiny so the ingest service is testable without the SDK.
 */
import { del, get } from '@vercel/blob'

/**
 * Bytes of a private blob, or null when it no longer exists (already
 * ingested). `maxBytes` is enforced against the blob's reported size BEFORE
 * the stream is read — a report bigger than the cap is rejected (413) without
 * ever buffering it into memory.
 */
export async function fetchPrivateBlob(
  url: string,
  maxBytes: number
): Promise<Buffer | null> {
  const res = await get(url, { access: 'private', useCache: false })
  if (!res || res.statusCode !== 200 || !res.stream) return null
  if (res.blob.size > maxBytes) {
    throw Object.assign(new Error(`gzip size ${res.blob.size} exceeds cap`), {
      status: 413,
    })
  }
  const arrayBuffer = await new Response(res.stream).arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function deleteBlob(url: string): Promise<void> {
  await del(url)
}
