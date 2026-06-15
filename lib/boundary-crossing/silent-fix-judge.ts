import { withTimeout } from '@/lib/boundary-crossing/judge-timeout'

export type SilentFixVerdict = 'REAL_FIX' | 'COSMETIC'

export interface SilentFixJudgeInput {
  filePath: string
  /** Best-effort summary of the edit (new content / changed strings). */
  editSummary: string
}

export type SilentFixJudge = (
  input: SilentFixJudgeInput
) => Promise<SilentFixVerdict>

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Decide whether an edit made to an already-submitted task (one that entered
 * IN_REVIEW with no recorded send-back) is a REAL_FIX of a defect — which should
 * have left a send-back trace — or a COSMETIC change (rebase / typo / docs).
 * Pure (judge injected). Fail-safe: any error/timeout → COSMETIC, so a cosmetic
 * edit is never falsely recorded as a hidden first-attempt failure.
 */
export async function classifySilentFix(
  input: SilentFixJudgeInput,
  deps: { judge: SilentFixJudge; timeoutMs?: number }
): Promise<SilentFixVerdict> {
  try {
    return await withTimeout(
      deps.judge(input),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
  } catch {
    return 'COSMETIC'
  }
}
