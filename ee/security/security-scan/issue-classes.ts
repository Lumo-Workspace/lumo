/**
 * PURE — LUM-1200: the issue classes the two LLM layers' rule ids stand for,
 * shared by the cross-layer grouping (`issue-groups.ts`) and the same-issue
 * match (`finding-successor.ts`).
 */
import { REVIEW_KINDS } from '@/ee/security/security-scan/review-kinds'

/** The AI review kinds that the hunt's `injection` category covers (CWE-74 family). */
const INJECTION_KINDS = [
  'sql_injection',
  'command_injection',
  'xss',
  'path_traversal',
  'unsafe_eval',
] as const

/**
 * Hunt category → the AI review kinds it describes. Every category is listed
 * (`HUNT_CATEGORIES`, enforced by the test): `prompt_injection` has no AI
 * review kind, so it is a class of its own.
 */
const HUNT_CATEGORY_CLASSES: Readonly<Record<string, readonly string[]>> = {
  injection: INJECTION_KINDS,
  ssrf: ['ssrf', 'open_redirect'],
  idor: ['authz_logic', 'auth_bypass'],
  race: ['concurrency'],
  logic: ['logic_error', 'authz_logic', 'auth_bypass'],
  prompt_injection: ['prompt_injection'],
}

/**
 * Hunt categories broad enough to describe any AI review kind. Production
 * (probe PR 60): `hunt:logic` reported Math.random session tokens
 * (`vuln:weak_crypto`), an unvalidated JSON.parse (`review:data_integrity`)
 * and a prototype lookup (`review:logic_error`). Beyond its own kinds such a
 * category matches only with a similar title (`classMatch` → `broad`).
 */
const BROAD_HUNT_CATEGORIES: ReadonlySet<string> = new Set(['logic'])

const NO_CLASS: ReadonlySet<string> = new Set()

const REVIEW_KIND_SET: ReadonlySet<string> = new Set(REVIEW_KINDS)

/**
 * The issue classes a rule id stands for, in the AI review's kind
 * vocabulary. Only the two LLM layers have one — security (`vuln:`) and
 * correctness (`review:`) kinds alike; secrets and external-tool rules are
 * never grouped. An unknown hunt category is a class of its own.
 */
export function issueClasses(ruleId: string): ReadonlySet<string> {
  if (ruleId.startsWith('vuln:') || ruleId.startsWith('review:')) {
    const kind = ruleId.slice(ruleId.indexOf(':') + 1)
    return REVIEW_KIND_SET.has(kind) ? new Set([kind]) : new Set([ruleId])
  }
  if (ruleId.startsWith('hunt:')) {
    const category = ruleId.slice(5)
    return new Set(HUNT_CATEGORY_CLASSES[category] ?? [`hunt:${category}`])
  }
  return NO_CLASS
}

function isBroad(ruleId: string): boolean {
  return (
    ruleId.startsWith('hunt:') && BROAD_HUNT_CATEGORIES.has(ruleId.slice(5))
  )
}

/**
 * How two rule ids' classes relate: `exact` — they overlap (the same kind of
 * issue); `broad` — one is a broad hunt category and the other has a class
 * (the same issue only with a similar title); null — unrelated.
 */
export function classMatch(a: string, b: string): 'exact' | 'broad' | null {
  const ca = issueClasses(a)
  const cb = issueClasses(b)
  if (ca.size === 0 || cb.size === 0) return null
  for (const x of ca) if (cb.has(x)) return 'exact'
  return isBroad(a) || isBroad(b) ? 'broad' : null
}
