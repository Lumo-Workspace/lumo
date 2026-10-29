import { listUsersByIds } from '@/lib/auth/user-batch'
import { getUserDirectory } from '@/lib/auth/users'
import {
  documentRepository,
  type DocumentFilters,
} from '@/lib/repositories/document.repository'
import { trashService } from '@/lib/services/trash.service'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  markdownToHtml,
  tiptapToMarkdown,
  type TiptapNode,
} from '@/lib/utils/markdown-tiptap'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
import { rebuildSourceMarkdown } from '@/lib/utils/doc-structure-to-markdown'
import {
  appendToSection,
  extractSection,
  findSection,
  replaceSection,
  type MarkdownSection,
} from '@/lib/utils/markdown-sections'
import { assertNoStructureShrink } from '@/lib/services/document-structure-guard'
import { extractDocumentPreview } from '@/lib/utils/document-preview'
import { buildDocumentSlug } from '@/lib/utils/document-slug'
import { contentSummaryService } from '@/lib/services/content-summary.service'
import { documentTemplateService } from '@/lib/services/document-template.service'
import { documentRevisionService } from '@/lib/services/documentRevision.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { getActorClerkId } from '@/lib/actor'
import { buildDocumentUrl } from '@/lib/utils/buildDocumentUrl'
import { notifyMentionDelta } from '@/lib/services/mention-notify.service'
import { waitUntil } from '@/lib/runtime/wait-until'
import { DocMentionSource } from '@prisma/client'
import { logger } from '@/lib/logger'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

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
  /**
   * Optimistic-concurrency precondition (LUM-409): the contentRevision the
   * caller's edit base was read at. Mismatch → 409, nothing persisted.
   */
  ifRevision?: number
  /**
   * Structure guard override (LUM-410): lets a markdown body update through
   * even when it drops tables/rows/headings versus the stored body. Without
   * it a shrinking update is rejected with 422.
   */
  allowShrink?: boolean
}

