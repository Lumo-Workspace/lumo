/**
 * LUM-858 — workspace export archives. Kept tiny so the export service is
 * testable without a blob backend. Archives are PRIVATE blobs under
 * `workspaces/<id>/exports/`, so the workspace-deletion prefix sweep (LUM-861)
 * removes them with the workspace; they are only ever read back server-side
 * by the OWNER-gated download route. Since LUM-1021 they go through
 * `BlobStorage` (Vercel private store / S3 `private/` / disk `private/`).
 */
import { getBlobStorage } from '@/lib/blob/storage'
import { deleteBlobsByPrefix } from './workspace-deletion-blob'

const MULTIPART_THRESHOLD = 50 * 1024 * 1024

export function exportBlobPrefix(workspaceId: string, exportId: string) {
  return `workspaces/${workspaceId}/exports/${exportId}`
}

export async function putExportArchive(
  workspaceId: string,
  exportId: string,
  bytes: Uint8Array
): Promise<string> {
  const storage = await getBlobStorage()
  const blob = await storage.put(
    `${exportBlobPrefix(workspaceId, exportId)}/workspace-export.zip`,
    Buffer.from(bytes),
    {
      access: 'private',
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
  const storage = await getBlobStorage()
  const res = await storage.get(url, 'private', { noCache: true })
  if (!res) return null
  return { stream: res.stream, size: res.size }
}

/** Remove every blob of one export (idempotent; also clears partial uploads). */
export async function deleteExportArchive(
  workspaceId: string,
  exportId: string
): Promise<number> {
  return deleteBlobsByPrefix(
    `${exportBlobPrefix(workspaceId, exportId)}/`,
    'private'
  )
}
