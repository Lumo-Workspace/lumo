/**
 * LUM-1086 — shared CLI output layer: colour gating, terminal width,
 * display-width-aware truncate / wrap / padding, tables, key/value blocks,
 * headings and one icon set. No third-party dependency.
 *
 * Agent-readable red lines:
 * - Colour is only ever emitted when the target stream is a TTY and the user
 *   has not opted out (`NO_COLOR`, `FORCE_COLOR=0`, `TERM=dumb`). A non-TTY
 *   stream gets plain text from every helper — `FORCE_COLOR` cannot turn
 *   colour on there, so piped / agent output never carries ESC sequences.
 * - `sanitizeField` strips ESC, so callers sanitize untrusted text FIRST and
 *   style it afterwards; never pass styled text back through `sanitizeField`.
 *
 * Widths are display columns: CJK / fullwidth and emoji-presentation
 * graphemes count 2, combining marks 0, ANSI escape sequences 0.
 */

type Env = Record<string, string | undefined>

export interface ColorProbe {
  isTTY?: boolean
  env?: Env
}

/** Whether styled output should be emitted for a stream (default: stdout). */
export function colorEnabled(probe: ColorProbe = {}): boolean {
  const isTTY = probe.isTTY ?? Boolean(process.stdout.isTTY)
  const env = probe.env ?? process.env
  if (!isTTY) return false
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false
  const force = env.FORCE_COLOR?.toLowerCase()
  if (force === '0' || force === 'false') return false
  if (env.TERM === 'dumb') return false
  return true
}

export const DEFAULT_TERMINAL_WIDTH = 100

/** Columns of the stream when it is a TTY that reports them, else 100. */
export function terminalWidth(
  stream: { isTTY?: boolean; columns?: number } = process.stdout
): number {
  if (stream.isTTY && stream.columns && stream.columns > 0)
    return stream.columns
  return DEFAULT_TERMINAL_WIDTH
}

// ── styling ────────────────────────────────────────────────────────────────

function sgr(open: number, close: number) {
  return (s: string, enabled: boolean = colorEnabled()): string =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s
}

/** SGR wrappers; identity when colour is disabled. Apply AFTER sanitizing. */
export const style = {
  bold: sgr(1, 22),
  dim: sgr(2, 22),
  red: sgr(31, 39),
  green: sgr(32, 39),
  yellow: sgr(33, 39),
  cyan: sgr(36, 39),
}

/**
 * The one icon set CLI output draws from. Plain Unicode, width 1 each.
 *
 * `success` (`✓`) is reserved for environment / flow confirmations (auth,
 * init, worktree ready, crossing rulings, memory push, …). Resource
 * create / update / delete success lines (`successLine` in `lib/feedback.ts`)
 * do not carry it — LUM-1088 rule, user ruling 2026-10-13.
 */
export const icons = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  bullet: '•',
  arrow: '→',
} as const

export function heading(text: string, opts: { color?: boolean } = {}): string {
  return style.bold(text, opts.color ?? colorEnabled())
}

// ── display width ──────────────────────────────────────────────────────────

const ANSI_RE =
  /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

// Minimal shape of Intl.Segmenter — declared locally because the root
// tsconfig's `lib` predates its typings (Node >= 16 ships it at runtime).
interface GraphemeSegmenter {
  segment(s: string): Iterable<{ segment: string }>
}
type SegmenterCtor = new (
  locale: undefined,
  opts: { granularity: 'grapheme' }
) => GraphemeSegmenter

const SegmenterImpl = (Intl as unknown as { Segmenter?: SegmenterCtor })
  .Segmenter
const segmenter = SegmenterImpl
  ? new SegmenterImpl(undefined, { granularity: 'grapheme' })
  : undefined

// Fallback when Intl.Segmenter is missing (small-ICU builds): glue combining
// marks, variation selectors, skin-tone modifiers and ZWJ-joined code points
// onto the preceding cluster, which covers what we measure in practice.
const EXTEND_RE = /^[\p{Mn}\p{Me}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D]$/u

