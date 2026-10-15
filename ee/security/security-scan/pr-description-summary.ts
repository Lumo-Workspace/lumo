/**
 * LUM-1151 — the high-level summary Lumo writes into a PR's description.
 * PURE: the setting, the block and how it goes into the author's text.
 *
 * Where the summary goes (per repository, `.lumo.yaml`
 * `reviews.high_level_summary`):
 *  - `description` (default): a delimited block in the PR description — at
 *    the author's `@<app> summary` placeholder line when there is one,
 *    appended to the end otherwise; Lumo's summary comment then leaves it
 *    out;
 *  - `comment`: only in Lumo's summary comment (the description is never
 *    touched);
 *  - `off`: nowhere.
 *
 * Never clobber the author's text: Lumo only ever replaces its own block
 * (between the two HTML markers below) or the placeholder line, and leaves
 * every other character of the description as it was. The text inside the
 * block is the AI review's `prSummary`, already redacted and neutralised
 * (`parsePrSummary`), so it cannot carry a marker, a mention or a link.
 *
 * Dependency-free (a type import aside): the auto-review filters read
 * `stripDescriptionSummary` on the webhook path.
 */
import type { PrSummary } from './pr-summary'

export const HIGH_LEVEL_SUMMARY_MODES = [
  'description',
  'comment',
  'off',
] as const
export type HighLevelSummaryMode = (typeof HIGH_LEVEL_SUMMARY_MODES)[number]

export const DEFAULT_HIGH_LEVEL_SUMMARY: HighLevelSummaryMode = 'description'

/** A stored / read value as the domain type (anything else = the default). */
export function parseHighLevelSummary(raw: unknown): HighLevelSummaryMode {
  return typeof raw === 'string' &&
    (HIGH_LEVEL_SUMMARY_MODES as readonly string[]).includes(raw)
    ? (raw as HighLevelSummaryMode)
    : DEFAULT_HIGH_LEVEL_SUMMARY
}

/** One line per mode, for the CLI / docs. */
export const HIGH_LEVEL_SUMMARY_DESCRIPTIONS: Readonly<
  Record<HighLevelSummaryMode, string>
> = Object.freeze({
  description:
    'in the PR description (at an `@uselumo summary` line, else appended); kept in sync on every review',
  comment: "in Lumo's summary comment only; the description is never edited",
  off: 'no high-level summary',
})

export const DESCRIPTION_SUMMARY_START = '<!-- lumo:summary:start -->'
export const DESCRIPTION_SUMMARY_END = '<!-- lumo:summary:end -->'

/**
 * The block Lumo puts into the description, markers included; null when the
 * review left no usable summary (nothing is written then).
 */
export function buildDescriptionSummaryBlock(input: {
  /** The review's summary, already read with `parsePrSummary`. */
  prSummary: PrSummary | null
  headSha: string
  commitUrl?: string | null
}): string | null {
  const summary = input.prSummary
  if (!summary) return null
  const head = input.headSha.slice(0, 7)
  const parts = ['### Summary by Lumo', summary.intent]
  if (summary.changes.length > 0)
    parts.push(summary.changes.map(c => `- ${c}`).join('\n'))
  // An earlier review's summary, kept because it could not be refreshed
  // (LUM-1151): said as such, never passed off as this commit's.
  const stale =
    summary.describesSha &&
    !input.headSha.startsWith(summary.describesSha) &&
    !summary.describesSha.startsWith(input.headSha)
  parts.push(
    stale
      ? `<sub>Written by Lumo for ${summary.describesSha!.slice(0, 7)}; Lumo could not refresh it for ${head} and will on the next review — edit outside this section.</sub>`
      : `<sub>Written by Lumo for ${input.commitUrl ? `[${head}](${input.commitUrl})` : head} and refreshed on every review — edit outside this section.</sub>`
  )
  return [
    DESCRIPTION_SUMMARY_START,
    parts.join('\n\n'),
    DESCRIPTION_SUMMARY_END,
  ].join('\n')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface Line {
  /** Offset of the line's first character in the body. */
  start: number
  /** Offset just past its last character (before the line break). */
  end: number
  text: string
}

function linesOf(body: string): Line[] {
  const out: Line[] = []
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const text = m[1] ?? ''
    out.push({ start: m.index, end: m.index + text.length, text })
    if ((m[2] ?? '') === '') break
  }
  return out
}

