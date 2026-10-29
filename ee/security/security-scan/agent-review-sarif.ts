/**
 * LUM-1333 — what an imported agent review's rule ids become, by kind, before
 * the SARIF enters the ingest. PURE.
 *
 * - `bug` (a code review): every rule gets one of the AI review's bug kinds
 *   (`logic-error` → `logic_error`; anything else → `logic_error`) under the
 *   `bug:` segment — `bug:<kind>`, or `bug:<kind>:<rule>` when the agent's
 *   rule is not the kind itself, so distinct rules keep their own titles. The
 *   rows are `ext:<agent>:bug:…`, CORRECTNESS, tagged `[BUG]` and grouped
 *   with Lumo's own `review:<kind>` threads. Only results that would share a
 *   fingerprint (same rule, same file, no snippet) are keyed on their
 *   message, so two such bugs stay two rows while a lone one keeps its
 *   fingerprint when a re-run rewords it.
 * - `security`: rule ids are kept, except that one starting with `bug:` is
 *   renamed (`bug-…`) — that segment is reserved for imported bugs.
 */
import {
  BUG_KINDS,
  type BugKind,
} from '@/ee/security/security-scan/review-kinds'
import {
  AGENT_BUG_RULE_SEGMENT,
  isAgentBugRuleId,
  type AgentReviewKind,
} from '@/shared/src/security-scan'

const BUG_KIND_SET: ReadonlySet<string> = new Set(BUG_KINDS)
const FALLBACK_BUG_KIND: BugKind = 'logic_error'

const normalized = (ruleId: string): string =>
  ruleId
    .trim()
    .toLowerCase()
    .replace(/^bug:/, '')
    .replace(/[\s-]+/g, '_')

/** The AI review bug kind a rule id names, or `logic_error`. */
export function bugKindOf(ruleId: string): BugKind {
  const kind = normalized(ruleId)
  return BUG_KIND_SET.has(kind) ? (kind as BugKind) : FALLBACK_BUG_KIND
}

/**
 * The bug kind of a stored row (`ext:<agent>:bug:<kind>[:<rule>]`), or null
 * for any other rule id.
 */
export function importedBugKind(ruleId: string): BugKind | null {
  if (!isAgentBugRuleId(ruleId)) return null
  const rule = ruleId.split(':').slice(3)[0] ?? ''
  return BUG_KIND_SET.has(rule) ? (rule as BugKind) : FALLBACK_BUG_KIND
}

type Json = Record<string, unknown>

const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function renameRule(ruleId: unknown, kind: AgentReviewKind): unknown {
  if (typeof ruleId !== 'string') return ruleId
  if (kind === 'bug') {
    const bugKind = bugKindOf(ruleId)
    const rule = ruleId.trim().replace(/^bug:/i, '')
    return normalized(ruleId) === bugKind
      ? `${AGENT_BUG_RULE_SEGMENT}${bugKind}`
      : `${AGENT_BUG_RULE_SEGMENT}${bugKind}:${rule}`
  }
  return ruleId.startsWith(AGENT_BUG_RULE_SEGMENT)
    ? `bug-${ruleId.slice(AGENT_BUG_RULE_SEGMENT.length)}`
    : ruleId
}

/** The rule + file a result without a snippet is fingerprinted on; null when it has a snippet. */
function snippetlessKey(result: Json): string | null {
  const physical = obj(obj(arr(result['locations'])[0])['physicalLocation'])
  if (typeof obj(obj(physical['region'])['snippet'])['text'] === 'string')
    return null
  return `${String(result['ruleId'])}\u0000${String(obj(physical['artifactLocation'])['uri'])}`
}

/** A result whose first location has no snippet gets its message as one. */
function withMessageSnippet(result: Json): Json {
  const message = obj(result['message'])['text']
  if (typeof message !== 'string' || message === '') return result
  const locations = arr(result['locations'])
  if (locations.length === 0) return result
  const first = obj(locations[0])
  const physical = obj(first['physicalLocation'])
  const region = obj(physical['region'])
  return {
    ...result,
    locations: [
      {
        ...first,
        physicalLocation: {
          ...physical,
          region: { ...region, snippet: { text: message } },
        },
      },
      ...locations.slice(1),
    ],
  }
}

/** A copy of the SARIF with its rule ids set for an import of `kind`. */
export function agentReviewSarif(sarif: Json, kind: AgentReviewKind): Json {
  const renamed = renameRules(sarif, kind)
  if (kind !== 'bug') return renamed
  // The ingest dedupes across runs, so collisions are counted across them.
  const runs = arr(renamed['runs']).map(obj)
  const shared = new Map<string, number>()
  for (const run of runs)
    for (const result of arr(run['results'])) {
      const key = snippetlessKey(obj(result))
      if (key !== null) shared.set(key, (shared.get(key) ?? 0) + 1)
    }
  return {
    ...renamed,
    runs: runs.map(run => ({
      ...run,
      results: arr(run['results']).map(value => {
        const result = obj(value)
        const key = snippetlessKey(result)
        return key !== null && (shared.get(key) ?? 0) > 1
          ? withMessageSnippet(result)
          : result
      }),
    })),
  }
}

function renameRules(sarif: Json, kind: AgentReviewKind): Json {
  return {
    ...sarif,
    runs: arr(sarif['runs']).map(runValue => {
      const run = obj(runValue)
      const tool = obj(run['tool'])
      const driver = obj(tool['driver'])
      const rules = arr(driver['rules']).map(ruleValue => {
        const rule = obj(ruleValue)
        return { ...rule, id: renameRule(rule['id'], kind) }
      })
      const results = arr(run['results']).map(resultValue => {
        const result = obj(resultValue)
        return { ...result, ruleId: renameRule(result['ruleId'], kind) }
      })
      return {
        ...run,
        tool: { ...tool, driver: { ...driver, rules } },
        results,
      }
    }),
  }
}
