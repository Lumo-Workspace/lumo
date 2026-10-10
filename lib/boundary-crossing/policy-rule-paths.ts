/**
 * LUM-1063 — the path globs a project's compiled policy rules carry for the
 * two path-shaped built-ins, read out of the rules as data. Pure. Moved out of
 * `lib/services/boundary-detector.service.ts` (which re-exports both): the
 * core applies these globs (SENSITIVE_PATH_EDIT override) or hands them to
 * the plugin's project sensitive-read detector; the LLM compiler that
 * produces the rules is a plugin.
 */
import type { PolicyRule } from '@/lib/policy/types'

/**
 * A project's own sensitive-read path (multi-tenant extension): a
 * deterministic `path-glob` PolicyRule the compiler mapped to
 * SENSITIVE_PATH_READ from the customer's CLAUDE.md / AGENTS.md. Project
 * globs ADD to the built-in credential stores — they never replace them, so a
 * project that lists `/opt/configs/*.json` keeps `~/.ssh` covered.
 */
export interface ProjectReadRule {
  glob: string
  ruleId: string
  ruleText: string
}

/**
 * The project's own sensitive-path globs (LUM-736): deterministic `path-glob`
 * rules the policy compiler mapped to SENSITIVE_PATH_EDIT. Non-empty → they
 * REPLACE the built-in path set for that project (an override, not a union);
 * empty → the defaults apply. Pure.
 */
export function sensitivePathGlobsFromRules(rules: PolicyRule[]): string[] {
  return rules
    .filter(
      r =>
        r.tier === 'deterministic' &&
        r.mappedCategory === 'SENSITIVE_PATH_EDIT' &&
        r.predicate?.type === 'path-glob' &&
        r.predicate.value.length > 0
    )
    .map(r => (r.predicate as { value: string }).value)
}

/**
 * LUM-963 multi-tenant extension: the project's own sensitive-read paths —
 * deterministic `path-glob` rules the policy compiler mapped to
 * SENSITIVE_PATH_READ from the customer's CLAUDE.md / AGENTS.md. Unlike
 * SENSITIVE_PATH_EDIT's override, these ADD to the built-in credential stores.
 * Pure.
 */
export function sensitiveReadRulesFromRules(
  rules: PolicyRule[]
): ProjectReadRule[] {
  return rules
    .filter(
      r =>
        r.tier === 'deterministic' &&
        r.mappedCategory === 'SENSITIVE_PATH_READ' &&
        r.predicate?.type === 'path-glob' &&
        r.predicate.value.trim().length > 0
    )
    .map(r => ({
      glob: (r.predicate as { value: string }).value.trim(),
      ruleId: r.id,
      ruleText: r.text,
    }))
}
