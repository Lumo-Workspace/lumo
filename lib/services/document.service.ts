import { clerkClient } from '@clerk/nextjs/server'
import {
  documentRepository,
  type DocumentFilters,
} from '@/lib/repositories/document.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  markdownToHtml,
  tiptapToMarkdown,
  type TiptapNode,
} from '@/lib/utils/markdown-tiptap'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
import { extractDocumentPreview } from '@/lib/utils/document-preview'
import { buildDocumentSlug } from '@/lib/utils/document-slug'
import { contentSummaryService } from '@/lib/services/content-summary.service'
import { documentTemplateService } from '@/lib/services/document-template.service'
import { documentRevisionService } from '@/lib/services/documentRevision.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { getActorClerkId } from '@/lib/actor'
import { buildDocumentUrl } from '@/lib/utils/buildDocumentUrl'
import { htmlToPreview } from '@/lib/utils/htmlToPreview'
import { notifyMentionDelta } from '@/lib/services/mention-notify.service'
import { waitUntil } from '@vercel/functions'
import { DocMentionSource } from '@prisma/client'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateDocumentInput {
  title: string
  emoji?: string | null
  parentId?: string | null
  projectId?: string | null
  visibility: 'WORKSPACE' | 'PRIVATE' | 'SHARED'
  contentMarkdown?: string
  templateId?: string | undefined
  tagIds?: string[]
  // Google Docs import source (LUM-127). Null/absent for native docs.
  googleDocId?: string | null
  googleDocImporterId?: string | null
  googleDocSyncedAt?: Date | null
}

