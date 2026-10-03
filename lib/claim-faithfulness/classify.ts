import { withTimeout } from '@/lib/boundary-crossing/judge-timeout'
import { truncateDiff } from './diff-oracle'
import { prefilterClaim } from './prefilter'
import type { ClaimFaithfulnessResult, ClaimJudge, TaskDelivery } from './types'

const DEFAULT_TIMEOUT = 20_000

export async function classifyClaimFaithfulness(
  input: {
    claim: string | null
    delivery: TaskDelivery | null
  },
  deps: { judge?: ClaimJudge; timeoutMs?: number } = {}
): Promise<ClaimFaithfulnessResult> {
  const { claim, delivery } = input
  const diffScope = delivery?.prNumbers.length ?? 0

  if (!delivery || !claim) {
    return {
      verdict: 'UNJUDGEABLE',
      evidence: [],
      diffScope,
      prefilterSignal: null,
      reasoning: !delivery ? 'no merged delivery found' : 'no claim snapshot',
    }
  }

  const prefilterSignal = prefilterClaim(claim, {
    additions: delivery.additions,
    deletions: delivery.deletions,
    changedFiles: delivery.changedFiles,
    diff: delivery.diff,
  })

  const judge =
    deps.judge ??
    (await import('@/lib/llm/claim-faithfulness-judge-client'))
      .judgeClaimFaithfulness

  try {
    const result = await withTimeout(
      judge({
        claim,
        diff: truncateDiff(delivery.diff),
        commitSubjects: delivery.commitSubjects,
        changedFiles: delivery.changedFiles,
      }),
      deps.timeoutMs ?? DEFAULT_TIMEOUT
    )
    return { ...result, prefilterSignal, diffScope }
  } catch (err) {
    return {
      verdict: 'UNJUDGEABLE',
      evidence: [],
      prefilterSignal,
      diffScope,
      reasoning: `judge error: ${(err as Error).message}`,
    }
  }
}
