/**
 * LUM-916 — blob access for the one-off public→private migration
 * (`scripts/migrate-public-blobs.ts`). Kept tiny so the migration service is
 * testable without a blob backend. Since LUM-1021 it runs on `BlobStorage`;
 * the blobs it migrates are pre-LUM-916 PUBLIC Vercel Blobs (recognised by
 * `PUBLIC_BLOB_MARKER`), so on S3 / disk the listing is simply empty.
 */
import { getBlobStorage } from '@/lib/blob/storage'
import { PUBLIC_BLOB_MARKER } from '@/lib/repositories/public-blob-migration.repository'

/** Every PUBLIC blob under `prefix` in the public namespace. */
export async function listPublicBlobs(
  prefix: string
): Promise<Array<{ url: string; pathname: string }>> {
  const storage = await getBlobStorage()
  const out: Array<{ url: string; pathname: string }> = []
  let cursor: string | undefined
  do {
    const page = await storage.list({
      access: 'public',
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    })
    for (const b of page.blobs) {
      if (b.url.includes(PUBLIC_BLOB_MARKER))
        out.push({ url: b.url, pathname: b.pathname })
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}

/** Stream a public blob into the private namespace, overwriting a previous
 *  copy. */
export async function copyToPrivate(
  publicUrl: string,
  privatePathname: string
): Promise<void> {
  const storage = await getBlobStorage()
  const res = await storage.get(publicUrl, 'public')
  if (!res) {
    throw new Error(`public blob vanished mid-migration: ${publicUrl}`)
  }
  await storage.put(privatePathname, res.stream, {
    access: 'private',
    contentType: res.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}

/** Batch-delete public blobs (500 per request). */
export async function deletePublic(urls: string[]): Promise<void> {
  const storage = await getBlobStorage()
  for (let i = 0; i < urls.length; i += 500)
    await storage.delete(urls.slice(i, i + 500), 'public')
}
