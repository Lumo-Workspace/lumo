/**
 * LUM-1060 — the policy rule types moved to the core (`lib/policy/types`):
 * the core rejudge and boundary detector read `PolicyRule`. This re-export
 * keeps the plugin-side importers unchanged until they move with the plugin
 * (RFC LUM-1058 §7 PR6). Core files import `@/lib/policy/types` directly.
 */
export type {
  PredicateType,
  RulePredicate,
  PolicyRule,
  RawPolicyRule,
  CompiledPolicy,
} from '@/lib/policy/types'
