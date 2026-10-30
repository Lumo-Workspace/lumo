/**
 * LUM-1343 — import a Feishu / Lark doc (docx, or a wiki node that is a
 * docx) as a Lumo Doc, and re-sync it one way. Mirrors Google Docs import
 * (lib/services/google-docs-import.service.ts): the importing member owns the
 * doc, and every re-sync runs as the importer's Feishu token, so Feishu
 * enforces access at fetch time.
 *
 * Images are copied into the workspace's private image prefix (the one the
 * editor uploads to), keyed by the Feishu image token so a re-sync reuses its
 * earlier copies. An image that cannot be copied stays a link back to Feishu.
 *
 * Every failure has a stable `code` (FeishuDocErrorCode). A failed re-sync
 * stores that code in `feishuSyncError` (shown on the doc) and the next
 * success clears it.
 */
import { createHash } from 'node:crypto'
import {
  FeishuNeedsReauthError,
  FEISHU_RATE_LIMIT_CODES,
  type FeishuUserClient,
} from '@/lib/integrations/feishu/client'
import { FeishuApiError } from '@/lib/integrations/feishu/http'
import {
  parseFeishuDocUrl,
  wikiObjKind,
} from '@/lib/integrations/feishu/doc-url'
import {
  downloadDocMedia,
  getDocxMeta,
  getWikiNode,
  listDocxBlocks,
} from '@/lib/integrations/feishu/docx-api'
import {
  collectImageTokens,
  feishuBlocksToMarkdown,
} from '@/lib/integrations/feishu/docx-to-markdown'
import {
  getUserClientForMember,
  isFeishuEnabled,
} from '@/lib/services/feishu-integration.service'
import { documentService } from '@/lib/services/document.service'
import { privateFileService } from '@/lib/services/private-file.service'
import { documentRepository } from '@/lib/repositories/document.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { logger } from '@/lib/logger'

// ── Errors ──────────────────────────────────────────────────────────────────

export type FeishuDocErrorCode =
  | 'feishu_doc_url_invalid'
  | 'feishu_doc_unsupported_type'
  | 'feishu_not_connected'
  | 'feishu_needs_reauth'
  | 'feishu_doc_forbidden'
  | 'feishu_doc_not_found'
  | 'feishu_scope_missing'
  | 'feishu_rate_limited'
  | 'feishu_importer_left'
  | 'feishu_not_imported'
  | 'feishu_doc_too_large'
  | 'not_installed'
  | 'reinstall_required'
  | 'feishu_sync_failed'

export const FEISHU_DOC_ERROR_CODES: readonly FeishuDocErrorCode[] = [
  'feishu_doc_url_invalid',
  'feishu_doc_unsupported_type',
  'feishu_not_connected',
  'feishu_needs_reauth',
  'feishu_doc_forbidden',
  'feishu_doc_not_found',
  'feishu_scope_missing',
  'feishu_rate_limited',
  'feishu_importer_left',
  'feishu_not_imported',
  'feishu_doc_too_large',
  'not_installed',
  'reinstall_required',
  'feishu_sync_failed',
]

export type FeishuDocError = Error & {
  status: number
  code: FeishuDocErrorCode
  /** For feishu_doc_unsupported_type: the object type refused. */
  objectType?: string
}

function docError(
  code: FeishuDocErrorCode,
  status: number,
  message: string,
  extra: { objectType?: string } = {}
): FeishuDocError {
  return Object.assign(new Error(message), { status, code, ...extra })
}

/** Feishu codes: no read permission (docx 1770032, wiki 131006). */
const FORBIDDEN_CODES = [1770032, 131006]
/** Feishu codes: gone (docx 1770002 not found / 1770003 deleted, wiki 131005). */
const NOT_FOUND_CODES = [1770002, 1770003, 131005]
/** Feishu codes: the app (99991672) or the user (99991679) lacks a scope. */
const SCOPE_CODES = [99991672, 99991679]

