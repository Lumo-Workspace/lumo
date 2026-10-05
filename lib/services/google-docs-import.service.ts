import { parseGoogleDocId } from '@/lib/integrations/google-drive/parse-url'
import { getClientForMember } from '@/lib/services/google-drive-integration.service'
import { documentService } from '@/lib/services/document.service'
import { documentRepository } from '@/lib/repositories/document.repository'

export const googleDocsImportService = {
  /**
   * Import a Google Doc as a new Lumo Document, recording the acting member as
   * the importer (owner) whose token future syncs reuse. Access is enforced by
   * Google at fetch time via the acting member's token.
   */
  async importGoogleDoc(
    workspaceId: string,
    memberId: string,
    input: { url: string; visibility?: 'PRIVATE' | 'WORKSPACE' | 'SHARED' }
  ) {
    const fileId = parseGoogleDocId(input.url)
    if (!fileId) {
      throw Object.assign(new Error('Not a valid Google Doc URL or id'), {
        status: 400,
      })
    }

    const client = await getClientForMember(workspaceId, memberId)
    const meta = await client.getMetadata(fileId)
    const markdown = await client.exportMarkdown(fileId)

    return documentService.createDocument(workspaceId, memberId, {
      title: meta.name || 'Untitled',
      visibility: input.visibility ?? 'PRIVATE',
      contentMarkdown: markdown,
      googleDocId: fileId,
      googleDocImporterId: memberId,
      googleDocSyncedAt: new Date(),
    })
  },

  /**
   * Re-sync an imported doc: re-export from Google using the IMPORTER's token
   * (owner model) and overwrite the Lumo body. One-way, destructive to local
   * edits by design.
   */
  async resyncGoogleDoc(
    workspaceId: string,
    _actingMemberId: string,
    docId: string
  ) {
    const meta = await documentRepository.findSourceMeta(docId, workspaceId)
    if (!meta || !meta.googleDocId || !meta.googleDocImporterId) {
      throw Object.assign(new Error('Not a Google-imported document'), {
        status: 400,
      })
    }

    const importerId = meta.googleDocImporterId
    try {
      const client = await getClientForMember(workspaceId, importerId)
      const markdown = await client.exportMarkdown(meta.googleDocId)
      // updateDocument runs as the importer so the OWNER permission check passes
      // (the importer is the doc creator). syncedAt set, prior error cleared.
      const updated = await documentService.updateDocument(
        docId,
        importerId,
        workspaceId,
        {
          contentMarkdown: markdown,
          // The Google Doc is the authority and resync mirrors it verbatim —
          // a table the human deleted upstream must disappear here too, so
          // the structure guard (LUM-410) never blocks this path.
          allowShrink: true,
          googleDocSyncedAt: new Date(),
          googleDocSyncError: null,
        }
      )
      return updated
    } catch (e) {
      const msg = (e as Error).message.slice(0, 240)
      await documentRepository.update(docId, workspaceId, {
        googleDocSyncError: msg,
      })
      throw e
    }
  },
}
