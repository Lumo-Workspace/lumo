/**
 * LUM-861 — blob sweeps for workspace deletion. Since LUM-1021 they run on
 * any `BlobStorage` backend (Vercel stores / S3 namespaces / disk dirs).
 */
import { getBlobStorage } from '@/lib/blob/storage'
import { deleteAllByPrefix, type BlobAccess } from '@/lib/blob/types'

/**
 * Delete every blob under `prefix` in one namespace; returns how many were
 * removed. Each round re-lists from the start instead of following a cursor,
 * because the previous round's deletions shift the listing.
 *
 * `access` picks the namespace: `'public'` = the default (public) store,
 * `'private'` = the private one (LUM-916).
 */
export async function deleteBlobsByPrefix(
  prefix: string,
  access: BlobAccess = 'public'
): Promise<number> {
  return deleteAllByPrefix(await getBlobStorage(), prefix, access)
}

/**
 * LUM-916: the same prefix can hold blobs in both namespaces — pre-LUM-916
 * public evidence/logos in the public store, private evidence/images/exports
 * in the private one. Sweep both; returns the total removed.
 */
export async function deleteBlobsByPrefixInBothStores(
  prefix: string
): Promise<number> {
  const inPublic = await deleteBlobsByPrefix(prefix, 'public')
  return inPublic + (await deleteBlobsByPrefix(prefix, 'private'))
}
