import type { PrefilterSignal } from './types'
import { addedLinesWithNumbers } from '@/lib/security-scan/diff-lines'
import { addedControlCallIds } from '@/lib/security-scan/hunt/trigger'

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

// ── LUM-740: security-control claims ────────────────────────────────────────
//
// A claim that asserts a control was added ("added auth", "validates the
// body", "增加了鉴权与限流") while the merged diff adds no call the hunt
// layer recognises as a control. Coarse on purpose (spec §6 L5 item 7:
// "先按 diff 是否触及 control 路径做粗版"): the LLM judge still reads the
// claim; this only tags the verdict row for the audit.

const CONTROL_TERMS: RegExp[] = [
  /\bauth(?:n|z|entication|orization|oriz(?:e|es|ed|ing)|entic(?:ate|ates|ated|ating))?\b/i,
  /\bpermissions?\b/i,
  /\baccess[- ]control\b/i,
  /\bvalidat(?:e|es|ed|ing|ion)\b/i,
  /\bsanitiz(?:e|es|ed|ing|ation)\b/i,
  /\brate[- ]?limit(?:s|ed|ing)?\b/i,
  /\bthrottl(?:e|es|ed|ing)\b/i,
  /鉴权|授权|认证|权限|校验|验证|限流|节流/,
]

// "no auth changes", "without validation", "未做鉴权" — a mention that
// denies the control is not a claim of one.
const NEGATION_BEFORE =
  /(?:\b(?:no|not|without|never|non)\b[^.;,]{0,24}|(?:未|没有|没|无|不)\S{0,4})$/i

function claimsControl(claim: string): boolean {
  for (const re of CONTROL_TERMS) {
    const global = new RegExp(
      re.source,
      re.flags.includes('g') ? re.flags : re.flags + 'g'
    )
    for (const m of claim.matchAll(global)) {
      const before = claim.slice(Math.max(0, (m.index ?? 0) - 32), m.index ?? 0)
      if (!NEGATION_BEFORE.test(before)) return true
    }
  }
  return false
}

export function prefilterSecurityControlClaim(
  claim: string | null,
  diff: string
): PrefilterSignal {
  if (!claim || !claimsControl(claim)) return null
  const files = addedLinesWithNumbers(diff)
  return addedControlCallIds(files).length === 0
    ? 'SECURITY_CONTROL_CLAIM'
    : null
}

/** One signal per verdict: the LUM-463 underreport check first, then LUM-740. */
export function prefilterClaim(
  claim: string | null,
  delivery: {
    additions: number
    deletions: number
    changedFiles: string[]
    diff: string
  }
): PrefilterSignal {
  return (
    prefilterUnderreport(claim, delivery) ??
    prefilterSecurityControlClaim(claim, delivery.diff)
  )
}
