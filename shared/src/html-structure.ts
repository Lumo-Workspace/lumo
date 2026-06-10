/**
 * Structural tag counting over rendered document HTML.
 *
 * Single source of truth shared by the server-side structure guard on the
 * document update path (LUM-410) and `scripts/verify-live-doc.ts`, so the
 * guard and the script can never drift on what counts as "structure".
 *
 * Counting is regex-based over the rendered HTML. That is safe here because
 * both inputs always come out of the same `markdownToHtml` renderer (or the
 * Tiptap editor's serializer), which emits plain lowercase tags — this is
 * not a general-purpose HTML parser.
 */

export interface StructureCheck {
  tag: string
  rendered: number
  stored: number
  /** Hard checks fail the run; soft checks only warn. */
  hard: boolean
}

/** Categories `verify-live-doc.ts` reports on (hard = table structure). */
export const TAG_PATTERNS: Array<{
  tag: string
  pattern: RegExp
  hard: boolean
}> = [
  { tag: 'table', pattern: /<table/g, hard: true },
  { tag: 'tr', pattern: /<tr/g, hard: true },
  { tag: 'h1', pattern: /<h1/g, hard: false },
  { tag: 'h2', pattern: /<h2/g, hard: false },
  { tag: 'h3', pattern: /<h3/g, hard: false },
  { tag: 'li', pattern: /<li/g, hard: false },
  { tag: 'a', pattern: /<a[\s>]/g, hard: false },
  { tag: 'strong', pattern: /<strong/g, hard: false },
  { tag: 'code', pattern: /<code/g, hard: false },
  { tag: 'blockquote', pattern: /<blockquote/g, hard: false },
]

export function countPattern(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

export function compareStructure(
  renderedHtml: string,
  storedHtml: string
): StructureCheck[] {
  return TAG_PATTERNS.map(({ tag, pattern, hard }) => ({
    tag,
    rendered: countPattern(renderedHtml, pattern),
    stored: countPattern(storedHtml, pattern),
    hard,
  }))
}

export function hardMismatches(checks: StructureCheck[]): StructureCheck[] {
  return checks.filter(c => c.hard && c.rendered !== c.stored)
}

export function softMismatches(checks: StructureCheck[]): StructureCheck[] {
  return checks.filter(c => !c.hard && c.rendered !== c.stored)
}

// ── Update-path structure guard (LUM-410) ────────────────────────────────────

export interface StructureShrink {
  tag: 'table' | 'tr' | 'heading'
  before: number
  after: number
}

/**
 * Categories the update guard protects. Headings are counted as one
 * aggregate bucket (h1–h6) so promoting/demoting a heading level is not a
 * loss — only dropping a section heading outright is.
 */
const GUARD_PATTERNS: Array<{
  tag: StructureShrink['tag']
  pattern: RegExp
}> = [
  { tag: 'table', pattern: /<table/g },
  { tag: 'tr', pattern: /<tr/g },
  { tag: 'heading', pattern: /<h[1-6][\s>]/g },
]

/**
 * Compare two rendered HTML bodies and report every guarded category whose
 * count shrank. Empty result = the edit loses no guarded structure.
 */
export function structureShrinks(
  oldHtml: string,
  newHtml: string
): StructureShrink[] {
  const shrinks: StructureShrink[] = []
  for (const { tag, pattern } of GUARD_PATTERNS) {
    const before = countPattern(oldHtml, pattern)
    const after = countPattern(newHtml, pattern)
    if (after < before) shrinks.push({ tag, before, after })
  }
  return shrinks
}

/** "table 3→0, tr 12→0" — the per-category loss detail for error messages. */
export function formatStructureShrinks(shrinks: StructureShrink[]): string {
  return shrinks.map(s => `${s.tag} ${s.before}→${s.after}`).join(', ')
}
