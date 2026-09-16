/**
 * LUM-798 — placing a candidate's symbols IN THE REPOSITORY, which is a
 * different question from placing them in the verification subgraph.
 *
 * Production forensics (129 hunt scans, 12M tokens, 23 candidates, 0
 * findings): every single candidate died on `symbol-not-in-subgraph`, so no
 * other mechanical check — and no falsifier — ever ran. The rejections were
 * not disagreements about the code, they were disagreements about NAMING:
 *
 *   - a library callee (`generateText`, `writeFileSync`, `exec`) can never
 *     have a `<file>#<name>` id, yet those are exactly the categories
 *     `SINK_RULES` exists to recognise;
 *   - the subgraph indexes a function at its DEFINITION site while the agent
 *     names it at the CALL site (`…/finding-disposition.ts#insideAgentSession@182`
 *     vs `…/agent-env-guard.ts#insideAgentSession`);
 *   - a symbol that is plainly in the repo is still absent from the ≤40-file
 *     window the graph was built from.
 *
 * So this module answers the two cheaper questions the gate should have been
 * asking: does the name match a sink RULE, and does the file:line the
 * candidate itself named really carry that identifier. Pure — the sighting
 * pass runs where the checkout's source is already in hand (no second read).
 */
import {
  ENTRY_RULES,
  NEW_EXPRESSION_SINKS,
  SINK_RULES,
  matchCallRule,
  type CallRule,
  type EntryRule,
} from '../graph/patterns'

/** One `file:line` the candidate claims a symbol lives at. */
export interface SymbolRef {
  symbol: string
  file: string
  line: number
}

/**
 * A call expression may be written across lines, and a model reporting the
 * line of the opening paren instead of the callee is a formatting quibble,
 * not a hallucination. Two lines either side is enough for prettier's wrap
 * and small enough that the name still has to be at the named site.
 */
export const SIGHTING_LINE_WINDOW = 2

/**
 * The name inside a symbol id. Grammar (see `graph/types.ts`):
 *   `<file>#<name>` · `<file>#<callee>@<line>` · a bare name the agent wrote.
 */
export function symbolNameOf(id: string): string {
  const hash = id.lastIndexOf('#')
  const name = hash >= 0 ? id.slice(hash + 1) : id
  const at = name.lastIndexOf('@')
  return at > 0 && /^\d+$/.test(name.slice(at + 1)) ? name.slice(0, at) : name
}

/**
 * What to look for on the line: the name as written, and its last identifier
 * token — `documentRepository.findWithPermission` is the same sighting as
 * `findWithPermission`, because a call site may reach the method through any
 * receiver. Only the LAST token, deliberately: taking every token would let a
 * generic prefix (`process`, `db`) match any line at all, and the point of
 * the sighting is that the named line really is where the symbol is used.
 */
export function nameTokens(name: string): string[] {
  const tokens = name
    .split(/[^A-Za-z0-9_$]+/)
    .filter(t => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t))
  const last = tokens[tokens.length - 1]
  return last !== undefined && last !== name ? [name, last] : name ? [name] : []
}

function identifierMatcher(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`)
}

/**
 * Sink rules by their own id, so a candidate that names the CATEGORY
 * (`child-process`) or the node module (`child_process`) rather than the
 * callee still lands on the rule the system itself defined. Twelve of the 23
 * production rejections were this shape.
 */
const SINK_RULES_BY_ID = new Map<string, CallRule>(
  [...SINK_RULES, ...NEW_EXPRESSION_SINKS].map(r => [r.id, r])
)

/**
 * Tier (a) of the gate: the sink is a KIND of call the system already
 * recognises, so no `<file>#<name>` id is required of it. A library function
 * cannot have one, and demanding it is what made `generateText` unverifiable.
 */
export function matchSinkRule(symbol: string): CallRule | null {
  const name = symbolNameOf(symbol)
  return (
    matchCallRule(SINK_RULES, name) ??
    matchCallRule(NEW_EXPRESSION_SINKS, name) ??
    SINK_RULES_BY_ID.get(name.replace(/_/g, '-')) ??
    null
  )
}

/**
 * Whether the repo's own entry table would call this file+name an entry
 * point. Used only as a SIGNAL when the graph has no opinion: rules carrying
 * a `directive` need the file's first line, which a symbol id does not have,
 * so they never match here and their candidates stay "unconfirmed" rather
 * than being called wrong.
 */
export function matchEntryRule(file: string, name: string): EntryRule | null {
  for (const r of ENTRY_RULES) {
    if (r.directive) continue
    if (!r.file.test(file)) continue
    if (r.name && !r.name.test(name)) continue
    return r
  }
  return null
}

/** The key a sighting is recorded and looked up under. */
export function sightingKey(ref: SymbolRef): string {
  return `${ref.file}:${ref.line}:${ref.symbol}`
}

/**
 * The `file:line`s one raw submission claims. `candidates` are unvalidated
 * model output at this point (zod runs inside the gate), so every field is
 * read defensively.
 */
export function candidateSymbolRefs(raw: unknown): SymbolRef[] {
  if (!raw || typeof raw !== 'object') return []
  const c = raw as Record<string, unknown>
  const out: SymbolRef[] = []
  for (const key of ['sink', 'entry'] as const) {
    const v = c[key]
    if (!v || typeof v !== 'object') continue
    const { symbol, file, line } = v as Record<string, unknown>
    if (typeof symbol !== 'string' || symbol === '') continue
    if (typeof file !== 'string' || file === '') continue
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1)
      continue
    out.push({ symbol, file, line })
  }
  return out
}

/**
 * Tier (b): which of those claims this file's source confirms. Called once
 * per file as the verification read walks the checkout, so confirming a
 * candidate costs no extra I/O at all — the sandbox is already open and the
 * bytes are already in hand.
 */
export function sightingsInSource(
  refs: readonly SymbolRef[],
  path: string,
  source: string
): string[] {
  const mine = refs.filter(r => r.file === path)
  if (mine.length === 0) return []
  const lines = source.split('\n')
  const out: string[] = []
  for (const ref of mine) {
    const matchers = nameTokens(symbolNameOf(ref.symbol)).map(identifierMatcher)
    if (matchers.length === 0) continue
    const from = Math.max(1, ref.line - SIGHTING_LINE_WINDOW)
    const to = Math.min(lines.length, ref.line + SIGHTING_LINE_WINDOW)
    for (let i = from; i <= to; i++) {
      const text = lines[i - 1] ?? ''
      if (matchers.some(m => m.test(text))) {
        out.push(sightingKey(ref))
        break
      }
    }
  }
  return out
}
