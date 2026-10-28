/**
 * LUM-740 — the workspace security policy table (spec §6 L5).
 *
 * `Workspace.securityPolicy` says which { provenance, severity } pairs block
 * DONE. `null` (or anything unparsable) is the LUM-732 default: only an
 * undispositioned DETERMINISTIC HIGH blocks. LLM_JUDGE is not a legal
 * provenance here — refused by `securityPolicySchema` at the API edge and
 * dropped by `parseSecurityPolicy` at the reader — so an LLM finding can
 * never block DONE (spec §12 R2: advisory until the judge-precision data is
 * in). Pure: no I/O, no Prisma, so the gate can import it statically.
 *
 * LUM-1328: `AGENT_REVIEW` is a policy-only label (not a finding provenance)
 * for the rows a developer imported from their own Claude Code / Codex
 * review (`ext:claude-code:*` / `ext:codex:*`). Such a row blocks only when
 * the workspace lists `{ provenance: 'AGENT_REVIEW', severity }` — an owner's
 * opt-in, absent from the default — and never through an EXTERNAL_TOOL entry.
 */
import { z } from 'zod'
import {
  isAgentReviewRuleId,
  isCodeReviewFinding,
} from '@/shared/src/security-scan'

export type BlockableProvenance =
  | 'DETERMINISTIC'
  | 'EXTERNAL_TOOL'
  | 'AGENT_REVIEW'
export type PolicySeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface SecurityPolicyRule {
  provenance: BlockableProvenance
  severity: PolicySeverity
}

export interface SecurityPolicy {
  block: SecurityPolicyRule[]
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  block: [{ provenance: 'DETERMINISTIC', severity: 'HIGH' }],
}

const ruleSchema = z
  .object({
    provenance: z.enum(['DETERMINISTIC', 'EXTERNAL_TOOL', 'AGENT_REVIEW']),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  })
  .strict()

/** The API-edge shape: strict, and LLM_JUDGE is simply not an option. */
export const securityPolicySchema = z
  .object({ block: z.array(ruleSchema).max(9) })
  .strict()

/**
 * The reader: tolerant. A row nobody can parse is the default (never "nothing
 * blocks" by accident); a list is kept, minus any entry that is not a legal
 * rule — which is how a hand-edited LLM_JUDGE entry is neutralised.
 */
export function parseSecurityPolicy(json: unknown): SecurityPolicy {
  if (!json || typeof json !== 'object') return DEFAULT_SECURITY_POLICY
  const block = (json as { block?: unknown }).block
  if (!Array.isArray(block)) return DEFAULT_SECURITY_POLICY
  const rules: SecurityPolicyRule[] = []
  for (const entry of block) {
    const parsed = ruleSchema.safeParse(entry)
    if (parsed.success) rules.push(parsed.data)
  }
  // A list that names rules but none of them legal (a typo, or only
  // LLM_JUDGE) is a broken row, not a decision to block nothing.
  if (block.length > 0 && rules.length === 0) return DEFAULT_SECURITY_POLICY
  return { block: rules }
}

export interface PolicyFindingInput {
  /** LUM-1321: an imported agent review (`ext:claude-code:…`) blocks only
   *  through an `AGENT_REVIEW` policy entry (LUM-1328). */
  ruleId: string
  provenance: 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
  severity: PolicySeverity
  disposition: 'FALSE_POSITIVE' | 'ACCEPTED_RISK' | null
  /** LUM-738: already on the default branch — never this PR's to block on. */
  persisting?: boolean
}

/**
 * An undispositioned, non-persisting finding whose pair the policy lists —
 * never an LLM_JUDGE finding; an imported agent review only when the policy
 * opts in with an `AGENT_REVIEW` entry.
 */
export function isBlockingUnderPolicy(
  f: PolicyFindingInput,
  policy: SecurityPolicy
): boolean {
  if (f.disposition !== null || f.persisting) return false
  if (f.provenance === 'LLM_JUDGE') return false
  // LUM-1333: an imported code review's bugs are advisory, like Lumo's own.
  if (isCodeReviewFinding(f.ruleId)) return false
  const provenance = isAgentReviewRuleId(f.ruleId)
    ? 'AGENT_REVIEW'
    : f.provenance
  return policy.block.some(
    r => r.provenance === provenance && r.severity === f.severity
  )
}

/**
 * LUM-1329 — the owner's agent-review opt-in as one setting: `off`, or the
 * lowest severity that blocks (`medium` = MEDIUM and HIGH). A stored set that
 * is not one of those (e.g. MEDIUM alone, written through the raw API) reads
 * as `custom`; only `withAgentReviewBlocking` writes it back to a threshold.
 */
export const AGENT_REVIEW_BLOCKING_LEVELS = [
  'off',
  'high',
  'medium',
  'low',
] as const
export type AgentReviewBlocking = (typeof AGENT_REVIEW_BLOCKING_LEVELS)[number]
export type AgentReviewBlockingView = AgentReviewBlocking | 'custom'

/** The severities each level blocks, highest first. */
const BLOCKED_SEVERITIES: Record<AgentReviewBlocking, PolicySeverity[]> = {
  off: [],
  high: ['HIGH'],
  medium: ['HIGH', 'MEDIUM'],
  low: ['HIGH', 'MEDIUM', 'LOW'],
}

/** The agent-review setting the policy holds. */
export function agentReviewBlocking(
  policy: SecurityPolicy
): AgentReviewBlockingView {
  const listed = new Set(
    policy.block
      .filter(r => r.provenance === 'AGENT_REVIEW')
      .map(r => r.severity)
  )
  const level = AGENT_REVIEW_BLOCKING_LEVELS.find(
    l =>
      BLOCKED_SEVERITIES[l].length === listed.size &&
      BLOCKED_SEVERITIES[l].every(s => listed.has(s))
  )
  return level ?? 'custom'
}

/**
 * The policy with its `AGENT_REVIEW` entries replaced by `level`'s — every
 * other entry kept, in order, minus repeats (a pair listed twice blocks the
 * same as once; dropping them keeps the result within the schema's 9).
 */
export function withAgentReviewBlocking(
  policy: SecurityPolicy,
  level: AgentReviewBlocking
): SecurityPolicy {
  const seen = new Set<string>()
  const others = policy.block.filter(r => {
    const key = `${r.provenance}:${r.severity}`
    if (r.provenance === 'AGENT_REVIEW' || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    block: [
      ...others,
      ...BLOCKED_SEVERITIES[level].map(severity => ({
        provenance: 'AGENT_REVIEW' as const,
        severity,
      })),
    ],
  }
}
