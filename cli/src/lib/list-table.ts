import { colorEnabled, renderTable, stringWidth, terminalWidth } from './ui'

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
      widths[i] = Math.max(widths[i] ?? 0, stringWidth(c))
    })
  }
  let fixed = 0
  widths.forEach((w, i) => {
    if (i !== flex) fixed += w
  })
  const gaps = GAP * Math.max(0, widths.length - 1)
  return Math.max(MIN_FLEX_WIDTH, width - fixed - gaps)
}

export function renderListTable(
  rows: string[][],
  opts: ListTableOptions
): string {
  const tty = opts.tty ?? Boolean(process.stdout.isTTY)
  const color = opts.color ?? colorEnabled()
  if (!tty) {
    return renderTable(rows, {
      gap: GAP,
      color,
      ...(opts.align ? { align: opts.align } : {}),
    })
  }
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