export interface UpdateDocumentInput {
  title?: string
  content?: string | null
  contentMarkdown?: string
  emoji?: string | null
  visibility?: string
  projectId?: string | null
  sortOrder?: number
  publicToken?: string | null
  tags?: string[]
  tagIds?: string[]
  addTagIds?: string[]
  removeTagIds?: string[]
  childOrder?: string[]
  googleDocSyncedAt?: Date | null
  googleDocSyncError?: string | null
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

/**
 * Convert a legacy Tiptap-JSON-string body to HTML for the editor.
 * Newer bodies are already HTML and pass through unchanged.
 */
function renderContentToHtml(
  content: string | null | undefined
): string | null {
  if (typeof content !== 'string' || content.length === 0)
    return content ?? null
  if (!content.trimStart().startsWith('{"type":"doc"')) return content
  try {
    const parsed = JSON.parse(content) as TiptapNode
    return markdownToHtml(tiptapToMarkdown(parsed))
  } catch {
    return content
  }
}

/**
 * Convert a stored document body to readable markdown.
 *
 * New docs are stored as HTML (LUM-83); a small number of legacy docs the
 * pre-fix CLI wrote out as `JSON.stringify(markdownToTiptap(md))` — detect
 * that shape and round-trip through `tiptapToMarkdown` instead of asking
 * turndown to make sense of a JSON literal.
 */
function renderContentToMarkdown(
  content: string | null | undefined
): string | null {
  if (typeof content !== 'string' || content.length === 0) return null
  const trimmed = content.trimStart()
  if (trimmed.startsWith('{"type":"doc"')) {
    try {
      const parsed = JSON.parse(content) as TiptapNode
      return tiptapToMarkdown(parsed)
    } catch {
      // Fall through to HTML path on a parse error — the content isn't
      // valid JSON, so it's almost certainly HTML or already markdown.
    }
  }
  return htmlToMarkdown(content)
}

/** Walk the parent chain with loop prevention. Returns ancestors from root → immediate parent. */
async function findAncestors(parentId: string | null) {
  const ancestors: {
    id: string
    slug: string
    title: string
    emoji: string | null
    children: {
      id: string
      slug: string
      title: string
      emoji: string | null
      _count: { children: number }
    }[]
  }[] = []

  let currentParentId = parentId
  const visitedIds = new Set<string>()

  while (currentParentId && !visitedIds.has(currentParentId)) {
    visitedIds.add(currentParentId)
    const parent =
      await documentRepository.findNodeWithChildren(currentParentId)
    if (!parent) break
    ancestors.unshift({
      id: parent.id,
      slug: parent.slug,
      title: parent.title,
      emoji: parent.emoji,
      children: parent.children,
    })
    currentParentId = parent.parentId
  }

  return ancestors
}

/**
 * Fire-and-forget background generation of a document body summary (LUM-122).
 *
 * Callers pass the body as plain text / markdown (use `renderContentToMarkdown`
 * to convert the stored HTML first). Runs via `waitUntil` so it never blocks the
 * response, and swallows errors so a summarization failure never surfaces. The
 * empty-summary short-circuit (blank body → '' from the summary service) means
 * we skip the write entirely. Exported so the load-time staleness refresh
 * (Task 9) can reuse the exact same scheduling path.
 */
export function scheduleDocumentSummary(docId: string, bodyText: string): void {
  waitUntil(
    contentSummaryService
      .summarize(bodyText, 'document')
      .then(s => (s ? documentRepository.updateSummary(docId, s) : undefined))
      .catch(() => {})
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
      // Strip the full body from the list payload — the board view only
      // needs a short plain-text preview, and content can be large.
      const { content: _content, ...rest } = doc
      const preview = extractDocumentPreview(doc.content)
      return {
        ...rest,
        preview,
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
    const ancestors = await findAncestors(doc.parentId)

    // Use the resolved cuid for downstream lookups — the `id` param may be a
    // slug since `findWithPermission` accepts either form.
    const docTags = await tagRepository.findByDocument(doc.id)

    const creatorUser = userMap.get(doc.createdBy.clerkId)
    // CLI / agent consumers want a readable markdown body — derive it from
    // the stored content so we don't have to bundle turndown into the CLI.
    // New docs store HTML; a handful of docs created via the CLI before
    // LUM-83 stored a JSON-stringified tiptap doc instead — convert both.
    const contentMarkdown = renderContentToMarkdown(doc.content)
    // Same defence on the `content` field for the Tiptap editor: a legacy
    // JSON-string body would be re-parsed as HTML and end up wrapped in
    // <p> on save. Hand the editor HTML in both cases.
    const contentForEditor = renderContentToHtml(doc.content)
    const shaped = {
      ...doc,
      content: contentForEditor,
      contentMarkdown,
      docTags,
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

    // Editor (DescriptionEditor.tsx) consumes content via Tiptap's default
    // string-as-HTML setContent and emits via getHTML(), so the storage
    // format is HTML. Anything else (e.g. a Tiptap JSON-string) gets
    // re-escaped as text and wrapped in <p> on the next render — see LUM-83.
    // Body resolution precedence: explicit contentMarkdown > template > none.
    // Template content is already HTML (same format as Document.content), so
    // it bypasses the markdown→HTML conversion. A template emoji only applies
    // when the caller didn't specify one.
    let content: string | undefined
    let templateEmoji: string | null | undefined
    if (data.contentMarkdown !== undefined) {
      content = markdownToHtml(data.contentMarkdown)
    } else if (data.templateId !== undefined) {
      const template = await documentTemplateService.getTemplateForCreation(
        workspaceId,
        data.templateId
      )
      content = template.content
      templateEmoji = template.emoji
    }

    const document = await documentRepository.create({
      title: data.title,
      emoji: data.emoji ?? templateEmoji ?? null,
      parentId,
      projectId: data.projectId ?? null,
      workspaceId,
      createdById: memberId,
      visibility: data.visibility,
      sortOrder: maxSortOrder + 1,
      googleDocId: data.googleDocId ?? null,
      googleDocImporterId: data.googleDocImporterId ?? null,
      googleDocSyncedAt: data.googleDocSyncedAt ?? null,
      ...(content !== undefined ? { content } : {}),
    })

    if (content) {
      await this.syncDocumentMentions(document.id, content)
      // Body is immutable for this create — summarize once in the background
      // and cache it. Convert the stored HTML to markdown for the LLM.
      const bodyText = renderContentToMarkdown(content)
      if (bodyText) scheduleDocumentSummary(document.id, bodyText)
      // Seed the first version (LUM-227) — the protected baseline.
      waitUntil(
        documentRevisionService
          .snapshotOnSave(document.id, workspaceId, memberId, {
            content,
            title: document.title,
            emoji: document.emoji ?? null,
          })
          .catch(() => {})
      )
    }

    if (data.tagIds && data.tagIds.length > 0) {
      await tagRepository.syncDocumentTags(document.id, data.tagIds)
    }

    // Resolve creator name via Clerk
    const client = await clerkClient()
    const clerkUsers = await client.users.getUserList({
      userId: [document.createdBy.clerkId],
      limit: 1,
    })
    const creatorUser = clerkUsers.data[0]

    // Fetch attached tags so the create response includes them (only when tags were attached)
    const docTags =
      data.tagIds && data.tagIds.length > 0
        ? await tagRepository.findByDocument(document.id)
        : []

    return {
      ...document,
      docTags,
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
    data: UpdateDocumentInput,
    options: { forceNewRevision?: boolean } = {}
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

    // contentMarkdown and content are mutually exclusive
    if (data.content !== undefined && data.contentMarkdown !== undefined) {
      throw Object.assign(
        new Error('content and contentMarkdown are mutually exclusive'),
        { status: 400 }
      )
    }
    if (data.contentMarkdown !== undefined) {
      data.content = markdownToHtml(data.contentMarkdown)
    }

    const updateData: import('@/lib/repositories/document.repository').DocumentUpdateData =
      {}
    if (data.title !== undefined) {
      updateData.title = data.title
      // Regenerate the URL slug from the new title while keeping the
      // workspace-allocated `number` stable.
      updateData.slug = buildDocumentSlug(
        data.title,
        (doc as { number: number }).number
      )
    }
    if (data.content !== undefined) updateData.content = data.content
    if (data.emoji !== undefined) updateData.emoji = data.emoji
    if (data.visibility !== undefined) updateData.visibility = data.visibility
    if (data.projectId !== undefined) updateData.projectId = data.projectId
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder
    if (data.publicToken !== undefined)
      updateData.publicToken = data.publicToken
    if (data.googleDocSyncedAt !== undefined)
      updateData.googleDocSyncedAt = data.googleDocSyncedAt
    if (data.googleDocSyncError !== undefined)
      updateData.googleDocSyncError = data.googleDocSyncError
    if (data.tags !== undefined) updateData.tags = data.tags

    // Downstream calls must use the resolved cuid (`doc.id`), not the raw
    // URL segment, because `findWithPermission` now also accepts a slug.
    const docId = doc.id
    const oldContent = (doc as { content: string | null }).content

    // Sync or incrementally modify tag associations
    if (data.tagIds !== undefined) {
      await tagRepository.syncDocumentTags(docId, data.tagIds)
    } else {
      if (data.addTagIds && data.addTagIds.length > 0) {
        await tagRepository.addDocumentTags(docId, data.addTagIds)
      }
      if (data.removeTagIds && data.removeTagIds.length > 0) {
        await tagRepository.removeDocumentTags(docId, data.removeTagIds)
      }
    }

    const mentionTaskIds = data.content
      ? this.extractTaskMentionIds(data.content)
      : undefined

    const updated = await documentRepository.updateWithChildrenAndMentions(
      docId,
      updateData,
      data.childOrder,
      mentionTaskIds
    )

    // Track editor if content was updated
    if (data.content !== undefined) {
      await documentRepository.upsertEditor(docId, memberId)
      // Body changed — regenerate the cached summary in the background. Convert
      // the new HTML body to markdown for the LLM (handles legacy Tiptap JSON
      // too). A null/empty body short-circuits inside the schedule helper.
      const bodyText = renderContentToMarkdown(data.content)
      if (bodyText) scheduleDocumentSummary(docId, bodyText)
      // Capture a version snapshot in the background (LUM-227). Never blocks
      // the response; snapshotOnSave no-ops when content is unchanged.
      waitUntil(
        documentRevisionService
          .snapshotOnSave(
            docId,
            workspaceId,
            memberId,
            {
              content: data.content,
              title: updated.title,
              emoji: updated.emoji,
            },
            undefined,
            { forceNewRevision: options.forceNewRevision ?? false }
          )
          .catch(() => {})
      )

      // Notify users newly @-mentioned in the document body (delta only).
      // Resolution + send is fully fire-and-forget so a lookup failure never
      // breaks the save (mirrors the snapshotOnSave pattern above).
      const newContent = data.content
      const updatedSlug = updated.slug
      const updatedTitle = updated.title
      waitUntil(
        (async () => {
          const authorActor =
            await memberRepository.findActorByMemberId(memberId)
          const [authorClerkId, ws] = await Promise.all([
            authorActor
              ? getActorClerkId(authorActor.id)
              : Promise.resolve(null),
            workspaceRepository.findNameAndSlug(workspaceId),
          ])
          if (authorActor?.id && authorClerkId && ws?.slug) {
            const docUrl = buildDocumentUrl(ws.slug, updatedSlug)
            await notifyMentionDelta({
              oldHtml: oldContent ?? '',
              newHtml: newContent,
              authorClerkId,
              authorActorId: authorActor.id,
              workspaceId,
              notificationType: 'DOCUMENT_MENTIONED',
              ref: { documentId: docId },
              slackEvent: 'comment_mention',
              slackPayload: {
                taskTitle: updatedTitle,
                taskUrl: docUrl,
                commentBody: htmlToPreview(newContent),
              },
              waitUntil,
            })
          }
        })().catch(() => {})
      )
    }

    // Attach tags to response — only query when tags were actually touched
    const tagsTouched =
      data.tagIds !== undefined ||
      (data.addTagIds && data.addTagIds.length > 0) ||
      (data.removeTagIds && data.removeTagIds.length > 0)

    const docTags = tagsTouched ? await tagRepository.findByDocument(docId) : []

    return { ...updated, docTags }
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

    await documentRepository.deleteWithDescendants(doc.id, workspaceId)
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

  /**
   * Add an explicit doc↔task binding by task identifier (LUM-N) or cuid.
   * Returns metadata about whether it was newly created, idempotent, or upgraded from CONTENT.
   */
  async addExplicitMention(
    documentId: string,
    taskIdentifier: string,
    workspaceId: string,
    memberId: string
  ) {
    const doc = await documentRepository.findWithPermission(
      documentId,
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

    const task = await resolveTask(taskIdentifier, workspaceId)
    if (!task) {
      throw Object.assign(new Error(`Task not found: ${taskIdentifier}`), {
        status: 404,
      })
    }

    const existing = await documentRepository.findMention(doc.id, task.id)
    const row = await documentRepository.addExplicitMention(doc.id, task.id)

    return {
      documentId: doc.id,
      taskId: task.id,
      taskIdentifier: task.identifier,
      source: row.source,
      alreadyBound: existing?.source === 'EXPLICIT',
      upgradedFromContent: existing?.source === 'CONTENT',
    }
  },

  /**
   * Remove an explicit mention. Refuses to remove CONTENT-only rows.
   */
  async removeExplicitMention(
    documentId: string,
    taskIdentifier: string,
    workspaceId: string,
    memberId: string
  ) {
    const doc = await documentRepository.findWithPermission(
      documentId,
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

    const task = await resolveTask(taskIdentifier, workspaceId)
    if (!task) {
      throw Object.assign(new Error(`Task not found: ${taskIdentifier}`), {
        status: 404,
      })
    }

    const existing = await documentRepository.findMention(doc.id, task.id)
    if (existing && existing.source === DocMentionSource.CONTENT) {
      return {
        removed: 0,
        refused: true as const,
        reason:
          'Cannot unbind a content-derived mention; remove the @LUM-N from the doc body instead.',
        taskIdentifier: task.identifier,
      }
    }

    const removed = await documentRepository.removeExplicitMention(
      doc.id,
      task.id
    )
    return { removed, refused: false as const, taskIdentifier: task.identifier }
  },
}

// ── Module-private helpers ───────────────────────────────────────────────────

/** Resolve task by identifier (TEAM-N format e.g. LUM-42) or cuid within a workspace. */
async function resolveTask(input: string, workspaceId: string) {
  const trimmed = input.trim()
  // Check if it looks like a human identifier (TEAM-NUMBER)
  const idx = trimmed.lastIndexOf('-')
  if (idx !== -1) {
    const teamIdentifier = trimmed.slice(0, idx).toUpperCase()
    const number = parseInt(trimmed.slice(idx + 1), 10)
    if (teamIdentifier && !Number.isNaN(number)) {
      const task = await taskRepository.findByWorkspaceIdentifier(
        workspaceId,
        teamIdentifier,
        number
      )
      if (task) {
        return {
          id: task.id,
          identifier: `${task.team.identifier}-${task.number}`,
        }
      }
      return null
    }
  }
  // Fall back to cuid lookup
  const task = await taskRepository.findByIdForMention(trimmed, workspaceId)
  if (!task) return null
  return {
    id: task.id,
    identifier: `${task.team.identifier}-${task.number}`,
  }
}
