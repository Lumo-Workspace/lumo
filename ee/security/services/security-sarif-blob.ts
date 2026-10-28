/**
 * LUM-735 — SARIF report blobs (private). Kept tiny so the ingest service is
 * testable without a blob backend; since LUM-1021 it goes through
 * `BlobStorage`.
 */
import { getBlobStorage } from '@/lib/blob/storage'

export const SARIF_BLOB_PREFIX = 'security-sarif/'

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
  const storage = await getBlobStorage()
  const res = await storage.get(url, 'private', { noCache: true })
  if (!res) return null
  if (res.size > maxBytes) {
    throw Object.assign(new Error(`gzip size ${res.size} exceeds cap`), {
      status: 413,
    })
  }
  const arrayBuffer = await new Response(res.stream).arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * LUM-1321 — store a report the server received in the request body (`lumo
 * review import`), so it enters the same ingest run as a CI push.
 */
export async function putPrivateSarifBlob(
  pathname: string,
  gz: Buffer
): Promise<{ url: string; pathname: string }> {
  const storage = await getBlobStorage()
  const blob = await storage.put(pathname, gz, {
    access: 'private',
    contentType: 'application/gzip',
  })
  return { url: blob.url, pathname: blob.pathname }
}

export async function deleteBlob(url: string): Promise<void> {
  const storage = await getBlobStorage()
  await storage.delete(url, 'private')
}

/**
 * Every SARIF blob currently in the store, with its upload time — the input
 * to the daily orphan sweep (`securitySarifIngestService.pruneStaleBlobs`).
 */
export async function listSarifBlobs(): Promise<
  { url: string; uploadedAt: Date }[]
> {
  const storage = await getBlobStorage()
  const out: { url: string; uploadedAt: Date }[] = []
  let cursor: string | undefined
  do {
    const page = await storage.list({
      access: 'private',
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
