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

/** The one icon set CLI output draws from. Plain Unicode, width 1 each. */
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

function graphemes(s: string): string[] {
  if (!segmenter) return Array.from(s)
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

const EMOJI_WIDE_RE = /\p{Emoji_Presentation}|️|\p{Regional_Indicator}/u
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
  const clip = (r: string[]) =>
    r.map((c, i) => {
      const cap = opts.maxWidths?.[i]
      return cap === undefined ? c : truncate(c, cap)
    })
  const header = opts.header ? clip(opts.header) : undefined
  const body = rows.map(clip)
  const all = header ? [header, ...body] : body
  if (all.length === 0) return ''
  const cols = Math.max(...all.map(r => r.length))
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(...all.map(r => stringWidth(r[i] ?? '')))
  )
  const line = (r: string[], isHeader: boolean) =>
    widths
      .map((w, i) => {
        const raw = r[i] ?? ''
        const right = opts.align?.[i] === 'right'
        const last = i === cols - 1
        const cell = right
          ? padStartWidth(raw, w)
          : last
            ? raw
            : padEndWidth(raw, w)
        return isHeader ? style.bold(cell, color) : cell
      })
      .join(gap)
      .replace(/\s+$/, '')
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
  const w = opts.labelWidth ?? Math.max(0, ...labels.map(stringWidth))
  const cont = indent + ' '.repeat(w + 1)
  return pairs
    .map(([, value], i) => {
      const [first = '', ...rest] = value.split('\n')
      const label = style.dim(padEndWidth(labels[i] ?? '', w), color)
      return [`${indent}${label} ${first}`, ...rest.map(l => cont + l)]
        .map(l => l.replace(/\s+$/, ''))
        .join('\n')
    })
    .join('\n')
}
