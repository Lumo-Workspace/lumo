/**
 * Evidence-pointer grammar for acceptance verification (LUM-343).
 *
 * A VerificationRun's evidencePointer is NOT free text — free-text evidence
 * from an agent-controlled path would reopen the side channel the verdict
 * red line closed (agent-containment absorption, LUM-343 review note). The
 * pointer must take one of the enumerated shapes below. Single source of
 * truth shared by the CLI (which builds pointers) and the server validation
 * layer (which rejects everything else).
 *
 * Shapes:
 * - `commit:<7-40 hex>`            — a commit the evidence lives in
 * - `file:<path>:<line>[-<line>]`  — a file location (path:line, no spaces)
 * - `cmd:<command>#exit=<code>`    — an executed check plus its exit status
 */
export const EVIDENCE_POINTER_PATTERNS: ReadonlyArray<RegExp> = [
  /^commit:[0-9a-f]{7,40}$/,
  /^file:[^\s]+:\d+(-\d+)?$/,
  /^cmd:[\s\S]+#exit=\d+$/,
]

export const EVIDENCE_POINTER_FORMAT_HINT =
  'evidencePointer must be one of: commit:<hash>, file:<path>:<line>, cmd:<command>#exit=<code>'

export function isValidEvidencePointer(value: string): boolean {
  return EVIDENCE_POINTER_PATTERNS.some(p => p.test(value))
}

/** Max stored pointer length — mirrors the column-level cap in validation. */
export const EVIDENCE_POINTER_MAX = 2_000

/**
 * Build a `cmd:` evidence pointer for an executed checkpointer. The command
 * is truncated so the suffix (`#exit=N`) always survives the length cap —
 * a pointer that loses its exit marker would no longer parse as evidence.
 */
export function buildCmdEvidencePointer(
  command: string,
  exitCode: number
): string {
  const suffix = `#exit=${exitCode}`
  const budget = EVIDENCE_POINTER_MAX - 'cmd:'.length - suffix.length
  const cmd = command.length > budget ? command.slice(0, budget) : command
  return `cmd:${cmd}${suffix}`
}