export interface SectionEditInput {
  /** 'replace' swaps the whole section (heading included); 'append' inserts at section end. */
  mode: 'replace' | 'append'
  /** Heading text addressing the section. Required for replace; append without it targets the document end. */
  section?: string | undefined
  contentMarkdown: string
  ifRevision?: number | undefined
  /** Structure guard override (LUM-410) — see UpdateDocumentInput.allowShrink. */
  allowShrink?: boolean | undefined
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
async function findAncestors(parentId: string | null, workspaceId: string) {
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
    const parent = await documentRepository.findNodeWithChildren(
      currentParentId,
      workspaceId
    )
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
export function scheduleDocumentSummary(
  docId: string,
  workspaceId: string,
  bodyText: string
): void {
  waitUntil(
    contentSummaryService
      .summarize(bodyText, 'document', { workspaceId })
      .then(s =>
        s ? documentRepository.updateSummary(docId, workspaceId, s) : undefined
      )
      .catch(() => {})
  )
}

function headingLabel(s: MarkdownSection): string {
  return `${'#'.repeat(s.depth)} ${s.heading}`
}

/**
 * 409 with both revision numbers in the message (LUM-409). The agent-facing
 * contract: a conflict is always recoverable by re-reading and retrying —
 * never a silent overwrite.
 */
function revisionConflict(
  expected: number | undefined,
  current: number | undefined
): Error {
  const detail =
    current !== undefined
      ? ` (current revision: ${current}${expected !== undefined ? `, your base: ${expected}` : ''})`
      : ''
  return Object.assign(
    new Error(
      `Revision conflict: the document body changed since your copy was read${detail}. ` +
        `Re-read it (lumo doc show) and retry with the current revision.`
    ),
    { status: 409 }
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

    const client = await getUserDirectory()
    const clerkUsers = await listUsersByIds(client, [...allClerkIds])
    const userMap = new Map(clerkUsers.map(u => [u.id, u]))

    return documents.map(doc => {
      const creatorUser = userMap.get(doc.createdBy.clerkId)
      // Strip the full body from the list payload — the board view only
      // needs a short plain-text preview, and content can be large. The
      // markdown source (LUM-408) is equally large and list views never
      // need it either.
      const {
        content: _content,
        sourceMarkdown: _sourceMarkdown,
        ...rest
      } = doc
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

    const client = await getUserDirectory()
    const clerkUsers = await listUsersByIds(client, [...allClerkIds])
    const userMap = new Map(clerkUsers.map(u => [u.id, u]))

    // Walk ancestor chain
    const ancestors = await findAncestors(doc.parentId, workspaceId)

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

  /**
   * Create a new document with auto sortOrder.
   *
   * Caller-supplied references are validated against the caller's workspace
   * (LUM-993) before anything is written:
   * - `parentId` must pass the same rule LUM-990 applies to a move target —
   *   a document the member may EDIT in their own workspace (`findEditable`:
   *   owner, WORKSPACE visibility, or EDITOR/MANAGER share). A foreign,
   *   invisible or view-only parent all get the same generic 404 as a missing
   *   document, so the response says nothing about another tenant's ids.
   * - `projectId` must be a project in the caller's workspace (else 404).
   * Every caller goes through this — the API route, Google Doc import (which
   * passes neither id) and the service tests; there is no unchecked path.
   */
  async createDocument(
    workspaceId: string,
    memberId: string,
    data: CreateDocumentInput
  ) {
    let parentId: string | null = null
    if (data.parentId) {
      const parent = await documentRepository.findEditable(
        data.parentId,
        memberId,
        workspaceId
      )
      if (!parent) {
        throw Object.assign(new Error('Not found or no permission'), {
          status: 404,
        })
      }
      parentId = parent.id
    }
    if (data.projectId) {
      const project = await projectRepository.findIdInWorkspace(
        data.projectId,
        workspaceId
      )
      if (!project) {
        throw Object.assign(new Error('Project not found'), { status: 404 })
      }
    }
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
    // Double-write the byte-identical markdown source next to the rendered
    // HTML (LUM-408) so reads never depend on the lossy HTML→md reverse
    // render. Template bodies are already HTML, so they leave it null.
    let sourceMarkdown: string | undefined
    let templateEmoji: string | null | undefined
    if (data.contentMarkdown !== undefined) {
      content = markdownToHtml(data.contentMarkdown)
      sourceMarkdown = data.contentMarkdown
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
      ...(sourceMarkdown !== undefined ? { sourceMarkdown } : {}),
    })

    if (content) {
      await this.syncDocumentMentions(document.id, workspaceId, content)
      // Body is immutable for this create — summarize once in the background
      // and cache it. Convert the stored HTML to markdown for the LLM.
      const bodyText = renderContentToMarkdown(content)
      if (bodyText) scheduleDocumentSummary(document.id, workspaceId, bodyText)
      // Seed the first version (LUM-227) — the protected baseline.
      waitUntil(
        documentRevisionService
          .snapshotOnSave(document.id, workspaceId, memberId, {
            content,
            sourceMarkdown: sourceMarkdown ?? null,
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
    const client = await getUserDirectory()
    const [creatorUser] = await listUsersByIds(client, [
      document.createdBy.clerkId,
    ])

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
    options: {
      forceNewRevision?: boolean
      /**
       * Internal (LUM-410): set by editDocumentSection, which already ran the
       * structure guard at section scope — the full-document compare would
       * re-judge structure outside the addressed section.
       */
      skipStructureGuard?: boolean
      /**
       * Internal (LUM-445): set by restoreRevision to re-establish the restored
       * snapshot's byte-identical markdown source on an HTML-direct write. A
       * string re-validates the source; null keeps the old null-on-restore rule
       * for an HTML-authored revision; undefined (the default) leaves the normal
       * markdown-double-write / null-on-HTML behaviour untouched.
       */
      restoreSourceMarkdown?: string | null
      /** LUM-907: who changed visibility / the public link, and from where. */
      audit?: AuditContext
    } = {}
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
    const htmlDirectUpdate = data.content !== undefined
    if (data.contentMarkdown !== undefined) {
      data.content = markdownToHtml(data.contentMarkdown)
    }

    const updateData: import('@/lib/repositories/document.repository').DocumentUpdateData =
      {}
    // Markdown source bookkeeping (LUM-408): a markdown update double-writes
    // the byte-identical source; an HTML-direct update (web editor) invalidates
    // it so `doc show --raw` can never serve a stale source. A revision restore
    // (LUM-445) re-establishes the restored snapshot's stored source instead of
    // nulling it. Updates that don't touch the body leave it alone (undefined).
    let nextSourceMarkdown: string | null | undefined
    if (data.contentMarkdown !== undefined) {
      nextSourceMarkdown = data.contentMarkdown
    } else if (options.restoreSourceMarkdown !== undefined) {
      nextSourceMarkdown = options.restoreSourceMarkdown
    } else if (htmlDirectUpdate) {
      nextSourceMarkdown = null
    }
    if (nextSourceMarkdown !== undefined) {
      updateData.sourceMarkdown = nextSourceMarkdown
      // P5 signal (LUM-445): an HTML-direct write that drops a previously-valid
      // source silently locks the agent's markdown write path (raw/append now
      // fail). Emit an observable warning so the invalidation is traceable
      // rather than silent — the agent's "append succeeded" is no longer durable.
      if (
        nextSourceMarkdown === null &&
        (doc as { sourceMarkdown: string | null }).sourceMarkdown != null
      ) {
        logger.warn(
          'document markdown source invalidated by HTML-direct write',
          {
            documentId: doc.id,
            memberId,
          }
        )
      }
    }
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

    // Optimistic concurrency (LUM-409): reject a stale edit base up front so
    // nothing (tags included) is touched. The repository re-applies the same
    // precondition as a conditional write inside the transaction, closing the
    // read-check-to-write race window.
    const currentRevision = (doc as { contentRevision: number }).contentRevision
    if (data.ifRevision !== undefined && data.ifRevision !== currentRevision) {
      throw revisionConflict(data.ifRevision, currentRevision)
    }

    // Structure guard (LUM-410): a markdown body update that drops
    // tables/rows/headings versus the stored body is rejected before anything
    // (tags included) is touched — the verify-live-doc.ts reconciliation
    // moved server-side so it holds even when nobody remembers to run it.
    // Scope: markdown-path writes only. HTML-direct updates are the web
    // editor (interactive, human-intentional) and revision restores — never
    // guarded. Section edits arrive with skipStructureGuard after their own
    // section-scoped check.
    if (
      data.contentMarkdown !== undefined &&
      typeof data.content === 'string' &&
      !options.skipStructureGuard
    ) {
      assertNoStructureShrink({
        oldHtml: oldContent ?? '',
        newHtml: data.content,
        scope: 'document',
        allowShrink: data.allowShrink,
      })
    }

    // Every id the update would write must be the caller's (LUM-994) —
    // checked after the 409/422 preconditions, before anything (tag joins
    // included) is touched.
    await this.assertUpdateReferencesInWorkspace(data, workspaceId)

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

    let updated
    try {
      updated = await documentRepository.updateWithChildrenAndMentions(
        docId,
        workspaceId,
        updateData,
        data.childOrder,
        mentionTaskIds,
        data.ifRevision !== undefined
          ? { expectedContentRevision: data.ifRevision }
          : undefined
      )
    } catch (err) {
      if ((err as { code?: string }).code === 'REVISION_CONFLICT') {
        const fresh = await documentRepository.findById(docId, workspaceId)
        throw revisionConflict(
          data.ifRevision,
          (fresh as { contentRevision?: number } | null)?.contentRevision
        )
      }
      throw err
    }

    // LUM-907: who can read the document is audited after the write commits —
    // the visibility transition and the public link being turned on, off or
    // rotated. The public token itself never goes into the audit log.
    const before = doc as { visibility: string; publicToken: string | null }
    if (
      data.visibility !== undefined &&
      data.visibility !== before.visibility
    ) {
      await recordAuditEvent({
        workspaceId,
        action: 'document.visibility_changed',
        target: { type: 'document', id: docId },
        metadata: { from: before.visibility, to: data.visibility },
        context: options.audit,
      })
    }
    const nextToken = data.publicToken ?? null
    if (
      data.publicToken !== undefined &&
      nextToken !== (before.publicToken ?? null)
    ) {
      await recordAuditEvent({
        workspaceId,
        action: nextToken
          ? 'document.public_link_enabled'
          : 'document.public_link_disabled',
        target: { type: 'document', id: docId },
        metadata: { rotated: Boolean(nextToken && before.publicToken) },
        context: options.audit,
      })
    }

    // Track editor if content was updated
    if (data.content !== undefined) {
      await documentRepository.upsertEditor(docId, memberId)
      // Body changed — regenerate the cached summary in the background. Convert
      // the new HTML body to markdown for the LLM (handles legacy Tiptap JSON
      // too). A null/empty body short-circuits inside the schedule helper.
      const bodyText = renderContentToMarkdown(data.content)
      if (bodyText) scheduleDocumentSummary(docId, workspaceId, bodyText)
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
              sourceMarkdown: nextSourceMarkdown ?? null,
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
                entityKind: 'document',
                entityId: docId,
                entityTitle: updatedTitle,
                entityUrl: docUrl,
                mentionSurface: 'content',
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

  /**
   * LUM-994: an update may only reference rows in the caller's workspace —
   * the project it files the document in, the tags it attaches and the
   * documents it reorders. Any foreign (or missing) id → the same generic 404,
   * so the answer never reveals whether the id exists elsewhere.
   * `removeTagIds` is not checked: it only deletes join rows of this document.
   */
  async assertUpdateReferencesInWorkspace(
    data: Pick<
      UpdateDocumentInput,
      'projectId' | 'tagIds' | 'addTagIds' | 'childOrder'
    >,
    workspaceId: string
  ) {
    // null clears, undefined leaves untouched; any string (even '') is checked.
    if (typeof data.projectId === 'string') {
      const project = await projectRepository.findIdInWorkspace(
        data.projectId,
        workspaceId
      )
      if (!project) {
        throw Object.assign(new Error('Project not found'), { status: 404 })
      }
    }

    const tagIds = [
      ...new Set([...(data.tagIds ?? []), ...(data.addTagIds ?? [])]),
    ]
    if (tagIds.length > 0) {
      const found = await tagRepository.findIdsInWorkspace(tagIds, workspaceId)
      if (found.length !== tagIds.length) {
        throw Object.assign(new Error('Tag not found'), { status: 404 })
      }
    }

    const childIds = [...new Set(data.childOrder ?? [])]
    if (childIds.length > 0) {
      const found = await documentRepository.findIdsInWorkspace(
        childIds,
        workspaceId
      )
      if (found.length !== childIds.length) {
        throw Object.assign(new Error('Document not found'), { status: 404 })
      }
    }
  },

  /**
   * Section-addressed edit on the stored markdown source (LUM-409).
   *
   * Splices the new content into `sourceMarkdown` on the markdown AST's
   * heading boundaries — every byte outside the addressed section is carried
   * over untouched — then routes the full new source through `updateDocument`
   * so the HTML render, double-write, mention sync, summary and snapshot
   * side effects all stay on the single existing path.
   *
   * Always commits conditionally on the revision the splice base was read
   * at (caller's `ifRevision` when provided), so a concurrent body write
   * surfaces as 409 instead of being silently overwritten.
   */
  async editDocumentSection(
    id: string,
    memberId: string,
    workspaceId: string,
    input: SectionEditInput
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

    // Revision precondition first — independent of whether a markdown source
    // exists, so a sourceless end-append (below) is concurrency-safe too.
    const currentRevision = (doc as { contentRevision: number }).contentRevision
    if (
      input.ifRevision !== undefined &&
      input.ifRevision !== currentRevision
    ) {
      throw revisionConflict(input.ifRevision, currentRevision)
    }

    const src = (doc as { sourceMarkdown: string | null }).sourceMarkdown
    const isEndAppend =
      input.mode === 'append' &&
      (input.section === undefined || input.section.trim() === '')

    if (typeof src !== 'string') {
      // No byte-faithful markdown source (web HTML edit / revision restore /
      // legacy doc). Section-addressed edits and patches genuinely need the
      // source to locate heading boundaries — they stay 400. But an
      // end-of-document append is pure tail insertion: render the new block to
      // HTML and concatenate it onto the stored HTML body, so a single web
      // operation can never lock the whole doc against the agent write path
      // (LUM-444). sourceMarkdown stays null — we don't invent a lossy source.
      if (!isEndAppend) {
        throw Object.assign(
          new Error(
            `Document ${doc.id} has no stored markdown source — section editing needs a markdown base ` +
              `(the last edit was HTML-direct or predates markdown source storage). Upload a full ` +
              `markdown base once (lumo doc update ${doc.id} --file <base.md>); section ops work from then on.`
          ),
          { status: 400 }
        )
      }
      const oldContent = (doc as { content: string | null }).content ?? ''
      const block = markdownToHtml(input.contentMarkdown)
      // Pure insertion: every existing byte of the HTML body is carried over
      // verbatim; the rendered block is appended after it. The HTML-direct
      // path in updateDocument keeps sourceMarkdown null.
      const nextContent = oldContent ? `${oldContent}\n${block}` : block
      const updated = await this.updateDocument(doc.id, memberId, workspaceId, {
        content: nextContent,
        ifRevision: input.ifRevision ?? currentRevision,
      })
      return { ...updated, sectionHeading: null }
    }

    let nextSource: string
    let resolvedHeading: string | null = null
    if (input.section !== undefined && input.section.trim() !== '') {
      const match = findSection(src, input.section)
      if (match.kind === 'not-found') {
        const list = match.available
          .slice(0, 30)
          .map(s => `  ${headingLabel(s)}`)
          .join('\n')
        throw Object.assign(
          new Error(
            `Section not found: "${input.section}". Available headings:\n${list || '  (none)'}`
          ),
          { status: 404 }
        )
      }
      if (match.kind === 'ambiguous') {
        const list = match.candidates
          .map(s => `  ${headingLabel(s)} (line ${s.line + 1})`)
          .join('\n')
        throw Object.assign(
          new Error(
            `Section "${input.section}" is ambiguous — ${match.candidates.length} headings match:\n${list}\n` +
              `Disambiguate by depth, e.g. --section "${headingLabel(match.candidates[0]!)}"`
          ),
          { status: 400 }
        )
      }
      resolvedHeading = match.section.heading
      // Structure guard at section scope (LUM-410): for a replace, compare
      // the render of just the addressed section against the render of its
      // replacement — structure elsewhere in the document never factors into
      // the verdict (and stored-HTML drift outside the section can't produce
      // phantom losses). Appends are pure insertion and can't shrink.
      if (input.mode === 'replace') {
        assertNoStructureShrink({
          oldHtml: markdownToHtml(extractSection(src, match.section)),
          newHtml: markdownToHtml(input.contentMarkdown),
          scope: 'section',
          allowShrink: input.allowShrink,
        })
      }
      nextSource =
        input.mode === 'replace'
          ? replaceSection(src, match.section, input.contentMarkdown)
          : appendToSection(src, match.section, input.contentMarkdown)
    } else {
      if (input.mode === 'replace') {
        throw Object.assign(
          new Error('section is required for a section patch'),
          { status: 400 }
        )
      }
      // Append without a section targets the end of the document.
      nextSource = appendToSection(src, null, input.contentMarkdown)
    }

    const updated = await this.updateDocument(
      doc.id,
      memberId,
      workspaceId,
      {
        contentMarkdown: nextSource,
        // Conditional even without a caller-supplied ifRevision: the splice
        // base is the source read above, so any concurrent body write between
        // that read and this commit must 409, not last-write-win.
        ifRevision: input.ifRevision ?? currentRevision,
      },
      // Guarded above at section scope (appends can't shrink) — the
      // full-document compare would also judge structure outside the section.
      { skipStructureGuard: true }
    )
    return { ...updated, sectionHeading: resolvedHeading }
  },

  /**
   * Rebuild a document's markdown source from its stored HTML body (LUM-446).
   *
   * The recovery path for a source-less doc: when `sourceMarkdown` is gone (a
   * web HTML-direct write nulled it, or the doc predates source storage), the
   * markdown write paths (raw/diff/section/append) are all locked and the only
   * other route is a lossy manual reconstruction that flattens tables (LUM-349).
   * This regenerates a valid `sourceMarkdown` with the lossless serializer and
   * backfills ONLY that column — the rendered body (`content`) is untouched, so
   * the doc reads identically; we just re-attach a source the edit paths can use.
   *
   * Guarded by the LUM-410 structure guard: if the serialized markdown would
   * re-render with fewer tables/rows/headings than the stored body, it throws
   * 422 instead of committing a flattened source (override with allowShrink).
   *
   * Refuses (409) when the doc already has a stored source unless `force` is
   * set, so a byte-faithful human source is never silently downgraded to a
   * serializer-derived one.
   */
  async rebuildDocumentSource(
    id: string,
    memberId: string,
    workspaceId: string,
    options: {
      allowShrink?: boolean | undefined
      force?: boolean | undefined
      ifRevision?: number | undefined
      /**
       * LUM-1233 3h: the CLI flag the 409 names — `--confirm` for a CLI
       * without `doc rebuild-source --force`, `--force` for older ones.
       */
      cliApproval?: string | undefined
    } = {}
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

    const currentRevision = (doc as { contentRevision: number }).contentRevision
    if (
      options.ifRevision !== undefined &&
      options.ifRevision !== currentRevision
    ) {
      throw revisionConflict(options.ifRevision, currentRevision)
    }

    const existingSource = (doc as { sourceMarkdown: string | null })
      .sourceMarkdown
    if (existingSource != null && !options.force) {
      throw Object.assign(
        new Error(
          'Document already has a stored markdown source; rebuild is for ' +
            'source-less docs. Pass force to re-derive it from the HTML body ' +
            `(CLI: ${options.cliApproval ?? '--force'}) — note this replaces a byte-faithful source with a ` +
            'serializer-derived one.'
        ),
        { status: 409 }
      )
    }

    const content = (doc as { content: string | null }).content
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw Object.assign(
        new Error(
          'Document has no HTML body to rebuild a markdown source from (it is ' +
            'empty).'
        ),
        { status: 422 }
      )
    }

    // Serialize + structure guard (throws 422 on any table/tr/heading shrink).
    const sourceMarkdown = rebuildSourceMarkdown(content, {
      allowShrink: options.allowShrink,
    })

    // Backfill ONLY the source column: the body (content) and its revision are
    // left exactly as they were — this restores the edit base without re-rendering.
    const updated = await documentRepository.update(doc.id, workspaceId, {
      sourceMarkdown,
    })

    return {
      id: updated.id,
      title: updated.title,
      contentRevision: (updated as { contentRevision: number }).contentRevision,
      sourceMarkdown,
      sourceBytes: Buffer.byteLength(sourceMarkdown, 'utf8'),
    }
  },

  /**
   * Delete a document (owner only): it moves to the trash with its
   * sub-pages, restorable for 30 days (LUM-918).
   */
  async deleteDocument(
    id: string,
    memberId: string,
    workspaceId: string,
    deletedByClerkId: string
  ) {
    const doc = await documentRepository.findById(id, workspaceId)
    if (!doc) {
      throw Object.assign(new Error('Document not found'), { status: 404 })
    }
    if (doc.createdById !== memberId) {
      throw Object.assign(new Error('Only the owner can delete a document'), {
        status: 403,
      })
    }

    await trashService.trashDocument(doc.id, deletedByClerkId)
  },

  /**
   * Move a document under a new parent (or to the root).
   *
   * Both ends are authorized with the same rule (LUM-990): the moved document
   * AND the target parent must be documents the member may edit in their own
   * workspace (`findEditable` — owner, WORKSPACE visibility, or EDITOR/MANAGER
   * share). A parent outside the workspace, one the member can't see, and one
   * they can only view all get the same generic 404 as a missing document, so
   * the response says nothing about another tenant's ids.
   */
  async moveDocument(
    id: string,
    memberId: string,
    workspaceId: string,
    data: { parentId: string | null; sortOrder: number }
  ) {
    const notFound = () =>
      Object.assign(new Error('Not found or no permission'), { status: 404 })

    const doc = await documentRepository.findEditable(id, memberId, workspaceId)
    if (!doc) throw notFound()
    // `findEditable` resolves a slug too; use the cuid downstream.
    const docId = doc.id

    let parentId: string | null = null
    if (data.parentId) {
      const parent = await documentRepository.findEditable(
        data.parentId,
        memberId,
        workspaceId
      )
      if (!parent) throw notFound()
      parentId = parent.id

      // Prevent moving a document into its own subtree.
      let current: string | null = parentId
      const visited = new Set<string>()
      while (current && !visited.has(current)) {
        if (current === docId) {
          throw Object.assign(
            new Error('Cannot move a document into its own subtree'),
            { status: 400 }
          )
        }
        visited.add(current)
        const node = await documentRepository.findParentId(current, workspaceId)
        current = node?.parentId ?? null
      }
    }

    return documentRepository.move(docId, workspaceId, parentId, data.sortOrder)
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
  async syncDocumentMentions(
    documentId: string,
    workspaceId: string,
    content: unknown
  ) {
    const taskIds = this.extractTaskMentionIds(content)
    await documentRepository.updateWithChildrenAndMentions(
      documentId,
      workspaceId,
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
