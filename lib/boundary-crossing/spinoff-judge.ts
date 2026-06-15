import { withTimeout } from '@/lib/boundary-crossing/judge-timeout'

export type SpinoffVerdict = 'LAUNDERED' | 'LEGIT'

export interface SpinoffJudgeInput {
  /** The parent task's acceptance criteria statements. */
  parentCriteria: string[]
  /** The spun-off task's title. */
  newTaskTitle: string
  /** The spun-off task's description, if any. */
  newTaskDescription: string | null
}

export type SpinoffJudge = (input: SpinoffJudgeInput) => Promise<SpinoffVerdict>

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Decide whether a `--new-scope` spinoff is laundered rework of the parent (its
 * scope falls within the parent's acceptance criteria) or genuinely new work.
 * Audit-only, pure (judge injected). Fail-safe: any error/timeout — or a parent
 * with no criteria to compare against — yields LEGIT, so legitimate work is
 * never falsely flagged.
 */
export async function classifySpinoff(
  input: SpinoffJudgeInput,
  deps: { judge: SpinoffJudge; timeoutMs?: number }
): Promise<SpinoffVerdict> {
  if (input.parentCriteria.length === 0) return 'LEGIT'
  try {
    return await withTimeout(
      deps.judge(input),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
  } catch {
    return 'LEGIT'
  }
}