function clusterCodePoints(s: string): string[] {
  const out: string[] = []
  let joinNext = false
  for (const cp of s) {
    const last = out.length - 1
    if (last >= 0 && (joinNext || EXTEND_RE.test(cp))) {
      out[last] += cp
    } else {
      out.push(cp)
    }
    joinNext = cp === '\u200D'
  }
  return out
}

function graphemes(s: string): string[] {
  if (!segmenter) return clusterCodePoints(s)
  return Array.from(segmenter.segment(s), seg => seg.segment)
}

// East Asian Wide / Fullwidth blocks (condensed).
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
]

function isWide(cp: number): boolean {
  return WIDE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
}

const EMOJI_WIDE_RE = /\p{Emoji_Presentation}|\uFE0F|\p{Regional_Indicator}/u
const ZERO_WIDTH_RE = /^[\p{Mn}\p{Me}\p{Cf}]/u

function graphemeWidth(g: string): number {
  const cp = g.codePointAt(0)
  if (cp === undefined) return 0
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (EMOJI_WIDE_RE.test(g)) return 2
  if (ZERO_WIDTH_RE.test(g)) return 0
  return isWide(cp) ? 2 : 1
}

/** Display columns of `s` (ANSI sequences ignored). */
export function stringWidth(s: string): number {
  let w = 0
  for (const g of graphemes(stripAnsi(s))) w += graphemeWidth(g)
  return w
}

/** `padEnd` by display width (no-op when already at least `width`). */
export function padEndWidth(s: string, width: number): string {
  const gap = width - stringWidth(s)
  return gap > 0 ? s + ' '.repeat(gap) : s
}

/** `padStart` by display width. */
export function padStartWidth(s: string, width: number): string {
  const gap = width - stringWidth(s)
  return gap > 0 ? ' '.repeat(gap) + s : s
}

/**
 * Cut `s` to at most `max` display columns, ending in `ellipsis` when cut.
 * Never splits a grapheme. Input is treated as plain text (any ANSI styling is
 * dropped when a cut is needed) — truncate first, style afterwards.
 */
export function truncate(s: string, max: number, ellipsis = '…'): string {
  if (stringWidth(s) <= max) return s
  if (max <= 0) return ''
  const ew = stringWidth(ellipsis)
  if (max <= ew) return ellipsis
  const budget = max - ew
  let out = ''
  let w = 0
  for (const g of graphemes(stripAnsi(s))) {
    const gw = graphemeWidth(g)
    if (w + gw > budget) break
    out += g
    w += gw
  }
  return out + ellipsis
}

/**
 * Word-wrap plain text to `width` display columns. Breaks on spaces, between
 * wide (CJK) characters, and hard-breaks words longer than a line. Explicit
 * newlines are kept. Returns the lines (no trailing whitespace).
 */
export function wrap(text: string, width: number): string[] {
  const max = Math.max(1, width)
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    let lineW = 0
    let pendingSpace = false
    const push = () => {
      lines.push(line)
      line = ''
      lineW = 0
    }
    const place = (tok: string, tw: number) => {
      const sep = pendingSpace && line ? 1 : 0
      pendingSpace = false
      if (lineW + sep + tw <= max) {
        line += (sep ? ' ' : '') + tok
        lineW += sep + tw
        return
      }
      if (line) push()
      if (tw <= max) {
        line = tok
        lineW = tw
        return
      }
      for (const g of graphemes(tok)) {
        const gw = graphemeWidth(g)
        if (lineW + gw > max && line) push()
        line += g
        lineW += gw
      }
    }
    let word = ''
    const flushWord = () => {
      if (word) place(word, stringWidth(word))
      word = ''
    }
    for (const g of graphemes(para)) {
      if (/^\s$/u.test(g)) {
        flushWord()
        pendingSpace = true
      } else if (graphemeWidth(g) === 2) {
        flushWord()
        place(g, 2)
      } else {
        word += g
      }
    }
    flushWord()
    lines.push(line)
  }
  return lines
}

