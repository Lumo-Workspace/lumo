import type { KeyboardEvent } from 'react'

/**
 * Detect macOS / iOS without the deprecated `navigator.platform`.
 *
 * Prefer the modern `navigator.userAgentData.platform` (a synchronous
 * low-entropy hint, e.g. "macOS"). Browsers that don't implement it yet
 * (Safari, Firefox) fall back to `navigator.platform`, which is still the
 * only synchronous signal available there — iOS/iPadOS report
 * "iPhone"/"iPad"/"MacIntel" through it.
 */
export function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform
  if (uaPlatform) return /mac/i.test(uaPlatform)
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

/** Returns true if the user is on macOS / iOS */
export const isMac = detectMac()

/** The submit modifier key label for the current OS */
export const submitModLabel = isMac ? '⌘' : 'Ctrl'

/** Returns true when the submit shortcut (Cmd/Ctrl + Enter) is pressed */
export function isSubmitShortcut(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)
}
