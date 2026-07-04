import { useCallback, useEffect, useRef, useState } from 'react'
import { documentsClient } from '@/lib/api-client'
import type { ApiDocumentDetail } from '../types'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** Fields the auto-save pipeline may patch. All optional — only the keys
 *  present in a call are sent (and merged with any other pending keys). */
export interface DocumentSaveUpdates {
  title?: string
  content?: string
  emoji?: string | null
}

interface UseDocumentSaveOptions {
  documentId: string
  /** Applied ONLY for the most-recently-started save, so a slow earlier
   *  response can never clobber a newer one. Merge the partial into doc
   *  state and persist the cache here. */
  applyResult: (partial: Partial<ApiDocumentDetail>) => void
  /** Debounce window in ms. Defaults to 1000. */
  debounceMs?: number
  /** The document is still an optimistic placeholder — created from a template
   *  it opens on a client-only `temp-<uuid>` id while the real doc is created
   *  in the background (LUM-658). PATCHing that id 404s ("Error saving"), so
   *  while `true` saves are held in `pendingRef` (never sent); the transition
   *  to `false` (real id now supplied) replays them against the real id. */
  isPending?: boolean
}

interface UseDocumentSave {
  saveStatus: SaveStatus
  /** Accumulate `updates` into the pending patch and (re)arm the debounce
   *  timer. Multiple fields edited within the window coalesce into a single
   *  request — editing content then title no longer drops the content save. */
  debouncedSave: (updates: DocumentSaveUpdates) => void
  /** Merge `updates` into the pending patch and flush immediately (cancels
   *  the debounce timer). Used for blur-commit and emoji picks so any pending
   *  edits ride along instead of being left behind. */
  saveNow: (updates: DocumentSaveUpdates) => void
  /** Cancel the debounce timer and await any in-flight or newly-started save.
   *  Call this before operations that depend on the server having the latest
   *  content (e.g. creating a comment anchor). Resolves when the save
   *  completes or immediately if there was nothing pending. */
  flushAsync: () => Promise<void>
}

/**
 * Owns the document auto-save pipeline: debounce coalescing + request
 * serialization. Two bugs this guards against (LUM-206):
 *
 * 1. A single shared debounce timer that replaced (not merged) its payload
 *    meant editing content then the title within the window cancelled the
 *    content save. `pendingRef` now accumulates a merged patch.
 * 2. Concurrent saves returning out of order let a stale response overwrite
 *    newer state. `seqRef`/`latestSeqRef` ensure only the last-started save
 *    applies its result; earlier in-flight responses are discarded.
 */
export function useDocumentSave({
  documentId,
  applyResult,
  debounceMs = 1000,
  isPending = false,
}: UseDocumentSaveOptions): UseDocumentSave {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<DocumentSaveUpdates>({})
  // Read inside `save` so the deferral tracks the latest value without putting
  // `isPending` in `save`'s deps (which would rebuild the memoized handlers).
  const isPendingRef = useRef(isPending)
  // Monotonic id assigned when a request starts; `latestSeqRef` tracks the
  // newest one so older completions can detect they've been superseded.
  const seqRef = useRef(0)
  const latestSeqRef = useRef(0)

  // Keep applyResult current without re-creating the save callbacks (and thus
  // the handlers the component memoizes) on every render.
  const applyResultRef = useRef(applyResult)
  useEffect(() => {
    applyResultRef.current = applyResult
  }, [applyResult])

  const save = useCallback(
    async (updates: DocumentSaveUpdates) => {
      if (Object.keys(updates).length === 0) return
      // Optimistic placeholder (LUM-658): the real doc doesn't exist yet, so a
      // PATCH would 404. Retain the merged patch — don't send, don't flip
      // saveStatus — the isPending→false effect replays it against the real id.
      if (isPendingRef.current) {
        pendingRef.current = { ...pendingRef.current, ...updates }
        return
      }
      const mySeq = ++seqRef.current
      latestSeqRef.current = mySeq
      setSaveStatus('saving')
      try {
        const data = await documentsClient.update<{
          document: Partial<ApiDocumentDetail>
        }>(documentId, updates)
        // A newer save started (or finished) while we were in flight — drop
        // this response so it can't overwrite fresher state.
        if (mySeq !== latestSeqRef.current) return
        setSaveStatus('saved')
        if (savedTimer.current) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSaveStatus('idle'), 2000)
        applyResultRef.current(data.document)
      } catch {
        if (mySeq !== latestSeqRef.current) return
        setSaveStatus('error')
      }
    },
    [documentId]
  )

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = {}
    if (Object.keys(pending).length > 0) void save(pending)
  }, [save])

  const flushAsync = useCallback((): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = {}
    if (Object.keys(pending).length > 0) return save(pending)
    return Promise.resolve()
  }, [save])

  const debouncedSave = useCallback(
    (updates: DocumentSaveUpdates) => {
      pendingRef.current = { ...pendingRef.current, ...updates }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flush, debounceMs)
    },
    [flush, debounceMs]
  )

  const saveNow = useCallback(
    (updates: DocumentSaveUpdates) => {
      pendingRef.current = { ...pendingRef.current, ...updates }
      flush()
    },
    [flush]
  )

  // Replay deferred edits once the optimistic placeholder resolves (LUM-658).
  // `documentId` swaps to the real slug and `isPending` clears in the same
  // render, so `flush` here is already bound to the real id — the retained
  // patch lands as one PATCH to the real doc instead of 404ing the temp id.
  useEffect(() => {
    const wasPending = isPendingRef.current
    isPendingRef.current = isPending
    if (wasPending && !isPending) flush()
  }, [isPending, flush])

  // Flush nothing on unmount, but clear timers so a pending callback can't
  // fire against an unmounted component.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  return { saveStatus, debouncedSave, saveNow, flushAsync }
}
