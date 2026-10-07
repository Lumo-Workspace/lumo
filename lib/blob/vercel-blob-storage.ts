/**
 * LUM-1021 — Vercel Blob backend (the SaaS default). Behaviour is exactly what
 * the per-domain helpers did before the abstraction:
 *
 * - public objects → the default store (`BLOB_READ_WRITE_TOKEN`, implicit);
 * - private objects → the PRIVATE store, token passed explicitly via
 *   `privateBlobToken()` on every call (LUM-916: access is per store, and a
 *   public store rejects `access: 'private'`).
 */
import { del, get, list, put } from '@vercel/blob'
import { privateBlobToken } from '@/lib/blob/private-store'
import {
  blobError,
  type BlobAccess,
  type BlobStorage,
  type ListBlobsPage,
} from '@/lib/blob/types'

/** `{ token }` for the private store, nothing for the public one. */
function storeToken(access: BlobAccess): { token?: string } {
  return access === 'private' ? { token: privateBlobToken() } : {}
}

export function createVercelBlobStorage(): BlobStorage {
  return {
    kind: 'vercel',

    async put(pathname, body, opts) {
      const blob = await put(pathname, body as Parameters<typeof put>[1], {
        access: opts.access,
        ...storeToken(opts.access),
        ...(opts.contentType !== undefined
          ? { contentType: opts.contentType }
          : {}),
        ...(opts.addRandomSuffix !== undefined
          ? { addRandomSuffix: opts.addRandomSuffix }
          : {}),
        ...(opts.allowOverwrite !== undefined
          ? { allowOverwrite: opts.allowOverwrite }
          : {}),
        ...(opts.multipart !== undefined ? { multipart: opts.multipart } : {}),
      })
      return { url: blob.url, pathname: blob.pathname }
    },

    async get(urlOrPathname, access, opts) {
      const res = await get(urlOrPathname, {
        access,
        ...storeToken(access),
        ...(opts?.noCache ? { useCache: false } : {}),
      })
      if (!res || res.statusCode !== 200 || !res.stream) return null
      return {
        stream: res.stream,
        contentType: res.blob.contentType ?? 'application/octet-stream',
        size: res.blob.size,
      }
    },

    async delete(urlsOrPathnames, access) {
      const token = storeToken(access)
      await (token.token ? del(urlsOrPathnames, token) : del(urlsOrPathnames))
    },

    async list({ access, prefix, limit, cursor }): Promise<ListBlobsPage> {
      const page = await list({
        prefix,
        limit: limit ?? 1000,
        ...storeToken(access),
        ...(cursor ? { cursor } : {}),
      })
      return {
        blobs: page.blobs.map(b => ({
          url: b.url,
          pathname: b.pathname,
          uploadedAt: b.uploadedAt,
        })),
        ...(page.hasMore && page.cursor ? { cursor: page.cursor } : {}),
        hasMore: page.hasMore,
      }
    },

    async signedReadUrl() {
      throw blobError(
        'signed read URLs are not supported on Vercel Blob — stream private blobs through an authorising route',
        501
      )
    },
  }
}
