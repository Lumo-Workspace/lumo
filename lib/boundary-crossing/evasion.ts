/**
 * The evasion marker — the prefix the detector stamps onto a crossing's
 * `detail` when the forbidden action was only visible after decoding an
 * obfuscated payload (base64 today).
 *
 * Extracted from boundary-detector.service.ts for LUM-759: the retroactive
 * suppression sweep has to exclude evasion-decoded rows for exactly the reason
 * the detector does — deliberate obfuscation is never a false positive, so no
 * repository rule may auto-handle it — and both sides must key on the same
 * literal, not on two drifting copies of it.
 */
export const EVASION_MARKER = '[base64-decoded] '

/** The substring form actually matched against a stored `detail`. */
export const EVASION_MARKER_MATCH = EVASION_MARKER.trim()

/** Whether a crossing's `detail` came from a decoded (obfuscated) payload. */
export function isEvasionDecoded(detail: string): boolean {
  return detail.includes(EVASION_MARKER_MATCH)
}
