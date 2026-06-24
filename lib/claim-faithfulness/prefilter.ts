import type { PrefilterSignal } from './types'

// Negative-delivery assertions: a claim that self-reports little/no substantive
// work. Each fragment is a plain literal — no test asserts "token absent" by
// scanning this file, so there is no git-grep self-reference trap here.
const NEGATIVE_DELIVERY: RegExp[] = [
  /未改/,
  /未包含/,
  /尚未/,
  /未实现/,
  /未交付/,
  /没有改/,
  /没改/,
  /only explored/i,
  /no code change/i,
  /investigation into/i,
  /did not (include|change|modify)/i,
]

const SUBSTANTIVE_CHURN = 10

export function prefilterUnderreport(
  claim: string | null,
  stats: { additions: number; deletions: number; changedFiles: string[] }
): PrefilterSignal {
  if (!claim) return null
  const substantive = stats.additions + stats.deletions >= SUBSTANTIVE_CHURN
  if (!substantive) return null
  const negative = NEGATIVE_DELIVERY.some(re => re.test(claim))
  return negative ? 'UNDERREPORT_CANDIDATE' : null
}
