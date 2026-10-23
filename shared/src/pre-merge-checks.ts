/** Privacy-filtered, commit-scoped pre-merge results shared by UI and CLI. */
export interface PreMergeCheckView {
  id: string
  name: string
  mode: 'warning' | 'error'
  verdict: 'passed' | 'failed' | 'inconclusive' | 'not_applicable'
  explanation: string
  resolution: string | null
  requirements?: Array<{
    id: string
    label: string
    outcome: 'addressed' | 'not_addressed' | 'unclear'
    quotable: boolean
    text: string | null
    explanation: string
  }>
}

export function nonPassingChecks(
  checks: readonly PreMergeCheckView[] | undefined
): PreMergeCheckView[] {
  return (checks ?? []).filter(
    c => c.verdict === 'failed' || c.verdict === 'inconclusive'
  )
}
