import { clerkClient } from '@clerk/nextjs/server'
import { documentRevisionRepository } from '@/lib/repositories/documentRevision.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { documentService } from '@/lib/services/document.service'
import { selectRevisionsToPrune } from '@/lib/services/revision-retention'

const MERGE_WINDOW_MS = 10 * 60 * 1000

export interface SnapshotInput {
  content: string | null
  title: string
  emoji: string | null
}

interface DocWithShares {
  id: string
  createdById: string
  shares: { memberId: string; role: string }[]
}

function assertCanEdit(doc: DocWithShares, memberId: string): void {
  const role = documentService.getUserRole(doc, memberId)
  if (!role || role === 'VIEWER') {
    throw Object.assign(new Error('Permission denied'), { status: 403 })
  }
}

async function loadDocOr404(
  documentId: string,
  memberId: string,
  workspaceId: string
) {
  const doc = await documentRepository.findWithPermission(
    documentId,
    memberId,
    workspaceId
  )
  if (!doc) {
    throw Object.assign(new Error('Document not found'), { status: 404 })
  }
  return doc as DocWithShares & {
    content: string | null
    title: string
    emoji: string | null
  }
}

export const documentRevisionService = {
  async snapshotOnSave(
    documentId: string,
    workspaceId: string,
    authorId: string,
    snapshot: SnapshotInput,
    now: Date = new Date(),
    options: { forceNewRevision?: boolean } = {}
  ): Promise<void> {
    const latest =
      await documentRevisionRepository.findLatestForDocument(documentId)

    if (latest && latest.content === snapshot.content) return

    const withinWindow =
      !options.forceNewRevision &&
      latest != null &&
      !latest.isManual &&
      latest.authorId === authorId &&
      now.getTime() - latest.updatedAt.getTime() <= MERGE_WINDOW_MS

    if (withinWindow && latest) {
      await documentRevisionRepository.updateContent(latest.id, {
        content: snapshot.content,
        title: snapshot.title,
        emoji: snapshot.emoji,
      })
      return
    }

    await documentRevisionRepository.create({
      documentId,
      workspaceId,
      authorId,
      content: snapshot.content,
      title: snapshot.title,
      emoji: snapshot.emoji,
    })
  },

  async createManualSnapshot(
    documentId: string,
    memberId: string,
    workspaceId: string,
    label: string
  ) {
    const doc = await loadDocOr404(documentId, memberId, workspaceId)
    assertCanEdit(doc, memberId)
    return documentRevisionRepository.create({
      documentId: doc.id,
      workspaceId,
      authorId: memberId,
      content: doc.content ?? null,
      title: doc.title,
      emoji: doc.emoji ?? null,
      label,
      isManual: true,
    })
  },

  async listRevisions(
    documentId: string,
    memberId: string,
    workspaceId: string
  ) {
    const doc = await loadDocOr404(documentId, memberId, workspaceId)
    const rows = await documentRevisionRepository.listByDocument(doc.id)

    const clerkIds = [...new Set(rows.map(r => r.author.clerkId))]
    const nameById = new Map<string, { name: string; imageUrl: string | null }>()
    if (clerkIds.length > 0) {
      const client = await clerkClient()
      const users = await client.users.getUserList({
        userId: clerkIds,
        limit: clerkIds.length,
      })
      for (const u of users.data) {
        const name =
          `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ||
          u.emailAddresses[0]?.emailAddress ||
          u.id
        nameById.set(u.id, { name, imageUrl: u.imageUrl ?? null })
      }
    }

    return rows.map(r => ({
      id: r.id,
      label: r.label,
      isManual: r.isManual,
      title: r.title,
      emoji: r.emoji,
      wordCount: r.wordCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      author: {
        id: r.author.id,
        name: nameById.get(r.author.clerkId)?.name ?? r.author.clerkId,
        imageUrl: nameById.get(r.author.clerkId)?.imageUrl ?? null,
      },
    }))
  },

  async getRevision(
    documentId: string,
    revId: string,
    memberId: string,
    workspaceId: string
  ) {
    const doc = await loadDocOr404(documentId, memberId, workspaceId)
    const rev = await documentRevisionRepository.findByIdWithContent(
      revId,
      doc.id
    )
    if (!rev) {
      throw Object.assign(new Error('Revision not found'), { status: 404 })
    }
    return rev
  },

  async restoreRevision(
    documentId: string,
    revId: string,
    memberId: string,
    workspaceId: string
  ) {
    const doc = await loadDocOr404(documentId, memberId, workspaceId)
    assertCanEdit(doc, memberId)
    const rev = await documentRevisionRepository.findByIdWithContent(
      revId,
      doc.id
    )
    if (!rev) {
      throw Object.assign(new Error('Revision not found'), { status: 404 })
    }
    const { documentService: svc } = await import('@/lib/services/document.service')
    return svc.updateDocument(
      doc.id,
      memberId,
      workspaceId,
      { content: rev.content },
      { forceNewRevision: true }
    )
  },

  async pruneRevisions(now: Date = new Date()): Promise<{ deleted: number }> {
    const docIds =
      await documentRevisionRepository.listDocumentIdsWithRevisions()
    let deleted = 0
    for (const docId of docIds) {
      const revs = await documentRevisionRepository.listForPrune(docId)
      const toPrune = selectRevisionsToPrune(revs, now)
      if (toPrune.length > 0) {
        const res = await documentRevisionRepository.deleteByIds(toPrune)
        deleted += res.count
      }
    }
    return { deleted }
  },
}
