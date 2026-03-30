import { useState, useCallback, useRef } from 'react'

/**
 * Manages a "copied!" state that auto-resets after `delay` ms.
 * Returns [copied, triggerCopy] where triggerCopy() sets copied=true
 * and schedules the reset.
 */
export function useCopyState(delay = 1500): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerCopy = useCallback(() => {
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), delay)
  }, [delay])

  return [copied, triggerCopy]
}
