/**
 * LUM-1110 / LUM-1233 — the CLI version header and its parser, with no
 * `next/server` dependency (the 426 gate in `cli-version-gate.ts` re-exports
 * both; pure renderers import them from here).
 */

/** Must stay byte-identical to `CLI_VERSION_HEADER` in the CLI (a test pins it). */
export const CLI_VERSION_HEADER = 'X-Lumo-Cli-Version'

const VERSION_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/

/** `[major, minor, patch]`, or null when `value` is not a plain version. */
export function parseCliVersion(
  value: string | null | undefined
): [number, number, number] | null {
  const m = VERSION_RE.exec((value ?? '').trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
