'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { readCache, writeCache } from '../cache'

interface UseFormRecoveryOptions<T extends Record<string, unknown>> {
  /** localStorage cache key, e.g. CACHE_KEY.formRecoveryNewTask */
  cacheKey: string
  /** If true, skip auto-save (e.g., editing a DB draft). */
  disabled?: boolean | undefined
  /** Returns true if all fields are at default/empty values. */
  isEmpty: (data: T) => boolean
}

interface UseFormRecoveryReturn<T> {
  /** Cached form data from a previous session, or null. */
  recovered: T | null
  /** Call when user clicks "Restore". Clears recovered so banner hides. */
  acceptRecovery: () => T | null
  /** Call when user clicks "Discard". Clears both recovered state and localStorage. */
  discardRecovery: () => void
  /** Call on every form change (debounced internally). */
  save: (data: T) => void
  /** Call on submit or "Save Draft" to clear localStorage. */
  clear: () => void
}

export function useFormRecovery<T extends Record<string, unknown>>({
  cacheKey,
  disabled = false,
  isEmpty,
}: UseFormRecoveryOptions<T>): UseFormRecoveryReturn<T> {
  const [recovered, setRecovered] = useState<T | null>(() => {
    if (disabled) return null
    return readCache<T>(cacheKey)
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Store isEmpty in a ref so `save` callback stays stable across renders
  const isEmptyRef = useRef(isEmpty)
  useEffect(() => {
    isEmptyRef.current = isEmpty
  })

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const save = useCallback(
    (data: T) => {
      if (disabled) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (isEmptyRef.current(data)) {
          localStorage.removeItem(cacheKey)
        } else {
          writeCache(cacheKey, data)
        }
      }, 500)
    },
    [cacheKey, disabled]
  )

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    localStorage.removeItem(cacheKey)
    setRecovered(null)
  }, [cacheKey])

  const acceptRecovery = useCallback(() => {
    const data = recovered
    setRecovered(null)
    // Don't clear localStorage yet — user might close without submitting
    return data
  }, [recovered])

  const discardRecovery = useCallback(() => {
    localStorage.removeItem(cacheKey)
    setRecovered(null)
  }, [cacheKey])

  return { recovered, acceptRecovery, discardRecovery, save, clear }
}
