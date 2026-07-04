/**
 * A document created from the tree/template opens the editor optimistically on
 * a client-only id (`temp-<uuid>`) while the real doc is created in the
 * background; the id then swaps to the server slug (see
 * useWorkspaceDocumentHandlers). Centralised here so the prefix has one source
 * of truth — the generator and every "is this still a placeholder?" check agree
 * (LUM-658: a save fired against a temp id 404s → "Error saving").
 */
export const TEMP_DOC_ID_PREFIX = 'temp-'

/** True while `id` is an optimistic placeholder not yet created server-side. */
export function isTempDocumentId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(TEMP_DOC_ID_PREFIX)
}
