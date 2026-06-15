import { withTimeout } from '@/lib/boundary-crossing/judge-timeout'

export type WeakeningVerdict = 'WEAKENED' | 'EVOLVED'

export interface WeakeningPrefilter {
  /** The edited criterion's latest verdict is an unresolved FAIL. */
  hasOpenFail: boolean
  /** The edit came from an AGENT_DRAFT path (HUMAN_EDIT revisions are exempt). */
  isAgentEdit: boolean
  /** The criterion's statement actually changed. */
  statementChanged: boolean
}

export interface WeakeningJudgeInput {
  oldStatement: string
  newStatement: string
  causeTag: string | null
}

export type WeakeningJudge = (
  input: WeakeningJudgeInput
) => Promise<WeakeningVerdict>

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Only an AGENT edit that changes the statement of a criterion carrying an
 * unresolved FAIL is a weakening candidate. A human revision, an unchanged
 * statement, or a criterion that wasn't failing are all out of scope.
 */
export function isWeakeningCandidate(p: WeakeningPrefilter): boolean {
  return p.hasOpenFail && p.isAgentEdit && p.statementChanged
}

/**
 * Decide whether an edit to an open-FAIL criterion weakened it (lowered the bar
 * to dodge the failure) or legitimately evolved it. Pure (judge injected).
 * Fail-safe: error/timeout → WEAKENED — the prefilter already established
 * suspicion, so surface it for human disposition rather than let it slip.
 */
export async function classifyWeakening(
  input: WeakeningJudgeInput,
  deps: { judge: WeakeningJudge; timeoutMs?: number }
): Promise<WeakeningVerdict> {
  try {
    return await withTimeout(
      deps.judge(input),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
  } catch {
    return 'WEAKENED'
  }
}
