/**
 * LUM-1212 — a line for an AI-review finding the model returned without one.
 *
 * The write-back can only comment a finding inline on a diff line; a
 * line-less finding used to stay in the summary's count, never on the diff
 * (about a quarter of the benchmark's findings). Every finding quotes one
 * line verbatim as its evidence, so that quote anchors it:
 *
 *   1. `evidence` — exactly one ADDED line of the finding's file is the
 *      quote (trimmed; or the quote is the line as masked for the model,
 *      `redactForInjection`, since the model saw the masked diff);
 *   2. `hunk` — no added line is, but exactly one line of a changed hunk
 *      (a context line) is: still an exact line inside the change;
 *   3. `none` — nothing, or more than one line, matches: the finding stays
 *      line-less (summary only). Never a guess — a wrong line is worse than
 *      none.
 *
 * A line the model gave is kept as it is (`model`). PURE.
 */
import type { DiffFileLines } from '@/lib/diff/diff-lines'
import { redactForInjection } from '@/lib/security-scan/scan-secrets'

export type FindingAnchorMethod = 'model' | 'evidence' | 'hunk' | 'none'

export interface FindingAnchor {
  line: number | null
  method: FindingAnchorMethod
}

export interface FindingAnchorInput {
  line: number | null
  filePath: string
  /** The model's quoted line, as it returned it (not yet redacted). */
  evidence: string
}

/**
 * The anchor for one diff's findings. Each file's masked lines are computed
 * once, on first need, however many findings quote it.
 */
export function createFindingAnchor(
  files: readonly DiffFileLines[]
): (f: FindingAnchorInput) => FindingAnchor {
  const byPath = new Map(files.map(f => [f.path, f.lines]))
  const masked = new Map<string, string[]>()
  const maskedOf = (path: string): string[] => {
    let m = masked.get(path)
    if (!m) {
      m = (byPath.get(path) ?? []).map(l => redactForInjection(l.text).text)
      masked.set(path, m)
    }
    return m
  }

  return f => {
    if (f.line !== null) return { line: f.line, method: 'model' }
    const quote = f.evidence.trim()
    const lines = byPath.get(f.filePath)
    if (quote.length === 0 || !lines) return { line: null, method: 'none' }
    const raw = lines.filter(l => l.text.trim() === quote)
    const hits =
      raw.length > 0
        ? raw
        : lines.filter((_, i) => maskedOf(f.filePath)[i]!.trim() === quote)
    const added = hits.filter(l => l.added)
    if (added.length === 1)
      return { line: added[0]!.lineNo, method: 'evidence' }
    if (added.length === 0 && hits.length === 1)
      return { line: hits[0]!.lineNo, method: 'hunk' }
    return { line: null, method: 'none' }
  }
}
