/**
 * `push-target` (LUM-772): compiler-derived, never emitted by the model — the
 * value is a comma-separated list of branch names and the predicate matches a
 * `git push` whose own destination is one of them (lib/boundary-crossing/
 * push-target-match). Replaces the target-blind `cmd-substr: "git push"` a
 * "never push to main" rule used to compile to.
 */
export type PredicateType =
  | 'path-glob'
  | 'cmd-substr'
  | 'diff-regex'
  | 'push-target'

export interface RulePredicate {
  type: PredicateType
  value: string
}

export interface PolicyRule {
  id: string // stable id (hash of text) for policyRuleRef + weakening diff
  text: string
  kind: 'action' | 'code'
  tier: 'deterministic' | 'semantic'
  mappedCategory?: string // existing BoundaryCrossingCategory name (built-in)
  predicate?: RulePredicate
  assertion?: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  blocking: boolean // true only when mappedCategory set (v1)
}

/**
 * What the LLM compiler emits for one rule, before the service's deterministic
 * post-processing assigns ids and applies the safety nets (LUM-770 obligation
 * guard, LUM-772 push-target rewrite). A stored `PolicyRule` is assignable to
 * it, so a stored policy can be re-run through the current post-processing
 * without a model call (the LUM-772 backfill does exactly that).
 */
export interface RawPolicyRule {
  text: string
  kind: 'action' | 'code'
  tier: 'deterministic' | 'semantic'
  mappedCategory?: string | undefined
  predicate?: RulePredicate | undefined
  assertion?: string | undefined
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  blocking: boolean
  polarity?: 'forbid' | 'require' | undefined
}

export interface CompiledPolicy {
  sourceHash: string
  rules: PolicyRule[]
}
