/**
 * LUM-1068 — the core's deterministic project rule source: the list items of
 * a `## Forbidden` section in the repository's CLAUDE.md / AGENTS.md, parsed
 * without a model. Pure: no I/O, no clock.
 *
 * Why it exists: the POLICY_WEAKENING judge is core (LUM-1063, decision Q2 on
 * LUM-1058), but the rule sets it compared came only from the security
 * plugin's LLM policy compiler (stored in the plugin table `ProjectPolicy`).
 * Without the plugin no POLICY_WEAKENING was ever produced. This module gives
 * the core its own rule set; the service
 * (`lib/services/forbidden-rule-source.service.ts`) stores the previous one in
 * the core table `ForbiddenRuleSnapshot` and records what a new one removed.
 *
 * ## The format this parser accepts (anything else is ignored)
 *
 * Unclear structure is NOT guessed at: a line the parser does not recognise
 * is not a rule, so a badly formatted file can make it miss a removal, never
 * invent one.
 *
 *  - The section starts at a level-2 ATX heading whose title starts with the
 *    word "Forbidden" (any case): `## Forbidden`, `## Forbidden actions`.
 *    Not `# Forbidden`, not `### Forbidden`, not a setext (underlined)
 *    heading, not a translated title.
 *  - It ends at the next level-1 or level-2 heading, or at a thematic break
 *    (`---`, `***`, `___`). `###`+ headings inside it do not end it.
 *  - A rule is a top-level list item of that section: `-`, `*` or `+`, or
 *    `1.` / `1)`, at the start of the line (at most one space before the
 *    marker; an item indented 2+ spaces reads as nested). The rule text is the item's
 *    first line plus its continuation lines (lines indented at most 3
 *    columns and lazy continuation lines), joined with single spaces. Nested list items are
 *    NOT part of the rule (and neither is anything after them in that item).
 *    A blank line ends the item.
 *  - Ignored: everything outside the section; paragraphs and table rows inside
 *    it; fenced code blocks (``` or ~~~); HTML comments (`<!-- … -->`); an
 *    item whose whole text is struck through (`~~…~~`).
 *  - Several `## Forbidden` sections (in one file or in both files) are one
 *    rule set.
 *
 * Rule identity is the hash of the text normalised the way the presence
 * check normalises it (case, whitespace, backticks, `*`, trailing
 * punctuation), so reformatting a line is not a removal; changing its words
 * is (the old wording is gone — exactly the LLM path's `sha256(text)` view).
 */
import { createHash } from 'crypto'
import type { BoundaryCrossingSeverity } from '@prisma/client'
import {
  FORBIDDEN_RULE_REF_PREFIX,
  normalizeRuleTextForPresence,
  ruleTextPresentIn,
} from './rejudge-cause'

export { FORBIDDEN_RULE_REF_PREFIX }

/** The files the core reads, in this order (the plugin compiler reads the
 *  same two from the repository root). */
export const FORBIDDEN_RULE_FILES = ['CLAUDE.md', 'AGENTS.md'] as const
export type ForbiddenRuleFile = (typeof FORBIDDEN_RULE_FILES)[number]

export interface ForbiddenRule {
  /** sha256 of the normalised text, first 16 hex chars. */
  id: string
  /** The item text as written (markdown kept, whitespace collapsed). */
  text: string
  /** The file it was first found in. */
  file: string
}

export function forbiddenRuleId(text: string): string {
  return createHash('sha256')
    .update(normalizeRuleTextForPresence(text))
    .digest('hex')
    .slice(0, 16)
}

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/
const THEMATIC_BREAK =
  /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(\S.*)$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const NESTED_ITEM = /^(?: {2,}|\t)[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/
const INDENTED = /^(?: {2,}|\t)\S/
const FORBIDDEN_TITLE = /^forbidden\b/i
const STRUCK = /^~~[^~](?:.*[^~])?~~$/

/** Leading indentation in columns (a tab counts 4). */
function indentOf(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

/** Drops `<!-- … -->` (also across lines), keeping the line structure. */
function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, m =>
    m.replace(/[^\n]/g, '')
  )
}

/** The `## Forbidden` rules of one markdown file. */
export function parseForbiddenRules(
  markdown: string,
  file: string
): ForbiddenRule[] {
  const lines = stripHtmlComments(markdown.replace(/\r\n?/g, '\n')).split('\n')
  const items: string[][] = []
  let inSection = false
  let fence: { char: string; length: number } | null = null
  let current: string[] | null = null
  // False once a nested item opened under the current item: the nested
  // item and its lines are not part of the rule.
  let collecting = false

  const close = () => {
    if (current) items.push(current)
    current = null
    collecting = false
  }

  for (const line of lines) {
    if (fence) {
      // CommonMark: the closing fence is the same character, at least as
      // long as the opening one, and nothing but spaces after it.
      const c = FENCE_CLOSE.exec(line)
      if (c && c[1]![0] === fence.char && c[1]!.length >= fence.length)
        fence = null
      continue
    }
    const f = FENCE.exec(line)
    if (f) {
      close()
      fence = { char: f[1]![0]!, length: f[1]!.length }
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      close()
      const level = h[1]!.length
      if (level <= 2)
        inSection = level === 2 && FORBIDDEN_TITLE.test((h[2] ?? '').trim())
      continue
    }
    if (THEMATIC_BREAK.test(line)) {
      close()
      inSection = false
      continue
    }
    if (!inSection) continue
    if (line.trim() === '') {
      close()
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item && !INDENTED.test(line)) {
      close()
      current = [item[1]!]
      collecting = true
      continue
    }
    // A nested item (an exception, an example, a clarification) is not part
    // of its parent's rule: editing it must not read as the rule removed.
    if (NESTED_ITEM.test(line)) {
      collecting = false
      continue
    }
    // A table row is never part of an item (nor a rule).
    if (!INDENTED.test(line) && line.trim().startsWith('|')) {
      close()
      continue
    }
    // A continuation line indented at most 3 columns (or a lazy one) belongs
    // to the open item, not after a nested item; deeper lines belong to
    // nested content. Anything else (a paragraph) is not a rule.
    if (current && collecting && indentOf(line) <= 3)
      (current as string[]).push(line.trim())
  }
  close()

  const out: ForbiddenRule[] = []
  const seen = new Set<string>()
  for (const parts of items) {
    const text = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (text === '' || STRUCK.test(text)) continue
    if (normalizeRuleTextForPresence(text) === '') continue
    const id = forbiddenRuleId(text)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, text, file })
  }
  return out
}

