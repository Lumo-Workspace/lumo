export type PredicateType = 'path-glob' | 'cmd-substr' | 'diff-regex'

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

export interface CompiledPolicy {
  sourceHash: string
  rules: PolicyRule[]
}
