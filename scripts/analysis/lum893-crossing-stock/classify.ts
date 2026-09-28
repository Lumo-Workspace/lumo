/**
 * LUM-893 — PURE. Maps a stored HARDCODED_SECRET crossing `detail`
 * ("<pattern title> in <file>[ (…)]") back to its registry rule and says
 * whether the LUM-893 detector would now record it advisory.
 */
import {
  SECRET_PATTERNS,
  isCrossingAdvisoryRule,
} from '@/lib/security-scan/secret-patterns'
import { isLocalEnvFile } from '@/lib/services/boundary-detector.service'

/** Rules LUM-887 (PR 1153) added to the registry. */
export const LUM887_RULE_IDS: ReadonlySet<string> = new Set([
  'env-assignment',
  'http-authorization',
  'bearer-token',
  'cli-credential-flag',
  'stripe-clerk-test-key',
  'lumo-api-key',
  'npm-token',
  'gitlab-pat',
  'huggingface-token',
  'vercel-blob-token',
])

export interface CrossingClass {
  ruleId: string | null
  file: string | null
  lum887: boolean
  /** Would LUM-893 record this advisory? `false` = still blocking, or only a
   *  gitignore probe (not re-runnable after the fact) could tell. */
  advisoryNow: boolean
}

// Longest title first so "Bearer token" never shadows a longer title.
const TITLES = [...SECRET_PATTERNS].sort(
  (a, b) => b.title.length - a.title.length
)

export function classifyCrossingDetail(detail: string): CrossingClass {
  const p = TITLES.find(t => detail.startsWith(`${t.title} in `))
  if (!p) return { ruleId: null, file: null, lum887: false, advisoryNow: false }
  const rest = detail.slice(p.title.length + ' in '.length)
  const file = rest.replace(/ \(.*\)$/, '')
  return {
    ruleId: p.id,
    file,
    lum887: LUM887_RULE_IDS.has(p.id),
    advisoryNow: isCrossingAdvisoryRule(p.id) || isLocalEnvFile(file),
  }
}
