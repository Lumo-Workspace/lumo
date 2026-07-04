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

/**
 * True on the exact render where the editor's document id swaps from an
 * optimistic `temp-<uuid>` to the real server slug (background create resolved).
 *
 * At that instant the created doc is already authoritative locally — the swap
 * handler seeds `cache(realSlug)` with it, and `useDocumentSave` replays the
 * user's held edits against the real id. A server GET fired from the fetch
 * effect on this transition returns the *pre-edit* template body and races that
 * replay, so it can briefly flash the editor back to the template before the
 * replayed PATCH lands (LUM-659). Callers use this to skip that one GET.
 *
 * Only the temp→real transition qualifies: initial load (`prevId` null), a
 * genuine real→real navigation, a temp→temp change, or `nextId` not yet a real
 * slug all return false so normal fetching is unaffected.
 */
export function isTempToRealSwap(
  prevId: string | null | undefined,
  nextId: string | null | undefined
): boolean {
  return (
    isTempDocumentId(prevId) &&
    typeof nextId === 'string' &&
    nextId.length > 0 &&
    !isTempDocumentId(nextId)
  )
}
