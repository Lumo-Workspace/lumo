import { checksForHead } from './pre-merge-checks'
import type { PreMergeCheckView } from '@/shared/src/pre-merge-checks'

/** Never publish another commit's checks or non-quotable requirement prose. */
export function preMergeChecksView(
  raw: unknown,
  headSha: string
): PreMergeCheckView[] {
  return (checksForHead(raw, headSha)?.results ?? []).map(check => ({
    id: check.id,
    name: check.name,
    mode: check.mode,
    verdict: check.verdict,
    explanation: check.explanation,
    resolution: check.resolution,
    ...(check.requirements
      ? {
          requirements: check.requirements.map(r => ({
            id: r.id,
            label: r.label,
            outcome: r.outcome,
            quotable: r.quotable,
            text: r.quotable ? r.text : null,
            explanation: r.quotable ? r.explanation : '',
          })),
        }
      : {}),
  }))
}
