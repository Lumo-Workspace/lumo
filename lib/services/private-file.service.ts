import { randomUUID } from 'node:crypto'
import { privateFileRepository } from '@/lib/repositories/private-file.repository'
import {
  evidencePathname,
  feedbackEvidencePathname,
  fileRouteUrl,
  imagePathname,
  milestoneEvidencePathname,
  pathnameOf,
  referencedImagePathnames,
  type PrivateFile,
} from '@/lib/files/private-file-path'
import { logger } from '@/lib/logger'

/**
 * LUM-916 — private uploads (test evidence, editor images).
 *
 * Writes go to private blobs; reads go through `GET /api/files/...`, which
 * asks `canRead` whether the viewer's workspace owns the file. The blob SDK
 * is loaded on use: @vercel/blob pulls in undici, which breaks jsdom tests
 * that merely import a service.
 */

async function blob() {
  return import('@/lib/services/private-file-blob')
}

async function store(
  pathname: string,
  file: File,
  origin: string
): Promise<string> {
  const { putPrivateFile } = await blob()
  await putPrivateFile(pathname, file, file.type)
  return fileRouteUrl(origin, pathname)
}

export const privateFileService = {
  /** Store one evidence file; returns the file-route URL to persist. */
  async storeEvidence(
    taskId: string,
    caseId: string,
    file: File,
    origin: string
  ): Promise<string> {
    return store(evidencePathname(taskId, caseId, randomUUID()), file, origin)
  },

  /** LUM-1135: store one milestone test-case evidence file. */
  async storeMilestoneEvidence(
    milestoneId: string,
    caseId: string,
    file: File,
    origin: string
  ): Promise<string> {
    return store(
      milestoneEvidencePathname(milestoneId, caseId, randomUUID()),
      file,
      origin
    )
  },

  /** Store one editor image under the workspace's prefix (never a
   *  client-chosen folder); returns the file-route URL to embed. */
  async storeImage(
    workspaceId: string,
    file: File,
    origin: string
  ): Promise<string> {
    return store(imagePathname(workspaceId, randomUUID()), file, origin)
  },

  /**
   * LUM-1343: store an image copied from an imported document under the
   * same workspace image prefix the editor uses. `fileId` is chosen by the
   * caller from the source's own image id, so a re-sync finds the copy it
   * made last time and skips it instead of piling up duplicates. Returns the
   * file-route URL to embed.
   */
  async storeImportedImage(
    workspaceId: string,
    fileId: string,
    load: () => Promise<{ body: Buffer; contentType: string }>,
    origin: string
  ): Promise<string> {
    const pathname = imagePathname(workspaceId, fileId)
    const url = fileRouteUrl(origin, pathname)
    const { putPrivateFile, openPrivateFile } = await blob()
    const existing = await openPrivateFile(pathname)
    if (existing) {
      await existing.stream.cancel().catch(() => undefined)
      return url
    }
    const { body, contentType } = await load()
    try {
      await putPrivateFile(pathname, body, contentType)
    } catch (error) {
      // A concurrent import of the same doc may have written it first.
      const raced = await openPrivateFile(pathname)
      if (!raced) throw error
      await raced.stream.cancel().catch(() => undefined)
    }
    return url
  },

  /**
   * LUM-1240: store one feedback evidence file under the submitting
   * workspace's folder (`fileId` is server-chosen). `body` may be the
   * redacted bytes of a text file. Returns the pathname and file-route URL.
   */
  async storeFeedbackEvidence(
    workspaceId: string,
    body: Blob | Buffer,
    contentType: string,
    origin: string
  ): Promise<{ pathname: string; url: string }> {
    const pathname = feedbackEvidencePathname(workspaceId, randomUUID())
    const { putPrivateFile } = await blob()
    await putPrivateFile(pathname, body, contentType)
    return { pathname, url: fileRouteUrl(origin, pathname) }
  },

  /**
   * LUM-1240: best-effort delete of blobs written for a feedback whose row
   * was then not created. Logged and swallowed — never masks the real error.
   */
  async deletePrivatePathnames(pathnames: readonly string[]): Promise<void> {
    if (pathnames.length === 0) return
    try {
      const { getBlobStorage } = await import('@/lib/blob/storage')
      const storage = await getBlobStorage()
      await storage.delete([...pathnames], 'private')
    } catch (error) {
      logger.warn('[private-file] orphan cleanup failed', {
        count: pathnames.length,
        error: (error as Error).message,
      })
    }
  },

  /**
   * May this request read `file`? Either path is enough:
   *
   * - `viewerWorkspaceId` (a signed-in member or API key): their workspace
   *   owns the file.
   * - `shareToken` (anyone, signed in or not): an image referenced by the
   *   body of a publicly shared document in the owning workspace.
   *
   * A "no" never says whether the file exists — the route answers 404.
   */
  async canRead(
    file: PrivateFile,
    access: { viewerWorkspaceId: string | null; shareToken: string | null }
  ): Promise<boolean> {
    const owner =
      file.kind === 'image' || file.kind === 'feedback-evidence'
        ? file.workspaceId
        : file.kind === 'milestone-evidence'
          ? await privateFileRepository.findMilestoneWorkspaceId(
              file.milestoneId
            )
          : await privateFileRepository.findTaskWorkspaceId(file.taskId)
    if (!owner) return false
    if (access.viewerWorkspaceId === owner) return true
    if (file.kind !== 'image' || !access.shareToken) return false

    const doc = await privateFileRepository.findSharedDocument(
      access.shareToken
    )
    if (!doc || doc.workspaceId !== owner) return false
    const refs = referencedImagePathnames(
      `${doc.content ?? ''}\n${doc.sourceMarkdown ?? ''}`
    )
    return refs.has(pathnameOf(file))
  },

  /** Open a file the caller has already authorised. */
  async open(file: PrivateFile) {
    const { openPrivateFile } = await blob()
    return openPrivateFile(pathnameOf(file))
  },

  /**
   * Delete the evidence blobs of tasks that were just deleted. Best-effort:
   * the rows are already gone, so a failure is logged and swallowed — it must
   * never turn a successful delete into an error.
   */
  async deleteTaskEvidence(taskIds: readonly string[]): Promise<void> {
    if (taskIds.length === 0) return
    try {
      const { deleteBlobsByPrefixInBothStores } =
        await import('@/lib/services/workspace-deletion-blob')
      // Both stores: pre-LUM-916 evidence is still in the public one.
      for (const id of taskIds)
        await deleteBlobsByPrefixInBothStores(`test-evidence/${id}/`)
    } catch (error) {
      logger.warn('[private-file] task evidence cleanup failed', {
        taskIds,
        error: (error as Error).message,
      })
    }
  },
  /** LUM-1135: best-effort sweep of deleted milestones' evidence (mirrors deleteTaskEvidence). */
  async deleteMilestoneEvidence(
    milestoneIds: readonly string[]
  ): Promise<void> {
    if (milestoneIds.length === 0) return
    try {
      const { deleteBlobsByPrefixInBothStores } =
        await import('@/lib/services/workspace-deletion-blob')
      for (const id of milestoneIds)
        await deleteBlobsByPrefixInBothStores(`milestone-evidence/${id}/`)
    } catch (error) {
      logger.warn('[private-file] milestone evidence cleanup failed', {
        milestoneIds,
        error: (error as Error).message,
      })
    }
  },
}