/** Map anything a Feishu call can throw onto one FeishuDocError. */
export function toFeishuDocError(error: unknown): FeishuDocError {
  // Already one of ours (or a connection error from feishu-integration).
  const e = error as Partial<FeishuDocError> | undefined
  if (
    error instanceof Error &&
    e &&
    typeof e.code === 'string' &&
    typeof e.status === 'number' &&
    (FEISHU_DOC_ERROR_CODES as readonly string[]).includes(e.code)
  ) {
    return e as FeishuDocError
  }
  if (error instanceof FeishuNeedsReauthError) {
    return docError(
      'feishu_needs_reauth',
      403,
      'Your Feishu account needs to be reconnected'
    )
  }
  if (error instanceof FeishuApiError) {
    const code = error.code
    if (code !== null && SCOPE_CODES.includes(code)) {
      return docError(
        'feishu_scope_missing',
        403,
        'The Feishu app or account is missing a permission this import needs'
      )
    }
    if (
      (code !== null && FORBIDDEN_CODES.includes(code)) ||
      (code === null && error.httpStatus === 403)
    ) {
      return docError(
        'feishu_doc_forbidden',
        403,
        'You do not have permission to read this Feishu document'
      )
    }
    if (
      (code !== null && NOT_FOUND_CODES.includes(code)) ||
      (code === null && error.httpStatus === 404)
    ) {
      return docError(
        'feishu_doc_not_found',
        404,
        'The Feishu document was not found or has been deleted'
      )
    }
    if (
      error.httpStatus === 429 ||
      (code !== null && FEISHU_RATE_LIMIT_CODES.includes(code))
    ) {
      return docError(
        'feishu_rate_limited',
        429,
        'Feishu is rate limiting requests; try again in a minute'
      )
    }
  }
  return docError(
    'feishu_sync_failed',
    502,
    'Could not read the document from Feishu'
  )
}

// ── Images ──────────────────────────────────────────────────────────────────

/** What the editor upload route accepts, minus SVG (scriptable). */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** drive media download is limited to 5 QPS / 10k a day per app. */
const MAX_IMAGES_PER_DOC = 100

/** Stable per workspace + Feishu image, so a re-sync reuses its copy. */
export function importedImageFileId(
  workspaceId: string,
  imageToken: string
): string {
  const digest = createHash('sha256')
    .update(`${workspaceId}:${imageToken}`)
    .digest('hex')
  return `feishu-${digest.slice(0, 40)}`
}

async function copyImages(
  client: FeishuUserClient,
  workspaceId: string,
  tokens: string[],
  origin: string
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  for (const token of tokens.slice(0, MAX_IMAGES_PER_DOC)) {
    try {
      const url = await privateFileService.storeImportedImage(
        workspaceId,
        importedImageFileId(workspaceId, token),
        async () => {
          const file = await downloadDocMedia(client, token)
          const contentType = file.contentType.split(';')[0]!.trim()
          if (!IMAGE_TYPES.includes(contentType)) {
            throw new Error(`unsupported image type ${contentType}`)
          }
          if (file.body.byteLength > MAX_IMAGE_BYTES) {
            throw new Error('image larger than 10 MB')
          }
          return { body: Buffer.from(file.body), contentType }
        },
        origin
      )
      urls.set(token, url)
    } catch (error) {
      // A dead link fails the whole import; anything else degrades this one
      // image to a link back.
      if (error instanceof FeishuNeedsReauthError) throw error
      logger.warn('[feishu-docs-import] image not copied', {
        workspaceId,
        error: (error as Error).message,
      })
    }
  }
  return urls
}

// ── Import / resync ─────────────────────────────────────────────────────────

interface FetchedDoc {
  title: string
  markdown: string
  unsupported: string[]
  missingImages: number
}

/** Read the docx and convert it, copying its images first. */
async function fetchDocx(
  client: FeishuUserClient,
  workspaceId: string,
  documentId: string,
  sourceUrl: string,
  origin: string
): Promise<FetchedDoc> {
  const meta = await getDocxMeta(client, documentId)
  const blocks = await listDocxBlocks(client, documentId)
  const imageUrls = await copyImages(
    client,
    workspaceId,
    collectImageTokens(blocks),
    origin
  )
  const converted = feishuBlocksToMarkdown(blocks, { sourceUrl, imageUrls })
  return {
    title: meta.title,
    markdown: converted.markdown,
    unsupported: converted.unsupported,
    missingImages: converted.missingImages,
  }
}

function requireEnabled(workspaceId: string): void {
  if (!isFeishuEnabled(workspaceId)) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
}

export interface FeishuImportResult {
  document: Awaited<ReturnType<typeof documentService.createDocument>>
  unsupported: string[]
  missingImages: number
}

