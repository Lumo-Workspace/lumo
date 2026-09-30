/**
 * LUM-916 — the only place that touches @vercel/blob for the one-off
 * public→private migration (`scripts/migrate-public-blobs.ts`). Kept tiny so
 * the migration service is testable without the SDK.
 */
import { del, get, list, put } from '@vercel/blob'
import { privateBlobToken } from '@/lib/blob/private-store'
import { PUBLIC_BLOB_MARKER } from '@/lib/repositories/public-blob-migration.repository'

/** Every PUBLIC blob under `prefix` in the default (public) store. */
export async function listPublicBlobs(
  prefix: string
): Promise<Array<{ url: string; pathname: string }>> {
  const out: Array<{ url: string; pathname: string }> = []
  let cursor: string | undefined
  do {
    const page = await list({
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

/** Stream a public blob (public store) into the private store, overwriting
 *  a previous copy. */
export async function copyToPrivate(
  publicUrl: string,
  privatePathname: string
): Promise<void> {
  const res = await get(publicUrl, { access: 'public' })
  if (!res || res.statusCode !== 200 || !res.stream) {
    throw new Error(`public blob vanished mid-migration: ${publicUrl}`)
  }
  await put(privatePathname, res.stream, {
    access: 'private',
    token: privateBlobToken(),
    contentType: res.blob.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}

export async function deletePublic(urls: string[]): Promise<void> {
  for (let i = 0; i < urls.length; i += 500) await del(urls.slice(i, i + 500))
}