// ── blocks ─────────────────────────────────────────────────────────────────

export interface TableOptions {
  /** Optional header row; bold when colour is on. */
  header?: string[]
  /** Spaces between columns (default 2). */
  gap?: number
  /** Per-column display-width caps; over-long cells are truncated with `…`. */
  maxWidths?: Array<number | undefined>
  /** Per-column alignment (default left). */
  align?: Array<'left' | 'right' | undefined>
  /** Override colour detection (default: `colorEnabled()`). */
  color?: boolean
}

/**
 * Fixed-width table aligned by display width. Cells may already be styled
 * (ANSI is ignored when measuring). The last left-aligned column is not
 * padded and lines carry no trailing whitespace.
 */
export function renderTable(rows: string[][], opts: TableOptions = {}): string {
  const color = opts.color ?? colorEnabled()
  const gap = ' '.repeat(opts.gap ?? 2)
  // Cells are single-line: tabs / CR / LF would break column alignment.
  const clip = (r: string[]) =>
    r.map((c, i) => {
      const flat = c.replace(/[\t\r\n\v\f]/g, ' ')
      const cap = opts.maxWidths?.[i]
      return cap === undefined ? flat : truncate(flat, cap)
    })
  const header = opts.header ? clip(opts.header) : undefined
  const body = rows.map(clip)
  const all = header ? [header, ...body] : body
  if (all.length === 0) return ''
  // Loops, not Math.max(...spread): large tables would overflow the stack.
  const widths: number[] = []
  for (const r of all) {
    r.forEach((c, i) => {
      widths[i] = Math.max(widths[i] ?? 0, stringWidth(c))
    })
  }
  const cols = widths.length
  // Padding is computed from the plain cell and placed OUTSIDE any styling,
  // and trailing empty cells are dropped, so no line ends in whitespace —
  // even when the cells carry ANSI codes.
  const line = (r: string[], isHeader: boolean) => {
    let end = cols
    while (end > 0 && stripAnsi(r[end - 1] ?? '') === '') end--
    const parts: string[] = []
    for (let i = 0; i < end; i++) {
      const raw = r[i] ?? ''
      const pad = ' '.repeat(Math.max(0, (widths[i] ?? 0) - stringWidth(raw)))
      const text = isHeader ? style.bold(raw, color) : raw
      if (opts.align?.[i] === 'right') parts.push(pad + text)
      else parts.push(i === end - 1 ? text : text + pad)
    }
    return parts.join(gap)
  }
  return all.map((r, idx) => line(r, Boolean(header) && idx === 0)).join('\n')
}

export interface KvOptions {
  /** Leading spaces on every line (default 0). */
  indent?: number
  /** Fixed width of the `Label:` column (default: widest label). */
  labelWidth?: number
  /** Override colour detection (default: `colorEnabled()`). */
  color?: boolean
}

/**
 * `Label:  value` lines with labels padded to one width; multi-line values
 * continue under the value column. Labels are dimmed when colour is on.
 */
export function kvBlock(
  pairs: Array<readonly [string, string]>,
  opts: KvOptions = {}
): string {
  const color = opts.color ?? colorEnabled()
  const indent = ' '.repeat(opts.indent ?? 0)
  const labels = pairs.map(([k]) => `${k}:`)
  const w =
    opts.labelWidth ?? labels.reduce((m, l) => Math.max(m, stringWidth(l)), 0)
  const cont = indent + ' '.repeat(w + 1)
  return pairs
    .map(([, value], i) => {
      const [first = '', ...rest] = value.split('\n')
      const text = labels[i] ?? ''
      const label = style.dim(text, color)
      const head = first
        ? `${indent}${label}${' '.repeat(Math.max(0, w - stringWidth(text)))} ${first}`
        : `${indent}${label}`
      return [head, ...rest.map(l => (l ? cont + l : ''))].join('\n')
    })
    .join('\n')
}