/** One file's content; null = the file does not exist. */
export interface ForbiddenRuleSourceFile {
  path: string
  content: string | null
}

/** The rule set of all files (first occurrence of a text wins). */
export function parseForbiddenRuleSet(
  files: readonly ForbiddenRuleSourceFile[]
): ForbiddenRule[] {
  const out: ForbiddenRule[] = []
  const seen = new Set<string>()
  for (const f of files) {
    if (f.content == null) continue
    for (const r of parseForbiddenRules(f.content, f.path)) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r)
    }
  }
  return out
}

/** The source text the presence check reads — the same concatenation the
 *  plugin compiler hands the judge (CLAUDE.md, blank line, AGENTS.md). */
export function forbiddenRuleSourceText(
  files: readonly ForbiddenRuleSourceFile[]
): string {
  return files.map(f => f.content ?? '').join('\n\n')
}

/** The rules of `prev` that `next` no longer has. */
export function removedForbiddenRules(
  prev: readonly ForbiddenRule[],
  next: readonly ForbiddenRule[]
): ForbiddenRule[] {
  const ids = new Set(next.map(r => r.id))
  return prev.filter(r => !ids.has(r.id))
}

/** Same rule id set? (Order and file do not matter.) */
export function sameForbiddenRuleSet(
  a: readonly ForbiddenRule[],
  b: readonly ForbiddenRule[]
): boolean {
  if (a.length !== b.length) return false
  const ids = new Set(a.map(r => r.id))
  return b.every(r => ids.has(r.id))
}

export interface ForbiddenRuleWeakeningVerdict {
  severity: BoundaryCrossingSeverity
  advisory: boolean
  detail: string
  target: string
  policyRuleRef: string
  policyRuleText: string
}

/**
 * The crossing a removed Forbidden rule becomes, with the existing judge's
 * line (`policyWeakeningVerdict`, LUM-770): its text gone from the source →
 * HIGH + blocking (a person deleted or reworded it); its text still in the
 * source → MEDIUM + advisory (it was moved out of the section, struck
 * through, commented out, or the section heading stopped matching).
 */
export function forbiddenRuleWeakeningVerdict(
  rule: ForbiddenRule,
  source: string
): ForbiddenRuleWeakeningVerdict {
  const stillInSource = ruleTextPresentIn(source, rule.text)
  const detail = stillInSource
    ? `A rule is no longer listed under "## Forbidden" in ${rule.file}, but its text is still in the file (moved, struck through, commented out or the heading changed): "${rule.text}"`
    : `A Forbidden rule was removed from ${rule.file}: "${rule.text}"`
  return {
    severity: stillInSource ? 'MEDIUM' : 'HIGH',
    advisory: stillInSource,
    detail,
    target: `weakening:${FORBIDDEN_RULE_REF_PREFIX}${rule.id}`,
    policyRuleRef: `${FORBIDDEN_RULE_REF_PREFIX}${rule.id}`,
    policyRuleText: rule.text,
  }
}

/** Shortest normalised text a containment match may rest on — below it two
 *  different rules could contain each other by accident. */
const MIN_CONTAINED_LENGTH = 12

/**
 * Do two rule texts name the same rule? One side is the literal Forbidden
 * line, the other may be the LLM compiler's extraction of it (which drops
 * markdown, may trim a clause or add a trailing gloss): equal after the
 * presence normalisation, or one contains the other.
 */
export function sameRuleText(a: string, b: string): boolean {
  const na = normalizeRuleTextForPresence(a)
  const nb = normalizeRuleTextForPresence(b)
  if (na === '' || nb === '') return false
  if (na === nb) return true
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  return short.length >= MIN_CONTAINED_LENGTH && long.includes(short)
}

/** Stored-rule guard: the snapshot's JSON column read back. */
export function parseStoredForbiddenRules(value: unknown): ForbiddenRule[] {
  if (!Array.isArray(value)) return []
  const out: ForbiddenRule[] = []
  for (const v of value) {
    if (
      v != null &&
      typeof v === 'object' &&
      typeof (v as ForbiddenRule).id === 'string' &&
      typeof (v as ForbiddenRule).text === 'string' &&
      typeof (v as ForbiddenRule).file === 'string'
    )
      out.push({
        id: (v as ForbiddenRule).id,
        text: (v as ForbiddenRule).text,
        file: (v as ForbiddenRule).file,
      })
  }
  return out
}
