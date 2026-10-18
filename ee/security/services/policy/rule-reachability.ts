/**
 * LUM-1114 — does any detector ever check this compiled rule?
 *
 * A rule is stored per project, but only some shapes have a consumer:
 *  - action + deterministic + cmd-substr / push-target / path-delete →
 *    project action rules
 *    (crossing-detectors `detectProjectActionCrossings`);
 *  - code + deterministic + diff-regex → code pipeline, deterministic pass;
 *  - code + semantic + assertion → code pipeline, semantic judge (only while
 *    the workspace's AI review switch is on);
 *  - deterministic path-glob mapped to SENSITIVE_PATH_EDIT / _READ → the
 *    sensitive-path detectors (policy-rule-paths);
 *  - mapped to a built-in category → the built-in detector runs regardless.
 * Anything else is compiled, stored and never evaluated — the customer's rule
 * silently protects nothing. Pure; mirrors the consumers' own filters.
 */
import type { PolicyRule } from './types'

export type RuleReach =
  | 'action-predicate'
  | 'code-diff-regex'
  | 'code-judge'
  | 'sensitive-path'
  | 'builtin'
  | 'unchecked'

const SENSITIVE_PATH = new Set(['SENSITIVE_PATH_EDIT', 'SENSITIVE_PATH_READ'])

export function ruleReach(
  rule: PolicyRule,
  builtinCategories: ReadonlySet<string>
): RuleReach {
  const p = rule.predicate
  if (
    rule.kind === 'action' &&
    rule.tier === 'deterministic' &&
    (p?.type === 'cmd-substr' ||
      p?.type === 'push-target' ||
      p?.type === 'path-delete')
  )
    return 'action-predicate'
  if (
    rule.kind === 'code' &&
    rule.tier === 'deterministic' &&
    p?.type === 'diff-regex'
  )
    return 'code-diff-regex'
  if (rule.kind === 'code' && rule.tier === 'semantic' && rule.assertion)
    return 'code-judge'
  if (
    rule.tier === 'deterministic' &&
    p?.type === 'path-glob' &&
    SENSITIVE_PATH.has(rule.mappedCategory ?? '')
  )
    return 'sensitive-path'
  if (rule.mappedCategory && builtinCategories.has(rule.mappedCategory))
    return 'builtin'
  return 'unchecked'
}
