/**
 * `push-target` (LUM-772): compiler-derived, never emitted by the model — the
 * value is a comma-separated list of branch names and the predicate matches a
 * `git push` whose own destination is one of them (lib/boundary-crossing/
 * push-target-match). Replaces the target-blind `cmd-substr: "git push"` a
 * "never push to main" rule used to compile to.
 *
 * `path-delete` (LUM-1236): compiler-derived too — the value is a
 * comma-separated list of repository paths and the predicate matches a command
 * that deletes or moves a file under one of them (lib/boundary-crossing/
 * path-delete). Replaces the path-blind `cmd-substr: "rm"` a "never delete
 * files in <path>" rule compiled to.
 */
export type PredicateType =
  | 'path-glob'
  | 'cmd-substr'
  | 'diff-regex'
  | 'push-target'
  | 'path-delete'

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
  /**
   * LUM-1114: other rule texts of the same source that compile to this exact
   * detection (same kind, tier, category, predicate and assertion) and were
   * merged into this rule. Their ids stay resolvable — a crossing or a
   * previous policy naming one still finds this rule (`findRuleByRef`).
   */
  aliases?: PolicyRuleAlias[]
}

export interface PolicyRuleAlias {
  id: string
  text: string
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
  /** LUM-1114: present when a STORED (already de-duplicated) rule is re-run
   *  through the compiler — carried over so merged ids stay resolvable. */
  aliases?: PolicyRuleAlias[] | undefined
}

export interface CompiledPolicy {
  sourceHash: string
  rules: PolicyRule[]
}
