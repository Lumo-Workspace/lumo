import {
  DEFAULT_TERMINAL_WIDTH,
  heading,
  icons,
  stringWidth,
  style,
  wrap,
} from './ui'

/**
 * LUM-1091 — the layout grammar of the CLI's long reports (`task status`,
 * `task wrapup`, `pr scan`), built on the LUM-1086 primitives in `ui.ts`:
 *
 * - a section starts with a blank line and a plain heading (bold on a TTY);
 * - facts are `Label:  value` rows with the labels padded to one width — a
 *   value too long for the line moves under its label and wraps there;
 * - prose wraps at the report width; a shell command always sits on a line of
 *   its own and is never wrapped, so it can be copied whole;
 * - nesting is at most three levels (2 / 4 / 6 spaces) under a heading.
 *
 * Every helper takes plain, already-sanitized text. Colour, when on, is
 * applied here — after sanitizing (`sanitizeField` strips ESC) — and the
 * pure formatters default it off, so tests and piped output stay plain.
 */

export interface LayoutOptions {
  /** Report width in display columns (default 100). */
  width?: number | undefined
  /** Emit SGR styling (default false — the command entry decides). */
  color?: boolean | undefined
}

/**
 * The width the reports wrap at: the terminal's, clamped to 40–100 columns
 * (prose past 100 columns reads worse, not better). Non-TTY output gets 100.
 */
export function reportWidth(opts: LayoutOptions = {}): number {
  const w = opts.width ?? DEFAULT_TERMINAL_WIDTH
  return Math.min(DEFAULT_TERMINAL_WIDTH, Math.max(40, w))
}

/** `['', <heading>]` — the one section-heading style of the long reports. */
export function sectionHeading(
  title: string,
  opts: LayoutOptions = {}
): string[] {
  return ['', heading(title, { color: opts.color === true })]
}

/** Prose wrapped at the report width, every line at `indent`. */
export function wrapLines(
  text: string,
  indent: number,
  opts: LayoutOptions = {}
): string[] {
  const pad = ' '.repeat(indent)
  return wrap(text, reportWidth(opts) - indent).map(l => (l ? pad + l : ''))
}

/**
 * A `• text` item at `indent`, wrapped at the report width with its
 * continuation lines under the text (one level deeper than the bullet).
 */
export function bulletLines(
  text: string,
  indent: number,
  opts: LayoutOptions = {}
): string[] {
  const pad = ' '.repeat(indent)
  const [first = '', ...rest] = wrap(text, reportWidth(opts) - indent - 2)
  return [
    `${pad}${icons.bullet} ${first}`,
    // An item never contains a blank line (it would read as a section break).
    ...rest.filter(l => l !== '').map(l => `${pad}  ${l}`),
  ]
}

/** A shell command on its own line — never wrapped, never styled. */
export function commandLine(cmd: string, indent: number): string {
  return ' '.repeat(indent) + cmd
}

export interface Field {
  label: string
  value: string
  /**
   * Lines printed under the row, one level deeper (`indent + 2`). Already
   * formatted by the caller; they are not wrapped (commands stay whole).
   */
  sub?: string[]
}

/** Width of the widest `Label:` among `fields` — to align separate groups. */
export function labelWidth(fields: Field[]): number {
  return fields.reduce((m, f) => Math.max(m, stringWidth(f.label) + 1), 0)
}

/**
 * `Label:  value` rows at `indent`, labels padded to one width. A row whose
 * value does not fit next to its label prints the label alone and wraps the
 * value one level deeper, so a long value never runs past the width and the
 * nesting never exceeds one level under the row.
 */
export function fieldLines(
  fields: Field[],
  indent: number,
  opts: LayoutOptions = {},
  /** Pad labels to this width (`labelWidth(...)` of a wider group) instead. */
  labelW: number = labelWidth(fields)
): string[] {
  const width = reportWidth(opts)
  const pad = ' '.repeat(indent)
  const out: string[] = []
  for (const f of fields) {
    const label = `${f.label}:`
    const shown = style.dim(label, opts.color === true)
    const inline = indent + labelW + 2 + stringWidth(f.value)
    if (f.value === '') {
      out.push(pad + shown)
    } else if (inline <= width) {
      out.push(
        pad + shown + ' '.repeat(labelW - stringWidth(label)) + '  ' + f.value
      )
    } else {
      out.push(pad + shown)
      out.push(...wrapLines(f.value, indent + 2, opts))
    }
    for (const s of f.sub ?? []) out.push(' '.repeat(indent + 2) + s)
  }
  return out
}