export const feishuDocsImportService = {
  /**
   * Import a Feishu docx (or wiki node pointing at one) as a new Lumo Doc
   * owned by the acting member, whose token later re-syncs reuse.
   */
  async importFeishuDoc(
    workspaceId: string,
    memberId: string,
    input: {
      url: string
      visibility?: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
      origin: string
    }
  ): Promise<FeishuImportResult> {
    requireEnabled(workspaceId)
    const ref = parseFeishuDocUrl(input.url)
    if (!ref) {
      throw docError(
        'feishu_doc_url_invalid',
        400,
        'Not a Feishu or Lark document URL'
      )
    }
    if (ref.kind === 'unsupported') {
      throw docError(
        'feishu_doc_unsupported_type',
        422,
        `Feishu ${ref.type} files cannot be imported; only documents (docx) can`,
        { objectType: ref.type }
      )
    }

    try {
      const client = await getUserClientForMember(workspaceId, memberId)
      let documentId = ref.token
      let fallbackTitle = ''
      if (ref.kind === 'wiki') {
        const node = await getWikiNode(client, ref.token)
        const kind = wikiObjKind(node.objType)
        if (kind !== 'docx' || !node.objToken) {
          throw docError(
            'feishu_doc_unsupported_type',
            422,
            `This wiki page is a Feishu ${node.objType || 'object'}; only documents (docx) can be imported`,
            { objectType: node.objType || 'unknown' }
          )
        }
        documentId = node.objToken
        fallbackTitle = node.title
      }
      const fetched = await fetchDocx(
        client,
        workspaceId,
        documentId,
        ref.url,
        input.origin
      )
      const document = await documentService.createDocument(
        workspaceId,
        memberId,
        {
          title: fetched.title || fallbackTitle || 'Untitled',
          visibility: input.visibility ?? 'PRIVATE',
          contentMarkdown: fetched.markdown,
          feishuDocToken: documentId,
          feishuSourceUrl: ref.url,
          feishuImporterId: memberId,
          feishuSyncedAt: new Date(),
        }
      )
      return {
        document,
        unsupported: fetched.unsupported,
        missingImages: fetched.missingImages,
      }
    } catch (error) {
      throw toFeishuDocError(error)
    }
  },

  /**
   * Re-sync an imported doc as its IMPORTER and overwrite the Lumo body
   * (one-way, destructive to local edits by design). Any member who can see
   * the doc may trigger it. A failure is recorded as `feishuSyncError`.
   */
  async resyncFeishuDoc(
    workspaceId: string,
    actingMemberId: string,
    docId: string,
    origin: string
  ) {
    requireEnabled(workspaceId)
    const visible = await documentRepository.findWithPermission(
      docId,
      actingMemberId,
      workspaceId
    )
    if (!visible) {
      throw Object.assign(new Error('Document not found'), { status: 404 })
    }
    const meta = await documentRepository.findFeishuSourceMeta(
      visible.id,
      workspaceId
    )
    if (!meta?.feishuDocToken || !meta.feishuImporterId) {
      throw docError(
        'feishu_not_imported',
        400,
        'This document was not imported from Feishu'
      )
    }
    const importerId = meta.feishuImporterId

    try {
      const importer = await memberRepository.findById(importerId)
      if (!importer || importer.workspaceId !== workspaceId) {
        throw docError(
          'feishu_importer_left',
          409,
          'The member who imported this document has left the workspace; import it again to keep syncing'
        )
      }
      const client = await getUserClientForMember(workspaceId, importerId)
      const fetched = await fetchDocx(
        client,
        workspaceId,
        meta.feishuDocToken,
        meta.feishuSourceUrl ?? '',
        origin
      )
      // Runs as the importer (the doc's creator) so the OWNER check passes.
      return await documentService.updateDocument(
        meta.id,
        importerId,
        workspaceId,
        {
          contentMarkdown: fetched.markdown,
          // Feishu is the authority: a table deleted upstream must go here
          // too, so the structure guard (LUM-410) never blocks this path.
          allowShrink: true,
          feishuSyncedAt: new Date(),
          feishuSyncError: null,
        }
      )
    } catch (error) {
      const mapped = toFeishuDocError(error)
      await documentRepository.update(meta.id, workspaceId, {
        feishuSyncError: mapped.code,
      })
      throw mapped
    }
  },
}
