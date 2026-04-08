import { clerkClient } from '@clerk/nextjs/server'
import {
  documentRepository,
  type DocumentFilters,
} from '@/lib/repositories/document.repository'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateDocumentInput {
  title: string
  emoji?: string | null
  parentId?: string | null
  projectId?: string | null
  visibility: 'WORKSPACE' | 'PRIVATE' | 'SHARED'
}

export interface UpdateDocumentInput {
  title?: string
  content?: string | null
  emoji?: string | null
  visibility?: string
  projectId?: string | null
  sortOrder?: number
  publicToken?: string | null
  tags?: string[]
  childOrder?: string[]
}

interface DocWithShares {
  createdById: string
  shares: { memberId: string; role: string }[]
}

// ── Helpers (private) ───────────────────────────────────────────────────────

function resolveClerkName(
  u:
    | {
        firstName: string | null
        lastName: string | null
        emailAddresses: { emailAddress: string }[]
      }
    | undefined,
  fallback: string
): string {
  if (!u) return fallback
  return (
    `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ||
    u.emailAddresses[0]?.emailAddress ||
    fallback
  )
}

// ── Document Service ────────────────────────────────────────────────────────

export const documentService = {
  /** List documents with permission filtering and Clerk user enrichment. */
  async listDocuments(
    workspaceId: string,
    memberId: string,
    filters?: DocumentFilters
  ) {
    const documents = await documentRepository.findByWorkspace(
      workspaceId,
      memberId,
      filters
    )

    // Batch-fetch Clerk user profiles
    const allClerkIds = new Set<string>()
    for (const doc of documents) {
      allClerkIds.add(doc.createdBy.clerkId)
      for (const s of doc.shares) {
        allClerkIds.add(s.member.clerkId)
      }
      for (const e of doc.editors) {
        allClerkIds.add(e.member.clerkId)
      }
    }

    const client = await clerkClient()
    const clerkUsers =
      allClerkIds.size > 0
        ? await client.users.getUserList({
            userId: [...allClerkIds],
            limit: 100,
          })
        : { data: [] }
    const userMap = new Map(clerkUsers.data.map(u => [u.id, u]))

    return documents.map(doc => {
      const creatorUser = userMap.get(doc.createdBy.clerkId)
      return {
        ...doc,
        createdBy: {
          id: doc.createdBy.id,
          name: resolveClerkName(creatorUser, doc.createdBy.clerkId),
          imageUrl: creatorUser?.imageUrl ?? null,
        },
        shares: doc.shares.map(s => {
          const shareUser = userMap.get(s.member.clerkId)
          return {
            ...s,
            member: {
              id: s.member.id,
              name: resolveClerkName(shareUser, s.member.clerkId),
              imageUrl: shareUser?.imageUrl ?? null,
            },
          }
        }),
        editors: doc.editors.map(e => ({
          member: {
            id: e.member.id,
            name: resolveClerkName(
              userMap.get(e.member.clerkId),
              e.member.clerkId
            ),
            imageUrl: userMap.get(e.member.clerkId)?.imageUrl ?? null,
          },
          lastEditedAt: e.lastEditedAt.toISOString(),
        })),
      }
    })
  },

  /** Get single document with ancestor chain and Clerk enrichment. */
  async getDocument(id: string, memberId: string, workspaceId: string) {
    const doc = await documentRepository.findWithPermission(
      id,
      memberId,
      workspaceId
    )
    if (!doc) {
      throw Object.assign(new Error('Document not found'), { status: 404 })
    }

    // Batch-fetch Clerk user profiles
    const allClerkIds = new Set<string>()
    allClerkIds.add(doc.createdBy.clerkId)
    for (const s of doc.shares) {
      allClerkIds.add(s.member.clerkId)
    }

    const client = await clerkClient()
    const clerkUsers = await client.users.getUserList({
      userId: [...allClerkIds],
      limit: 100,
    })
    const userMap = new Map(clerkUsers.data.map(u => [u.id, u]))

    // Walk ancestor chain
    const ancestors = await documentRepository.findAncestors(doc.parentId)

    const creatorUser = userMap.get(doc.createdBy.clerkId)
    const shaped = {
      ...doc,
      createdBy: {
        id: doc.createdBy.id,
        name: resolveClerkName(creatorUser, doc.createdBy.clerkId),
        imageUrl: creatorUser?.imageUrl ?? null,
      },
      shares: doc.shares.map(s => {
        const shareUser = userMap.get(s.member.clerkId)
        return {
          ...s,
          member: {
            id: s.member.id,
            name: resolveClerkName(shareUser, s.member.clerkId),
            imageUrl: shareUser?.imageUrl ?? null,
          },
        }
      }),
    }

    return { document: shaped, ancestors }
  },

  /** Create a new document with auto sortOrder. */
  async createDocument(
    workspaceId: string,
    memberId: string,
    data: CreateDocumentInput
  ) {
    const parentId = data.parentId ?? null
    const maxSortOrder = await documentRepository.getMaxSortOrder(
      workspaceId,
      parentId
    )

    const document = await documentRepository.create({
      title: data.title,
      emoji: data.emoji ?? null,
      parentId,
      projectId: data.projectId ?? null,
      workspaceId,
      createdById: memberId,
      visibility: data.visibility,
      sortOrder: maxSortOrder + 1,
    })

    // Resolve creator name via Clerk
    const client = await clerkClient()
    const clerkUsers = await client.users.getUserList({
      userId: [document.createdBy.clerkId],
      limit: 1,
    })
    const creatorUser = clerkUsers.data[0]

    return {
      ...document,
      createdBy: {
        id: document.createdBy.id,
        name: resolveClerkName(creatorUser, document.createdBy.clerkId),
        imageUrl: creatorUser?.imageUrl ?? null,
      },
    }
  },

  /** Update document with role-based permission checks. */
  async updateDocument(
    id: string,
    memberId: string,
    workspaceId: string,
    data: UpdateDocumentInput
  ) {
    const doc = await documentRepository.findWithPermission(
      id,
      memberId,
      workspaceId
    )
    if (!doc) {
      throw Object.assign(new Error('Document not found'), { status: 404 })
    }

    const role = this.getUserRole(doc, memberId)
    if (!role || role === 'VIEWER') {
      throw Object.assign(new Error('Permission denied'), { status: 403 })
    }

    // Only owner can change visibility or publicToken
    if (data.visibility && role !== 'OWNER') {
      throw Object.assign(new Error('Only the owner can change visibility'), {
        status: 403,
      })
    }
    if (data.publicToken !== undefined && role !== 'OWNER') {
      throw Object.assign(new Error('Only the owner can change public link'), {
        status: 403,
      })
    }

    const updateData: Record<string, unknown> = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.content !== undefined) updateData.content = data.content
    if (data.emoji !== undefined) updateData.emoji = data.emoji
    if (data.visibility !== undefined) updateData.visibility = data.visibility
    if (data.projectId !== undefined) updateData.projectId = data.projectId
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder
    if (data.publicToken !== undefined)
      updateData.publicToken = data.publicToken
    if (data.tags !== undefined) updateData.tags = data.tags

    const mentionTaskIds = data.content
      ? this.extractTaskMentionIds(data.content)
      : undefined

    const updated = await documentRepository.updateWithChildrenAndMentions(
      id,
      updateData,
      data.childOrder,
      mentionTaskIds
    )

    // Track editor if content was updated
    if (data.content !== undefined) {
      await documentRepository.upsertEditor(id, memberId)
    }

    return updated
  },

  /** Delete document (owner only) with recursive descendant cleanup. */
  async deleteDocument(id: string, memberId: string, workspaceId: string) {
    const doc = await documentRepository.findById(id, workspaceId)
    if (!doc) {
      throw Object.assign(new Error('Document not found'), { status: 404 })
    }
    if (doc.createdById !== memberId) {
      throw Object.assign(new Error('Only the owner can delete a document'), {
        status: 403,
      })
    }

    await documentRepository.deleteWithDescendants(id, workspaceId)
  },

  /** Determine user's role for a document. */
  getUserRole(doc: DocWithShares, memberId: string): string | null {
    if (doc.createdById === memberId) return 'OWNER'
    const share = doc.shares.find(s => s.memberId === memberId)
    if (share) return share.role
    return null
  },

  /** Parse Tiptap JSON content to extract task mention IDs. */
  extractTaskMentionIds(content: unknown): string[] {
    if (!content) return []
    try {
      const json = typeof content === 'string' ? JSON.parse(content) : content
      if (!json || typeof json !== 'object') return []

      const ids: string[] = []
      function walk(node: Record<string, unknown>) {
        if (
          node.type === 'mention' &&
          (node.attrs as Record<string, unknown>)?.mentionType === 'task'
        ) {
          const id = (node.attrs as Record<string, unknown>)?.id
          if (typeof id === 'string') ids.push(id)
        }
        const nodeContent = node.content
        if (Array.isArray(nodeContent)) {
          nodeContent.forEach((child: Record<string, unknown>) => walk(child))
        }
      }
      walk(json)
      return [...new Set(ids)]
    } catch {
      return []
    }
  },

  /** Sync document mentions based on content. Delegates to repository. */
  async syncDocumentMentions(documentId: string, content: unknown) {
    const taskIds = this.extractTaskMentionIds(content)
    await documentRepository.updateWithChildrenAndMentions(
      documentId,
      {},
      undefined,
      taskIds
    )
  },
}
