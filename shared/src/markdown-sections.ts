import MarkdownIt from 'markdown-it'

/**
 * Heading-addressed section slicing over a markdown source string (LUM-409).
 *
 * Single source of truth shared by the documents service (server-side
 * section patch/append) and the CLI (`doc show --section`) so both sides
 * agree byte-for-byte on where a section starts and ends.
 *
 * All offsets are character offsets into the ORIGINAL source string — slices
 * are taken with `src.slice(...)`, never re-serialized, so everything
 * outside an edited section survives byte-identical. Headings are located
 * with markdown-it block tokens (not a regex) so `#` lines inside fenced
 * code blocks or blockquotes are never mistaken for section boundaries.
 */

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

export interface MarkdownSection {
  /** Heading text as authored (inline markup preserved), trimmed. */
  heading: string
  /** Heading level 1–6. */
  depth: number
  /** 0-based line number of the heading line. */
  line: number
  /** Offset of the first character of the heading line. */
  startOffset: number
  /**
   * Offset where the section ends: the start of the next heading line with
   * depth <= this section's depth, or `src.length`. The slice therefore
   * includes any subsections and the trailing blank lines before the next
   * sibling heading.
   */
  endOffset: number
}

export type SectionMatch =
  | { kind: 'found'; section: MarkdownSection }
  | { kind: 'not-found'; available: MarkdownSection[] }
  | { kind: 'ambiguous'; candidates: MarkdownSection[] }

/**
 * Start offsets of each line, splitting on the same newline shapes
 * markdown-it normalizes before tokenizing (`\r\n` / `\r` / `\n`), so a
 * token's `map` line number indexes this array directly.
 */
function computeLineStarts(src: string): number[] {
  const starts = [0]
  for (let i = 0; i < src.length; i++) {
    const ch = src.charCodeAt(i)
    if (ch === 13 /* \r */) {
      if (src.charCodeAt(i + 1) === 10 /* \n */) i++
      starts.push(i + 1)
    } else if (ch === 10 /* \n */) {
      starts.push(i + 1)
    }
  }
  return starts
}

/** List every top-level heading-addressed section of a markdown source. */
export function listSections(src: string): MarkdownSection[] {
  if (!src) return []
  const tokens = md.parse(src, {})
  const lineStarts = computeLineStarts(src)

  const heads: { depth: number; text: string; line: number }[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    // level === 0 keeps headings nested inside blockquotes/lists from
    // becoming section boundaries.
    if (t?.type === 'heading_open' && t.map && t.level === 0) {
      const inline = tokens[i + 1]
      heads.push({
        depth: Number(t.tag.slice(1)),
        text: (inline?.type === 'inline' ? inline.content : '').trim(),
        line: t.map[0],
      })
    }
  }

  return heads.map((h, idx) => {
    let end = src.length
    for (let j = idx + 1; j < heads.length; j++) {
      const next = heads[j]
      if (next && next.depth <= h.depth) {
        end = lineStarts[next.line] ?? src.length
        break
      }
    }
    return {
      heading: h.text,
      depth: h.depth,
      line: h.line,
      startOffset: lineStarts[h.line] ?? 0,
      endOffset: end,
    }
  })
}

/**
 * Parse a `--section` query. A leading `#`-run constrains the heading depth
 * (`"## Status"` only matches h2 headings titled "Status"), which is how a
 * caller disambiguates same-text headings at different levels.
 */
export function parseSectionQuery(raw: string): {
  text: string
  depth?: number
} {
  const m = /^(#{1,6})\s+(.*)$/.exec(raw.trim())
  if (m) return { text: (m[2] ?? '').trim(), depth: (m[1] ?? '').length }
  return { text: raw.trim() }
}

/**
 * Normalize a heading for the widest match tier (LUM-447): fold full-width
 * ASCII forms (U+FF01–U+FF5E — the （），etc. that pepper CJK headings) down
 * to their half-width counterparts, turn the full-width ideographic space
 * (U+3000) into a normal space, collapse runs of whitespace to one, then
 * lower-case. This lets a half-width `--section` query land on a full-width
 * stored heading (and the reverse) so agents no longer have to grep and copy
 * the raw bytes. It does NOT relax the ambiguity guard: matches are still
 * counted, and more than one is reported as candidates.
 */
function normalizeHeading(text: string): string {
  return text
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Locate a section by heading text. Exact match first, then a
 * case-insensitive pass, then a full-width/half-width + whitespace
 * normalization pass (LUM-447); more than one hit in the winning pass is
 * reported as ambiguous rather than silently picking one.
 */
export function findSection(src: string, query: string): SectionMatch {
  const q = parseSectionQuery(query)
  const sections = listSections(src)
  const pool =
    q.depth !== undefined ? sections.filter(s => s.depth === q.depth) : sections

  let matches = pool.filter(s => s.heading === q.text)
  if (matches.length === 0) {
    const lower = q.text.toLowerCase()
    matches = pool.filter(s => s.heading.toLowerCase() === lower)
  }
  if (matches.length === 0) {
    const normalized = normalizeHeading(q.text)
    matches = pool.filter(s => normalizeHeading(s.heading) === normalized)
  }

  const first = matches[0]
  if (matches.length === 1 && first) return { kind: 'found', section: first }
  if (matches.length === 0) return { kind: 'not-found', available: sections }
  return { kind: 'ambiguous', candidates: matches }
}

/** Byte-faithful slice of one section (heading line through section end). */
export function extractSection(src: string, section: MarkdownSection): string {
  return src.slice(section.startOffset, section.endOffset)
}

function stripOuterNewlines(text: string): string {
  return text.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '')
}

/**
 * Replace one section (heading included) with `newText`, verbatim. Bytes
 * before `startOffset` and from `endOffset` on are carried over untouched;
 * only the new block's trailing newlines are padded so a following heading
 * still starts at the beginning of a line with a blank line before it.
 */
export function replaceSection(
  src: string,
  section: MarkdownSection,
  newText: string
): string {
  const before = src.slice(0, section.startOffset)
  const after = src.slice(section.endOffset)
  let block = newText
  if (after.length > 0 && block.length > 0 && !block.endsWith('\n\n')) {
    block = block.replace(/\n*$/, '\n\n')
  }
  return before + block + after
}

/**
 * Insert `text` at the end of a section (or at the end of the document when
 * `section` is null). Pure insertion: every pre-existing byte is preserved;
 * only separator newlines around the new chunk are added as needed.
 */
export function appendToSection(
  src: string,
  section: MarkdownSection | null,
  text: string
): string {
  const insertAt = section ? section.endOffset : src.length
  const before = src.slice(0, insertAt)
  const after = src.slice(insertAt)
  const chunk = stripOuterNewlines(text)
  if (chunk.length === 0) return src

  let lead = ''
  if (before.length > 0) {
    if (before.endsWith('\n\n')) lead = ''
    else if (before.endsWith('\n') || before.endsWith('\r')) lead = '\n'
    else lead = '\n\n'
  }
  const tail = after.length > 0 ? '\n\n' : '\n'
  return before + lead + chunk + tail + after
}
