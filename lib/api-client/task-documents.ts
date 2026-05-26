import { apiFetch } from './base'

export interface TaskDocumentResource {
  id: string
  slug: string
  title: string
  emoji: string | null
  updatedAt: string
}

/** Minimal document shape returned by `GET /api/documents?search=...`.
 *
 * The endpoint actually returns much richer documents (project, shares,
 * editors, etc.); we narrow to the fields the LinkDocPopover uses so callers
 * don't accidentally couple to the full payload. */
export interface DocumentSearchHit {
  id: string
  slug: string
  title: string
  emoji: string | null
}

export const taskDocumentsClient = {
  list(taskId: string): Promise<{ documents: TaskDocumentResource[] }> {
    return apiFetch(`/api/tasks/${taskId}/documents`)
  },

  /** Attach a document to a task as an EXPLICIT mention.
   *
   * Accepts either a cuid (`documentId`) or a human identifier (`identifier`
   * — e.g. a doc slug). Mirrors the route's `attachTaskDocumentBodySchema`. */
  attach(
    taskId: string,
    payload: { identifier: string } | { documentId: string }
  ): Promise<{
    documentId: string
    alreadyBound: boolean
    upgradedFromContent: boolean
  }> {
    return apiFetch(`/api/tasks/${taskId}/documents`, {
      method: 'POST',
      body: payload,
    })
  },

  /** Detach an EXPLICIT mention. Throws `ApiClientError` with
   * `code === 'CONTENT_MENTION_ONLY'` (status 409) when the mention is
   * content-derived and can only be removed by editing the doc body. */
  detach(taskId: string, documentId: string): Promise<{ removed: number }> {
    return apiFetch(`/api/tasks/${taskId}/documents/${documentId}`, {
      method: 'DELETE',
    })
  },

  /** Search workspace documents by title substring. The underlying endpoint
   * applies workspace + permission filtering server-side. */
  search(query: string): Promise<{ documents: DocumentSearchHit[] }> {
    const params = new URLSearchParams({ search: query })
    return apiFetch(`/api/documents?${params.toString()}`)
  },
}
