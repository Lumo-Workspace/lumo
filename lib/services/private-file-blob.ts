/**
 * LUM-916 — private uploads (test evidence, editor images). Since LUM-1021
 * the bytes go through the storage-neutral `BlobStorage` (Vercel private
 * store / S3 `private/` / disk `private/`); this file stays the one place the
 * private-file service touches blobs. Callers load it with a dynamic import
 * where a jsdom test might otherwise pull an SDK in.
 */
import { getBlobStorage } from '@/lib/blob/storage'
import type { OpenedBlob } from '@/lib/blob/types'

export async function putPrivateFile(
  pathname: string,
  body: Blob | Buffer,
  contentType: string
): Promise<void> {
  const storage = await getBlobStorage()
  await storage.put(pathname, body, {
    access: 'private',
    contentType,
    // The pathname already ends in a CSPRNG id; a suffix would change it
    // and break the URL we hand back.
    addRandomSuffix: false,
  })
}

export type OpenedFile = OpenedBlob

/** A private blob's bytes, or null when it does not exist. */
export async function openPrivateFile(
  pathname: string
): Promise<OpenedFile | null> {
  const storage = await getBlobStorage()
  return storage.get(pathname, 'private')
}
