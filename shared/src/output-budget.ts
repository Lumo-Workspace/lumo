/**
 * LUM-428 — output-token budget for agent-facing CLI stdout.
 *
 * Anthropic's "Writing effective tools for AI agents" + "Effective context
 * engineering": a tool's response is a contract that spends from the agent's
 * context budget, and Claude Code defaults to truncating a tool result to
 * 25,000 tokens. Lumo's agent-facing commands (`task comments list`,
 * `task context`, `doc show`, …) print straight into that budget, so a single
 * fat comment thread / huge doc must not be allowed to blow it.
 *
 * This module is the CLI-side primitive: a token estimate, the budget anchor,
 * and two cappers that truncate to the budget and append a *lightweight
 * fetch-more pointer* — a just-in-time identifier telling the agent how to pull
 * the rest on demand instead of receiving it all up front.
 *
 * It lives in `shared/` (not the app's `lib/context/budget.ts`) because the CLI
 * imports `shared/` and never the app `lib/`. It is deliberately decoupled from
 * the LUM-402 *injection-side* budget (session-start additionalContext): that
 * one allocates the context window; this one caps command stdout.
 */

/**
 * Rough token estimate: char-count / 4, rounded up. Stable proxy that avoids a
 * tokenizer dependency — the same heuristic the canonical injection-side budget
 * (`lib/context/budget.ts`) uses, duplicated here only because `shared/` must
 * stay free of any app-`lib/` import.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Default per-command output ceiling for agent-facing CLI stdout, in tokens.
 * Anchored to Anthropic's published Claude Code default (tool results truncated
 * to 25,000 tokens). Generous on purpose: normal outputs sit far below it, so
 * the cap only ever engages on a pathological input (a thousand-comment thread,
 * a book-length doc) — exactly the case that would otherwise silently swallow
 * the agent's whole budget.
 */
export const OUTPUT_TOKEN_BUDGET = 25_000

/**
 * Chars reserved for the appended pointer line so the final string (body +
 * pointer) still fits the budget. Comfortably larger than any pointer this
 * module builds.
 */
const POINTER_RESERVE_CHARS = 320

export interface CapResult {
  /** The output to print: full text if it fit, otherwise body + pointer line. */
  text: string
  /** Whether the output was truncated. */
  truncated: boolean
  /** Repeatable units (lines / comments / …) kept. */
  shownUnits: number
  /** Repeatable units dropped (0 when not truncated). */
  omittedUnits: number
}

function buildPointer(
  omitted: number,
  unitNoun: string,
  maxTokens: number,
  fetchHint: string
): string {
  return (
    `… +${omitted.toLocaleString('en-US')} more ${unitNoun} not shown ` +
    `(output capped at ${maxTokens.toLocaleString('en-US')} tokens) — ${fetchHint}`
  )
}

export interface TruncateUnitsParams {
  /** Per-unit rendered strings, in keep-priority order (front kept first). */
  units: string[]
  /** Token ceiling for the kept output. Defaults to OUTPUT_TOKEN_BUDGET. */
  maxTokens?: number | undefined
  /** Plural noun for the omitted count in the pointer, e.g. "comments". */
  unitNoun: string
  /** Lightweight fetch-more pointer (how the agent pulls the rest). */
  fetchHint: string
  /** Separator joining units (default "\n\n"). */
  separator?: string
}

/**
 * Truncate an explicit list of repeatable units (e.g. one comment each) to the
 * budget, appending the fetch-more pointer when anything is dropped. Always
 * keeps at least one unit so the output is never just a pointer. The returned
 * `text` is guaranteed to estimate at or under `maxTokens`.
 */
export function truncateUnitsToBudget(params: TruncateUnitsParams): CapResult {
  const maxTokens = params.maxTokens ?? OUTPUT_TOKEN_BUDGET
  const separator = params.separator ?? '\n\n'
  const { units, unitNoun, fetchHint } = params

  const full = units.join(separator)
  if (units.length === 0 || estimateTokens(full) <= maxTokens) {
    return {
      text: full,
      truncated: false,
      shownUnits: units.length,
      omittedUnits: 0,
    }
  }

  const charBudget = Math.max(0, maxTokens * 4 - POINTER_RESERVE_CHARS)
  const kept: string[] = []
  let used = 0
  for (const unit of units) {
    const add = (kept.length === 0 ? 0 : separator.length) + unit.length
    if (kept.length > 0 && used + add > charBudget) break
    kept.push(unit)
    used += add
    if (used >= charBudget) break
  }

  let body = kept.join(separator)
  // A single oversized leading unit can still bust the budget — hard-slice it.
  if (body.length > charBudget) body = body.slice(0, charBudget)
  const omitted = units.length - kept.length
  const pointer = buildPointer(omitted, unitNoun, maxTokens, fetchHint)
  return {
    text: `${body}${separator}${pointer}`,
    truncated: true,
    shownUnits: kept.length,
    omittedUnits: omitted,
  }
}

export interface CapTextOptions {
  /** Token ceiling for the kept output. Defaults to OUTPUT_TOKEN_BUDGET. */
  maxTokens?: number | undefined
  /** Lightweight fetch-more pointer (how the agent pulls the rest). */
  fetchHint: string
  /** Plural noun for the omitted count in the pointer (default "lines"). */
  unitNoun?: string | undefined
}

/**
 * Cap an already-rendered multi-line string to the budget at a line boundary,
 * appending the fetch-more pointer when truncated. For commands that assemble a
 * single body (a doc render, the task-context handoff) rather than an explicit
 * unit list. The returned `text` estimates at or under `maxTokens`.
 */
export function capRenderedOutput(
  text: string,
  opts: CapTextOptions
): CapResult {
  const maxTokens = opts.maxTokens ?? OUTPUT_TOKEN_BUDGET
  const unitNoun = opts.unitNoun ?? 'lines'
  if (estimateTokens(text) <= maxTokens) {
    return { text, truncated: false, shownUnits: 0, omittedUnits: 0 }
  }

  const charBudget = Math.max(0, maxTokens * 4 - POINTER_RESERVE_CHARS)
  // Fill the budget with a hard char-slice (so a single very long line is
  // sliced, not dropped wholesale), then back up to a line boundary when one
  // sits in the kept tail — keeps the output from ending mid-line.
  let body = text.slice(0, charBudget)
  const lastNewline = body.lastIndexOf('\n')
  if (lastNewline > charBudget / 2) body = body.slice(0, lastNewline)

  const totalLines = text.split('\n').length
  const keptLines = body.length === 0 ? 0 : body.split('\n').length
  const omitted = Math.max(0, totalLines - keptLines)
  const pointer = buildPointer(omitted, unitNoun, maxTokens, opts.fetchHint)
  return {
    text: `${body}\n\n${pointer}`,
    truncated: true,
    shownUnits: keptLines,
    omittedUnits: omitted,
  }
}
