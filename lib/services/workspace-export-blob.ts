/**
 * LUM-858 — the only place that touches @vercel/blob for workspace exports.
 * Kept tiny so the export service is testable without the SDK. Archives are
 * PRIVATE blobs under `workspaces/<id>/exports/`, so the workspace-deletion
 * prefix sweep (LUM-861) removes them with the workspace; they are only ever
 * read back server-side by the OWNER-gated download route.
 */
import { get, put } from '@vercel/blob'
import { deleteBlobsByPrefix } from './workspace-deletion-blob'
import { privateBlobToken } from '@/lib/blob/private-store'

const MULTIPART_THRESHOLD = 50 * 1024 * 1024

export function exportBlobPrefix(workspaceId: string, exportId: string) {
  return `workspaces/${workspaceId}/exports/${exportId}`
}

export async function putExportArchive(
  workspaceId: string,
  exportId: string,
  bytes: Uint8Array
): Promise<string> {
  const blob = await put(
    `${exportBlobPrefix(workspaceId, exportId)}/workspace-export.zip`,
    Buffer.from(bytes),
    {
      access: 'private',
      token: privateBlobToken(),
      contentType: 'application/zip',
      addRandomSuffix: true,
      // Large workspaces: upload in parts instead of one request body.
      multipart: bytes.length > MULTIPART_THRESHOLD,
    }
  )
  return blob.url
}

/** The archive's byte stream, or null when the blob no longer exists. */
export async function openExportArchive(
  url: string
): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  const res = await get(url, {
    access: 'private',
    token: privateBlobToken(),
    useCache: false,
  })
  if (!res || res.statusCode !== 200 || !res.stream) return null
  return { stream: res.stream, size: res.blob.size }
}

/** Remove every blob of one export (idempotent; also clears partial uploads). */
export async function deleteExportArchive(
  workspaceId: string,
  exportId: string
): Promise<number> {
  return deleteBlobsByPrefix(
    `${exportBlobPrefix(workspaceId, exportId)}/`,
    privateBlobToken()
  )
}
