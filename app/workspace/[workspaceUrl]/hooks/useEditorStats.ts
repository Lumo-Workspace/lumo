import { useEffect, useRef, type MutableRefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { computeReadingStats, type EditorStats } from '@/lib/editor/reading-stats'

interface UseEditorStatsArgs {
  editor: Editor | null
  enabled: boolean
  onStatsUpdate: ((stats: EditorStats) => void) | undefined
  /**
   * Component-owned ref the hook points at its live `emit` closure, mirroring
   * `emitTocRef`. The component calls it after any programmatic
   * `setContent(..., { emitUpdate: false })` (doc switch, task extraction),
   * which deliberately skips the editor's `update` event and would otherwise
   * leave the footer showing the previous document's counts.
   */
  emitStatsRef: MutableRefObject<() => void>
  /** Debounce window (ms) for recomputing on keystrokes. */
  debounceMs?: number
}

/** Shape of `@tiptap/extension-character-count`'s editor storage. */
interface CharacterCountStorage {
  characters: () => number
}

/**
 * Feeds word / character / reading-time stats to the document footer.
 *
 * Character count comes from the CharacterCount extension's storage; the
 * CJK-aware word count + reading time are derived from the editor's plain text
 * (see {@link computeReadingStats}). `getText()` is O(document), so recomputes
 * are debounced to stay off the per-keystroke hot path — matching the
 * serializer's reasoning in DescriptionEditor.
 */
export function useEditorStats({
  editor,
  enabled,
  onStatsUpdate,
  emitStatsRef,
  debounceMs = 300,
}: UseEditorStatsArgs): void {
  // Keep the latest callback reachable from the (subscribed-once) emit closure.
  // Synced in an effect (not during render) so the ref write is never a render
  // side effect — mirrors useTocSync's mirror-effects.
  const onStatsUpdateRef = useRef(onStatsUpdate)
  useEffect(() => {
    onStatsUpdateRef.current = onStatsUpdate
  }, [onStatsUpdate])

  useEffect(() => {
    if (!enabled || !editor) return

    const emit = () => {
      const storage = editor.storage.characterCount as
        | CharacterCountStorage
        | undefined
      const characters = storage?.characters() ?? 0
      const { words, readingMinutes } = computeReadingStats(editor.getText())
      onStatsUpdateRef.current?.({ words, characters, readingMinutes })
    }

    emitStatsRef.current = emit

    let timer: ReturnType<typeof setTimeout> | null = null
    const onUpdate = () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(emit, debounceMs)
    }

    editor.on('update', onUpdate)
    // Seed the footer with the initial content's stats.
    emit()

    return () => {
      editor.off('update', onUpdate)
      if (timer !== null) clearTimeout(timer)
      emitStatsRef.current = () => {}
    }
  }, [editor, enabled, emitStatsRef, debounceMs])
}
