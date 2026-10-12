import { formatTaskListTable, type TaskRow } from './format'
import {
  indentLines,
  sectionHeading,
  type DetailOptions,
} from './report-layout'
import { DEFAULT_TERMINAL_WIDTH } from './ui'

/**
 * LUM-1090 — the `Tasks (N)` section `milestone show` and `sprint show` end
 * with: a heading, then the LUM-1089 task table indented one level (header
 * row on a TTY only, title cut to the terminal width there). No tasks prints
 * `empty` instead of a table.
 */
export function taskTableSection(
  tasks: TaskRow[],
  empty: string,
  opts: DetailOptions = {}
): string[] {
  const lines = sectionHeading(`Tasks (${tasks.length})`, opts)
  if (tasks.length === 0) return [...lines, `  ${empty}`]
  const table = formatTaskListTable(tasks, {
    tty: opts.tty === true,
    color: opts.color === true,
    width: (opts.width ?? DEFAULT_TERMINAL_WIDTH) - 2,
  })
  return [...lines, ...indentLines(table, 2)]
}
