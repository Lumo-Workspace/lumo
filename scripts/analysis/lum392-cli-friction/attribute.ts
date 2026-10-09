/**
 * LUM-413: result-layer failure attribution — five classes per invocation,
 * auto-labeled from HookEvent-derived records alone (no human in the loop).
 *
 *   InfoMosaic-Bench four classes (arXiv 2510.02271):
 *     usage-error     — right tool, wrong construction/arguments
 *     selection-error — a tool that doesn't exist / wasn't the one to call
 *     invalid-result  — well-formed call, unusable result (incl. masked
 *                       failures: exit 0 with empty output, per Gorilla)
 *     valid-result    — call succeeded and the output was usable
 *   plus a fifth borrowed from WildToolBench (arXiv 2604.06185):
 *     redundant-valid — succeeded but ceremonial/redundant: status-walking
 *                       (a status write superseded by another within the
 *                       window), or an identical repeat of a call that
 *                       already succeeded
 *
 * The fifth class is what both off-the-shelf taxonomies would mislabel as
 * valid-result — LUM-392's #1 friction ("status walking") lives there.
 * Pure functions; ordering/windowing comes from the caller's records.
 */
import type { AstVerdictKind } from '../../cli-grammar/validate'

export const REDUNDANT_WINDOW_MS = 10 * 60 * 1000

export type ResultClass =
  | 'usage-error'
  | 'selection-error'
  | 'invalid-result'
  | 'valid-result'
  | 'redundant-valid'

/** The slice of an InvocationRecord the classifier needs. */
export interface AttributionInput {
  eventId: string
  createdAt: string
  commandPath: string
  known: boolean
  flags: string[]
  target: string | null
  raw: string
  errored: boolean
  errorKind: string | null
  evidence: string | null
  stdoutChars: number
  astVerdict: AstVerdictKind
  /** Offending token from the AST verdict (null for group-without-sub). */
  astOffending: string | null
}

export interface AttributionOutput {
  resultClass: ResultClass
  /** Which rule fired — keeps every label auditable in the report. */
  reason: string
  /** exit-0 invocations whose output was empty (Gorilla masked failures). */
  maskedFailure: boolean
}

/** cli-error evidence that points at input construction, not the tool. */
const INPUT_VALIDATION_RE =
  /invalid|must be|expected|missing|required|cannot|not allowed|already (exists|has)|provide at least|unknown (status|priority|category|kind|scope|role)/i

/**
 * Commands that legitimately print nothing on success — exempt from the
 * masked-failure rule. `lumo hook *` consumes stdin and stays silent by
 * design (it must not pollute the agent transcript).
 */
const SILENT_OK = (commandPath: string) => commandPath.startsWith('hook')

const STATUS_FLAGS = new Set(['--status', '-s'])

const normalizeRaw = (raw: string) => raw.replace(/\s+/g, ' ').trim()

/**
 * Classify every invocation of ONE session, in createdAt order. Session
 * scoping matters: redundancy is only judged against earlier calls of the
 * same session (and, for status-walking, later ones within the window).
 */
export function classifySession(
  records: AttributionInput[]
): AttributionOutput[] {
  const out: AttributionOutput[] = []
  for (let i = 0; i < records.length; i++) {
    out.push(classifyOne(records, i))
  }
  return out
}

