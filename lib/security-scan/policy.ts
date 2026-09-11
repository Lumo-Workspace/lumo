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
 */
import { z } from 'zod'

export type BlockableProvenance = 'DETERMINISTIC' | 'EXTERNAL_TOOL'
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
    provenance: z.enum(['DETERMINISTIC', 'EXTERNAL_TOOL']),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  })
  .strict()

/** The API-edge shape: strict, and LLM_JUDGE is simply not an option. */
export const securityPolicySchema = z
  .object({ block: z.array(ruleSchema).max(6) })
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
  provenance: 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
  severity: PolicySeverity
  disposition: 'FALSE_POSITIVE' | 'ACCEPTED_RISK' | null
  /** LUM-738: already on the default branch — never this PR's to block on. */
  persisting?: boolean
}

/** An undispositioned, non-persisting finding whose pair the policy lists. */
export function isBlockingUnderPolicy(
  f: PolicyFindingInput,
  policy: SecurityPolicy
): boolean {
  if (f.disposition !== null || f.persisting) return false
  if (f.provenance === 'LLM_JUDGE') return false
  return policy.block.some(
    r => r.provenance === f.provenance && r.severity === f.severity
  )
}
