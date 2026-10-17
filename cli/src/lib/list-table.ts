import {
  colorEnabled,
  renderTable,
  stringWidth,
  stripAnsi,
  terminalWidth,
} from './ui'

/**
 * LUM-1089 — the one table shape every `list`-style command renders through
 * (task list / search, next, doc list, artifact list, figma list, milestone
 * list, sprint list, tag list, member list, audit list).
 *
 * Header policy: the header row is printed only when stdout is a TTY. Agents
 * and pipes read these lists as plain text (most have no `--json`), so the
 * non-TTY output stays headerless, untruncated and colourless — first column
 * is still the id and the column order never changes.
 *
 * LUM-1232 batch A (conventions L-3, decision Q1): off a TTY the fields of a
 * row are separated by a single TAB (no padding), so a value containing
 * spaces never makes the row ambiguous. A TAB / CR / LF inside a cell is
 * flattened to a space first.
 *
 * On a TTY the one free-text column (`flex`, usually the title / name) is cut
 * with `…` so a row fits the terminal width; it never shrinks below
 * `MIN_FLEX_WIDTH` columns.
 */

export const MIN_FLEX_WIDTH = 20

export interface ListTableOptions {
  /** Column labels, shown on a TTY only. */
  header: string[]
  /** Index of the free-text column truncated to the terminal width on a TTY. */
  flex?: number
  /** Per-column alignment (default left). */
  align?: Array<'left' | 'right' | undefined>
  /** Override TTY detection (default: `process.stdout.isTTY`). */
  tty?: boolean
  /** Override the terminal width (default: `terminalWidth()`). */
  width?: number
  /** Override colour detection (default: `colorEnabled()`). */
  color?: boolean
}

/** The environment knobs a list formatter forwards (tests pin them). */
export type ListRenderOptions = Pick<
  ListTableOptions,
  'tty' | 'width' | 'color'
>

const GAP = 2

/** Display-width cap for the flex column so the widest row fits `width`. */
export function flexColumnCap(
  rows: string[][],
  flex: number,
  width: number
): number {
  const widths: number[] = []
  for (const r of rows) {
    r.forEach((c, i) => {
      // Measure what renderTable prints: it flattens tab / CR / LF to a space
      // first, and stringWidth counts a raw tab as 0 columns (LUM-1104).
      const flat = c.replace(/[\t\r\n\v\f]/g, ' ')
      widths[i] = Math.max(widths[i] ?? 0, stringWidth(flat))
    })
  }
  let fixed = 0
  widths.forEach((w, i) => {
    if (i !== flex) fixed += w
  })
  // renderTable drops trailing empty cells, so an all-empty trailing column
  // (e.g. figma's NOTE when nothing is stale) costs no gap.
  let cols = widths.length
  while (cols > 0 && (widths[cols - 1] ?? 0) === 0) cols--
  const gaps = GAP * Math.max(0, cols - 1)
  return Math.max(MIN_FLEX_WIDTH, width - fixed - gaps)
}

export function renderListTable(
  rows: string[][],
  opts: ListTableOptions
): string {
  const tty = opts.tty ?? Boolean(process.stdout.isTTY)
  const color = opts.color ?? colorEnabled()
  if (!tty) return tabRows(rows)
  const maxWidths: Array<number | undefined> = []
  if (opts.flex !== undefined) {
    maxWidths[opts.flex] = flexColumnCap(
      [opts.header, ...rows],
      opts.flex,
      opts.width ?? terminalWidth()
    )
  }
  return renderTable(rows, {
    header: opts.header,
    gap: GAP,
    maxWidths,
    color,
    ...(opts.align ? { align: opts.align } : {}),
  })
}

/** Pipe form: one line per row, fields joined by a TAB (L-3). */
export function tabRows(rows: string[][]): string {
  return rows
    .map(r => r.map(c => stripAnsi(c).replace(/[\t\r\n\v\f]/g, ' ')).join('\t'))
    .join('\n')
}

/**
 * LUM-1232 L-6: the first cell of a child row (a breakdown under a parent
 * row). On a TTY it is indented under the parent with `↳`; piped, every row
 * must stand alone, so it carries the parent key: `parent/child`.
 */
export function childCell(parent: string, child: string, tty: boolean): string {
  return tty ? `  ↳ ${child}` : `${parent}/${child}`
}
