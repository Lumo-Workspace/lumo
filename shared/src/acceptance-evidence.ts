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
 * A structured evidence pointer, decomposed from its grammar string (LUM-563).
 * The companion to the validation regexes above: validation rejects anything
 * that doesn't match a shape; this turns a matched shape into its parts so a
 * renderer can drill into it (a navigable commit URL, a clickable path:line, a
 * re-runnable command) instead of printing the inert raw token.
 */
export type ParsedEvidencePointer =
  | { kind: 'commit'; hash: string }
  | { kind: 'file'; path: string; line: string }
  | { kind: 'cmd'; command: string; exitCode: number }

/**
 * Decompose an evidence pointer into its parts, or null if it doesn't parse.
 * The grammar is the single source of truth (EVIDENCE_POINTER_PATTERNS); this
 * mirrors those exact shapes — a `#` may appear inside a `cmd:` command, so the
 * exit marker is matched greedily from the END, never the first `#`.
 */
export function parseEvidencePointer(
  value: string
): ParsedEvidencePointer | null {
  const commit = /^commit:([0-9a-f]{7,40})$/.exec(value)
  if (commit) return { kind: 'commit', hash: commit[1]! }

  const file = /^file:([^\s]+):(\d+(?:-\d+)?)$/.exec(value)
  if (file) return { kind: 'file', path: file[1]!, line: file[2]! }

  const cmd = /^cmd:([\s\S]+)#exit=(\d+)$/.exec(value)
  if (cmd) return { kind: 'cmd', command: cmd[1]!, exitCode: Number(cmd[2]!) }

  return null
}

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