/**
 * Where Lumo's block sits: the first end marker and the NEAREST start
 * marker before it, outside code fences. Null when there is no complete
 * block. Nearest, not first: a start marker orphaned by an author edit
 * (its end deleted) must never pull the author's text after it into the
 * block that the next sync replaces.
 */
function findBlock(body: string): { start: number; end: number } | null {
  let fenced = false
  let start: number | null = null
  for (const line of linesOf(body)) {
    const t = line.text.trim()
    if (/^(```|~~~)/.test(t)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (t === DESCRIPTION_SUMMARY_START) start = line.start
    else if (t === DESCRIPTION_SUMMARY_END && start !== null)
      return { start, end: line.end }
  }
  return null
}

/**
 * The author's placeholder: a line that is only `@<app> summary` (any case,
 * `@<app>[bot]` too), outside code fences and `>` quotes. Null when none.
 */
function findPlaceholder(
  body: string,
  handle: string | null
): { start: number; end: number } | null {
  if (!handle) return null
  const placeholder = new RegExp(
    `^${escapeRegExp(handle)}(?:\\[bot\\])?\\s+summary$`,
    'i'
  )
  let fenced = false
  for (const line of linesOf(body)) {
    const t = line.text.trim()
    if (/^(```|~~~)/.test(t)) {
      fenced = !fenced
      continue
    }
    if (fenced || t.startsWith('>')) continue
    if (placeholder.test(t)) return { start: line.start, end: line.end }
  }
  return null
}

/** Does the description carry an `@<app> summary` placeholder line? */
export function hasSummaryPlaceholder(
  body: string | null | undefined,
  handle: string | null
): boolean {
  return body ? findPlaceholder(body, handle) !== null : false
}

/**
 * PURE — the description with Lumo's block in it: the existing block is
 * replaced in place; else the placeholder line is; else the block is
 * appended after a blank line. Every other character is kept as it was.
 */
export function applyDescriptionSummary(
  body: string | null | undefined,
  block: string,
  handle: string | null
): string {
  const text = body ?? ''
  const slot = findBlock(text) ?? findPlaceholder(text, handle)
  if (slot) return text.slice(0, slot.start) + block + text.slice(slot.end)
  if (text.trim().length === 0) return block
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  // One blank line between the author's text and the block.
  const gap = /(\r\n|\n|\r)$/.test(text) ? eol : `${eol}${eol}`
  return `${text}${gap}${block}`
}

/**
 * The description without Lumo's block — the author's own text, for
 * anything that reads the description as the author's (the auto-review
 * description keyword, the `ignore` directive).
 */
export function stripDescriptionSummary(
  body: string | null | undefined
): string | null {
  if (body === null || body === undefined) return null
  const slot = findBlock(body)
  return slot ? body.slice(0, slot.start) + body.slice(slot.end) : body
}

/**
 * The author's own description: Lumo's block and the `@<app> summary`
 * placeholder line removed. What a check of the description (LUM-1148
 * pre-merge checks) reads.
 */
export function authoredDescription(
  body: string | null | undefined,
  handle: string | null
): string {
  let text = stripDescriptionSummary(body) ?? ''
  for (let slot = findPlaceholder(text, handle); slot; ) {
    text = text.slice(0, slot.start) + text.slice(slot.end)
    slot = findPlaceholder(text, handle)
  }
  return text
}

/**
 * Do two versions of a description differ in the author's text? Lumo's
 * own edits (its block written, refreshed or put at the placeholder) and
 * whitespace-only changes do not count — so an edit Lumo made re-runs
 * nothing.
 */
export function authoredDescriptionChanged(
  before: string | null | undefined,
  after: string | null | undefined,
  handle: string | null
): boolean {
  const norm = (b: string | null | undefined) =>
    authoredDescription(b, handle).replace(/\s+/g, ' ').trim()
  return norm(before) !== norm(after)
}
