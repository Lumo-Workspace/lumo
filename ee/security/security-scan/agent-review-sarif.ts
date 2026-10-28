/**
 * LUM-1333 — what an imported agent review's rule ids become, by kind, before
 * the SARIF enters the ingest. PURE.
 *
 * - `bug` (a code review): every rule is one of the AI review's bug kinds
 *   (`logic-error` → `logic_error`; anything else → `logic_error`), under the
 *   `bug:` segment, so the rows are `ext:<agent>:bug:<kind>`, CORRECTNESS,
 *   tagged `[BUG]` and grouped with Lumo's own `review:<kind>` threads. A
 *   result with no snippet keys its fingerprint on its message, so two bugs
 *   of one kind in one file stay two rows.
 * - `security`: rule ids are kept, except that one starting with `bug:` is
 *   renamed (`bug-…`) — that segment is reserved for imported bugs.
 */
import {
  BUG_KINDS,
  type BugKind,
} from '@/ee/security/security-scan/review-kinds'
import {
  AGENT_BUG_RULE_SEGMENT,
  type AgentReviewKind,
} from '@/shared/src/security-scan'

const BUG_KIND_SET: ReadonlySet<string> = new Set(BUG_KINDS)
const FALLBACK_BUG_KIND: BugKind = 'logic_error'

/** The AI review bug kind a rule id names, or `logic_error`. */
export function bugKindOf(ruleId: string): BugKind {
  const kind = ruleId
    .trim()
    .toLowerCase()
    .replace(/^bug:/, '')
    .replace(/[\s-]+/g, '_')
  return BUG_KIND_SET.has(kind) ? (kind as BugKind) : FALLBACK_BUG_KIND
}

type Json = Record<string, unknown>

const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function renameRule(ruleId: unknown, kind: AgentReviewKind): unknown {
  if (typeof ruleId !== 'string') return ruleId
  if (kind === 'bug') return `${AGENT_BUG_RULE_SEGMENT}${bugKindOf(ruleId)}`
  return ruleId.startsWith(AGENT_BUG_RULE_SEGMENT)
    ? `bug-${ruleId.slice(AGENT_BUG_RULE_SEGMENT.length)}`
    : ruleId
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
  if (typeof obj(region['snippet'])['text'] === 'string') return result
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
        const renamed = {
          ...result,
          ruleId: renameRule(result['ruleId'], kind),
        }
        return kind === 'bug' ? withMessageSnippet(renamed) : renamed
      })
      return {
        ...run,
        tool: { ...tool, driver: { ...driver, rules } },
        results,
      }
    }),
  }
}