function classifyOne(
  records: AttributionInput[],
  index: number
): AttributionOutput {
  const r = records[index]!

  // ---- runtime failures: the AST verdict refines WHICH failure class ----
  // Structural violations that nonetheless succeeded at run time (commander
  // enforces no enum, agents suppress stderr) are NOT failures here — they
  // surface as doc-behavior-drift findings in the report instead. The result
  // layer trusts outcomes; the AST layer judges construction.
  if (r.errored) {
    if (r.astVerdict === 'unknown-command') {
      // A hallucinated subcommand means a tool that doesn't exist was
      // selected; a bare group ("lumo task") is right tool, incomplete input.
      return r.astOffending !== null
        ? {
            resultClass: 'selection-error',
            reason: `ast:unknown-command "${r.astOffending}"`,
            maskedFailure: false,
          }
        : {
            resultClass: 'usage-error',
            reason: 'ast:group-without-subcommand',
            maskedFailure: false,
          }
    }
    if (r.astVerdict === 'unknown-flag' || r.astVerdict === 'illegal-enum') {
      return {
        resultClass: 'usage-error',
        reason: `ast:${r.astVerdict} "${r.astOffending ?? ''}"`,
        maskedFailure: false,
      }
    }
    if (r.errorKind === 'usage-error') {
      return {
        resultClass: 'usage-error',
        reason: 'output:commander-usage-error',
        maskedFailure: false,
      }
    }
    if (
      r.errorKind === 'cli-error' &&
      r.evidence &&
      INPUT_VALIDATION_RE.test(r.evidence)
    ) {
      return {
        resultClass: 'usage-error',
        reason: 'output:input-validation-error',
        maskedFailure: false,
      }
    }
    // Remaining cli errors (server/auth/network), interrupted calls and a
    // missing lumo binary all yield no usable result.
    return {
      resultClass: 'invalid-result',
      reason: `output:${r.errorKind ?? 'error'}`,
      maskedFailure: false,
    }
  }

  // ---- masked failures: exit 0, nothing on stdout ----
  if (r.stdoutChars === 0 && !SILENT_OK(r.commandPath)) {
    return {
      resultClass: 'invalid-result',
      reason: 'masked:exit0-empty-stdout',
      maskedFailure: true,
    }
  }

  // ---- redundancy (fifth class) ----
  const redundant = redundancyReason(records, index)
  if (redundant) {
    return {
      resultClass: 'redundant-valid',
      reason: redundant,
      maskedFailure: false,
    }
  }

  return { resultClass: 'valid-result', reason: 'ok', maskedFailure: false }
}

/**
 * Self-conditioning check (WildToolBench): do redundant/ceremonial calls
 * cluster in the later portion of sessions? Computes, over sessions with at
 * least `minLength` invocations, the mean normalized position (0 = first
 * call, 1 = last) of redundant-valid calls vs all other calls, and the share
 * of redundant calls landing in the late half.
 */
export function clusteringStats(
  sessionClasses: ResultClass[][],
  minLength = 5
): {
  sessions: number
  redundantCalls: number
  meanPosRedundant: number | null
  meanPosOther: number | null
  lateHalfShareRedundant: number | null
} {
  const redundant: number[] = []
  const other: number[] = []
  let sessions = 0
  for (const classes of sessionClasses) {
    if (classes.length < minLength) continue
    sessions++
    for (let i = 0; i < classes.length; i++) {
      const pos = classes.length === 1 ? 0 : i / (classes.length - 1)
      ;(classes[i] === 'redundant-valid' ? redundant : other).push(pos)
    }
  }
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length
  return {
    sessions,
    redundantCalls: redundant.length,
    meanPosRedundant: mean(redundant),
    meanPosOther: mean(other),
    lateHalfShareRedundant:
      redundant.length === 0
        ? null
        : redundant.filter(p => p > 0.5).length / redundant.length,
  }
}

function isSuccessfulStatusWrite(r: AttributionInput): boolean {
  return (
    r.commandPath === 'task update' &&
    !r.errored &&
    r.flags.some(f => STATUS_FLAGS.has(f))
  )
}

function redundancyReason(
  records: AttributionInput[],
  index: number
): string | null {
  const r = records[index]!
  const t = new Date(r.createdAt).getTime()

  // (a) status-walking: this successful status write is superseded by another
  // successful status write to the same target within the window — the
  // step-by-step walk (todo→in_progress→in_review→done) instead of one jump.
  if (isSuccessfulStatusWrite(r) && r.target) {
    for (let j = index + 1; j < records.length; j++) {
      const later = records[j]!
      const dt = new Date(later.createdAt).getTime() - t
      if (dt > REDUNDANT_WINDOW_MS) break
      if (isSuccessfulStatusWrite(later) && later.target === r.target) {
        return 'redundant:status-walk-superseded'
      }
    }
  }

  // (b) identical repeat: the same call (path + target + normalized text)
  // already succeeded earlier in this session within the window.
  const raw = normalizeRaw(r.raw)
  for (let j = index - 1; j >= 0; j--) {
    const earlier = records[j]!
    const dt = t - new Date(earlier.createdAt).getTime()
    if (dt > REDUNDANT_WINDOW_MS) break
    if (
      !earlier.errored &&
      earlier.commandPath === r.commandPath &&
      (earlier.target ?? '') === (r.target ?? '') &&
      normalizeRaw(earlier.raw) === raw
    ) {
      return 'redundant:identical-repeat'
    }
  }

  return null
}
