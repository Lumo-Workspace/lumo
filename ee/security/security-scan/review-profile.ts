/**
 * LUM-1147 — the review profile: how much of a review goes on the diff as
 * inline comments. PURE.
 *
 * The profile changes POSTING only — what the AI review and the other
 * layers detect, every finding's severity, what blocks DONE and what the
 * summary counts are the same under every profile:
 *  - `chill` (default, today's behaviour): HIGH and MEDIUM findings get an
 *    inline comment; LOW ones are one summary line.
 *  - `quiet`: only HIGH findings get an inline comment; MEDIUM ones are
 *    listed in the summary instead (folded), LOW ones stay one line.
 *  - `assertive`: LOW findings (nitpicks) get an inline comment too.
 * In every profile a finding that blocks DONE, and every HIGH finding, is
 * commented inline — a profile can never hide one. A finding the AI review
 * reported because a repository path instruction asked for it (a verified
 * `pathInstruction`) is commented inline under chill and assertive whatever
 * its severity — the owners asked for it on that path; quiet keeps it in the
 * summary like any other non-HIGH finding. A finding without a line
 * on the diff, or one suggested as a false positive, is never inline (as
 * before).
 */
import {
  isBlockingUnderPolicy,
  type PolicyFindingInput,
  type SecurityPolicy,
} from '@/ee/security/security-scan/policy'

export const REVIEW_PROFILES = ['quiet', 'chill', 'assertive'] as const
export type ReviewProfile = (typeof REVIEW_PROFILES)[number]

export const DEFAULT_REVIEW_PROFILE: ReviewProfile = 'chill'

/** A stored / read value as the domain type (anything else = the default). */
export function parseReviewProfile(raw: unknown): ReviewProfile {
  return typeof raw === 'string' &&
    (REVIEW_PROFILES as readonly string[]).includes(raw)
    ? (raw as ReviewProfile)
    : DEFAULT_REVIEW_PROFILE
}

/** One line per profile, for the CLI / settings / docs. */
export const REVIEW_PROFILE_DESCRIPTIONS: Readonly<
  Record<ReviewProfile, string>
> = Object.freeze({
  quiet:
    'only HIGH and Done-blocking findings are commented inline; MEDIUM findings and path-instruction findings are listed in the summary',
  chill:
    'HIGH and MEDIUM findings, and any finding a path instruction asked for, are commented inline; other LOW findings are one summary line (default)',
  assertive: 'every finding on a changed line is commented inline, LOW too',
})

export interface ProfileFinding extends PolicyFindingInput {
  line: number | null
  suggestedDisposition?: unknown
  /** LUM-1147 — the verified path instruction glob it applies; null = none. */
  pathInstruction?: string | null
}

/** The severities a profile comments inline (before the always-inline rules). */
function profileSeverity(
  profile: ReviewProfile,
  severity: ProfileFinding['severity']
): boolean {
  if (severity === 'HIGH') return true
  if (severity === 'MEDIUM') return profile !== 'quiet'
  return profile === 'assertive'
}

/**
 * PURE — would the write-back give `f` an inline comment under `profile`
 * (ignoring the verifier / suggestion holds and the per-sync cap)?
 */
export function inlineEligibleUnder(
  profile: ReviewProfile,
  f: ProfileFinding,
  policy: SecurityPolicy
): boolean {
  if (f.line === null || f.suggestedDisposition != null) return false
  return (
    profileSeverity(profile, f.severity) ||
    (profile !== 'quiet' && !!f.pathInstruction) ||
    isBlockingUnderPolicy(f, policy)
  )
}

/**
 * PURE — open findings the profile keeps OFF the diff that chill would
 * have commented (quiet's MEDIUM findings): the summary lists them so they
 * are grouped there, not lost.
 */
export function heldByProfile(
  profile: ReviewProfile,
  f: ProfileFinding,
  policy: SecurityPolicy
): boolean {
  return (
    !inlineEligibleUnder(profile, f, policy) &&
    inlineEligibleUnder(DEFAULT_REVIEW_PROFILE, f, policy)
  )
}
