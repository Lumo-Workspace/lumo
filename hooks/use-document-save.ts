'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface UseDocumentSaveOptions {
  documentId: string | null
  onSave: (content: any, title?: string) => Promise<void>
  debounceMs?: number
}

interface UseDocumentSaveReturn {
  saveState: SaveState
  error: string | null
  save: (content: any, title?: string) => Promise<void>
  debouncedSave: (content: any, title?: string) => void
  lastSaved: Date | null
}

/**
 * Hook for document save operations (auto-save and manual save)
 * Follows React 19 patterns and provides non-disruptive error handling
 */
export function useDocumentSave({
  documentId,
  onSave,
  debounceMs = 2000,
}: UseDocumentSaveOptions): UseDocumentSaveReturn {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingContentRef = useRef<any>(null)
  const pendingTitleRef = useRef<string | undefined>(undefined)

  const performSave = useCallback(
    async (content: any, title?: string) => {
      if (!documentId) return

      setSaveState('saving')
      setError(null)

      try {
        await onSave(content, title)
        setSaveState('saved')
        setLastSaved(new Date())
        // Clear saved state after 2 seconds
        setTimeout(() => {
          setSaveState(prev => (prev === 'saved' ? 'idle' : prev))
        }, 2000)
      } catch (err) {
        setSaveState('error')
        setError(err instanceof Error ? err.message : 'Failed to save')
        // Keep error state visible until next save attempt
      }
    },
    [documentId, onSave]
  )

  const save = useCallback(
    async (content: any, title?: string) => {
      // Clear any pending debounced save
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }

      // Store pending content
      pendingContentRef.current = content
      pendingTitleRef.current = title

      // Immediate save (for manual save)
      await performSave(content, title)
    },
    [performSave]
  )

  const debouncedSave = useCallback(
    (content: any, title?: string) => {
      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      // Store pending content
      pendingContentRef.current = content
      pendingTitleRef.current = title

      // Set new timer
      debounceTimerRef.current = setTimeout(() => {
        if (pendingContentRef.current) {
          performSave(pendingContentRef.current, pendingTitleRef.current)
        }
        debounceTimerRef.current = null
      }, debounceMs)
    },
    [performSave, debounceMs]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return {
    saveState,
    error,
    save,
    debouncedSave,
    lastSaved,
  }
}
