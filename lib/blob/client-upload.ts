/**
 * LUM-1021 — browser/CI direct uploads (`@vercel/blob/client` protocol), used
 * by the SARIF push API (LUM-735). The protocol is Vercel Blob's own: the
 * server mints a scoped client token and Vercel calls back on completion. No
 * S3 / disk equivalent exists yet, so on those backends this refuses with 501
 * instead of silently writing somewhere unauthorised.
 */
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { privateBlobToken } from '@/lib/blob/private-store'
import { resolveBlobBackend } from '@/lib/blob/storage'
import { blobError } from '@/lib/blob/types'

export type { HandleUploadBody }

type HandleUploadOptions = Parameters<typeof handleUpload>[0]

/**
 * Run one step of the client-upload handshake for a PRIVATE blob: the token
 * and the completion-webhook verification are pinned to the private store.
 */
export async function handlePrivateClientUpload(
  opts: Omit<HandleUploadOptions, 'token'>
): ReturnType<typeof handleUpload> {
  const backend = resolveBlobBackend()
  if (backend !== 'vercel') {
    throw blobError(
      `direct client uploads need Vercel Blob; this deployment uses ${backend} storage`,
      501
    )
  }
  return handleUpload({ ...opts, token: privateBlobToken() })
}
