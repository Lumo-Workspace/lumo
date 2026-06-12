/**
 * LUM-463 Stage 2 — orchestrates the deterministic pre-filter (Stage 1) with the
 * best-effort LLM judge, producing the final downgrade-vs-flag classification.
 *
 * Discipline (the locked red lines):
 *   - cost-bounded: the LLM judge is invoked ONLY on the ambiguous residual the
 *     pre-filter could not decide; a clear LEGIT/WEAKENING pre-filter verdict
 *     short-circuits with NO judge call (criterion 2).
 *   - conservative / observe-only: if the judge throws or times out, the result
 *     is WEAKENING (the safe, flagging direction) — a possible weakening is never
 *     silently suppressed by a failed or uncertain judge (criterion 3).
 *   - the judge only ever DOWNGRADES or FLAGS; it never hard-clears a crossing
 *     and never sets a human disposition (LUM-435/422 stay the final arbiter).
 */

export type JudgeVerdict = 'LEGIT' | 'WEAKENING'

/** What the judge sees: the test diff, the co-changed code diff, the spec. */
export interface JudgeInput {
  testDiff: string
  codeDiff: string | null
  criterion: string
}

/** Abstraction over the LLM call (DIP) — injected so tests never hit the model. */
export type TamperingJudge = (input: JudgeInput) => Promise<JudgeVerdict>

export interface ClassifyDeps {
  judge: TamperingJudge
  /** Best-effort timeout for the judge; on expiry the result is WEAKENING. */
  timeoutMs?: number
}

export interface ClassifyResult {
  /** LEGIT → downgrade (still recorded, lower severity); WEAKENING → flag. */
  outcome: JudgeVerdict
  /** Which stage decided: pre-filter, the LLM, or the conservative fallback. */
  stage: 'PREFILTER' | 'LLM' | 'FALLBACK'
}

import {
  classifyTestTamperingPrefilter,
  type PrefilterInput,
} from './test-tampering-prefilter'
// Shared best-effort timeout — the SAME primitive the LUM-466 action-category
// confirmation reuses, so both judges share one exit-0 guarantee.
import { withTimeout } from './judge-timeout'

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Classify a TEST_TAMPERING edit as a downgrade (LEGIT) or a flag (WEAKENING).
 * The pre-filter decides the clear cases for free; only the ambiguous residual
 * reaches the LLM, and any judge failure falls back to WEAKENING.
 */
export async function classifyTestTampering(
  prefilter: PrefilterInput,
  judgeInput: JudgeInput,
  deps: ClassifyDeps
): Promise<ClassifyResult> {
  const pre = classifyTestTamperingPrefilter(prefilter)
  if (pre === 'LEGIT') return { outcome: 'LEGIT', stage: 'PREFILTER' }
  if (pre === 'WEAKENING') return { outcome: 'WEAKENING', stage: 'PREFILTER' }

  // AMBIGUOUS → Stage 2. Best-effort: any failure/timeout keeps it flagged.
  try {
    const verdict = await withTimeout(
      deps.judge(judgeInput),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
    return { outcome: verdict, stage: 'LLM' }
  } catch {
    return { outcome: 'WEAKENING', stage: 'FALLBACK' }
  }
}
