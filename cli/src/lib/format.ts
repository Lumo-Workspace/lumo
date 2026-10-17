import { sanitizeField } from './sanitize'
import { renderListTable, type ListRenderOptions } from './list-table'
import { localDayLabel } from './local-day'

/**
 * Shared CLI value formatters — LUM-1088: the one place dates, timestamps,
 * durations, token counts, empty values and empty states are spelled. No
 * clock and no colour; the only environment read is the process timezone and,
 * when a caller does not pass `{ tty }`, whether stdout is a terminal
 * ({@link fmtInstant}).
 *
 * Dates come in two kinds and must not be mixed up:
 * - CALENDAR-DAY fields (sprint start/end, milestone start/target) are stored
 *   as the day's UTC midnight and mean "that day for everyone" (LUM-700).
 *   {@link fmtCalendarDay} reads the UTC date and never shifts it — converting
 *   to the local zone would show the previous day west of UTC.
 * - TIMESTAMPS (createdAt, completedAt, scan started/finished, audit time,
 *   due dates — LUM-821 stores those as the author's local midnight) are
 *   instants; {@link fmtDay} shows the local day, {@link fmtInstant} the full
 *   instant.
 *
 * LUM-1232 (docs/cli-output-conventions.md, T-1/T-2; user ruling 2026-10-18):
 * the CLI prints absolute times only, never relative ones. A terminal gets
 * local time with its UTC offset (`2026-10-17 09:24 +11:00`); a pipe gets
 * ISO 8601 in UTC with `Z` (`2026-10-16T22:24:00Z`).
 */

/** The placeholder for an absent field value (no assignee, no date, n/a, …). */
export const NONE = '-'

/** `value`, or {@link NONE} when it is null / undefined / empty. */
export function orNone(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? NONE : value
}

const CALENDAR_DAY_PREFIX = /^\d{4}-\d{2}-\d{2}(?:$|T)/

/**
 * A calendar-day field stored as UTC midnight → `YYYY-MM-DD` of that UTC day
 * (never shifted to the local zone). Absent → {@link NONE}.
 */
export function fmtCalendarDay(iso: string | null | undefined): string {
  if (!iso || !CALENDAR_DAY_PREFIX.test(iso)) return NONE
  // Intentional UTC slice: the stored value IS the calendar day (LUM-700).
  return iso.slice(0, 10)
}

/** A timestamp → the LOCAL calendar day it falls on, `YYYY-MM-DD`. Absent → {@link NONE}. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return NONE
  return localDayLabel(iso)
}

export interface TimeOptions {
  /** Terminal form (local + offset) vs pipe form (UTC `Z`). Default: `process.stdout.isTTY`. */
  tty?: boolean | undefined
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** The UTC offset in force at `d` in the local zone, as `+HH:MM` / `-HH:MM`. */
export function utcOffsetLabel(d: Date): string {
  const minutes = -d.getTimezoneOffset()
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

/**
 * An instant (T-1 / T-2). Terminal: local `YYYY-MM-DD HH:MM ±HH:MM`. Pipe:
 * UTC ISO 8601 to the second, `YYYY-MM-DDTHH:MM:SSZ`. Absent / unparsable →
 * {@link NONE}.
 */
export function fmtInstant(
  iso: string | null | undefined,
  opts: TimeOptions = {}
): string {
  if (!iso) return NONE
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return NONE
  const tty = opts.tty ?? Boolean(process.stdout.isTTY)
  if (!tty) return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return `${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())} ${utcOffsetLabel(d)}`
}

/** Same as {@link fmtInstant} (the name older call sites use). */
export function fmtTimestamp(
  iso: string | null | undefined,
  opts: TimeOptions = {}
): string {
  return fmtInstant(iso, opts)
}

/** A calendar-day range, `YYYY-MM-DD → YYYY-MM-DD` (T-3). */
export function fmtDayRange(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  return `${fmtCalendarDay(start)} → ${fmtCalendarDay(end)}`
}

/**
 * Elapsed milliseconds → `45s`, `12m`, `2h 14m`, `3h`; from 48 hours on always
 * hours and minutes, `80h 19m` / `1301h 0m`, never days, so values can be
 * compared and added up (N-3, user ruling 2026-10-18). Seconds only show
 * under a minute;
 * 0 (or less) → `0s`.
 */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return '0s'
  // Decide the unit on the rounded value, so 59.6s reads `1m`, not `60s`.
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const totalMinutes = Math.max(1, Math.round(ms / 60_000))
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 48) return `${hours}h ${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

/** Same as {@link formatDuration}, for a value in seconds. */
export function formatDurationSec(sec: number): string {
  return formatDuration(sec * 1000)
}

const COMPACT_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * Token count for a one-line summary — `1.2M`, `850K`, `812`. The same Intl
 * compact formatter the web card uses (LUM-560), so both surfaces agree.
 */
export function fmtTokens(n: number): string {
  return COMPACT_FMT.format(n)
}

/**
 * Exact integer with `,` thousands separators — `1,234,567`. For ledgers and
 * breakdowns (cost tables, lineage, scan budgets) where every digit matters.
 * Rounds first (attributed token figures can be fractional, LUM-840);
 * deterministic, no locale dependency.
 */
export function fmtCount(n: number): string {
  const r = Math.round(n)
  const sign = r < 0 ? '-' : ''
  return (
    sign +
    Math.abs(r)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  )
}

/** Hours (possibly fractional) → {@link formatDuration} text; null → {@link NONE}. */
export function formatDurationHours(hours: number | null | undefined): string {
  return hours === null || hours === undefined || !Number.isFinite(hours)
    ? NONE
    : formatDuration(hours * 3_600_000)
}

/**
 * A percentage (0–100 scale) → whole number `49%`; one decimal below 1%
 * (`0.4%`), `<0.1%` / `>99.9%` next to the edges, `0%` for zero (N-4).
 */
export function fmtPercent(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%'
  // One decimal where a whole number would round to 0% or 100% and lie; a
  // value even closer to the edge says so instead of rounding onto it.
  if (pct < 0.1) return '<0.1%'
  if (pct < 100 && pct > 99.9) return '>99.9%'
  if (pct < 1 || (pct < 100 && Math.round(pct) === 100))
    return `${Math.round(pct * 10) / 10}%`
  return `${Math.round(pct)}%`
}

/**
 * An enum value as UPPER_SNAKE_CASE, the way `--json` and the web spell it
 * (E-1): `merged` → `MERGED`, `on-track` → `ON_TRACK`. Empty → {@link NONE}.
 */
export function fmtEnum(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '') return NONE
  return value
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase()
}

/**
 * The one empty-state sentence: `No <things>.` / `No <things> on <scope>.`
 * Follow-up advice goes on its own `Hint:` / `Next:` line, not here.
 */
export function emptyState(things: string, scope?: string): string {
  return scope ? `No ${things} on ${scope}.` : `No ${things}.`
}

export interface TaskRow {
  id: string
  number: number
  title: string
  status: string
  priority: string
  teamIdentifier: string
  project: { id: string; name: string }
}

/** One task row, already sanitized — the cells `renderTaskTable` prints. */
export interface TaskTableRow {
  id: string
  status: string
  priority: string
  title: string
  project?: string
  assignee?: string
  due?: string
}

export type TaskTableColumn = 'project' | 'assignee' | 'due'

const TASK_COLUMN_HEADER: Record<TaskTableColumn, string> = {
  project: 'PROJECT',
  assignee: 'ASSIGNEE',
  due: 'DUE',
}

/**
 * LUM-1089: the one task table `task list`, `task search` and `next` share:
 *   <id>  <STATUS>  <PRIORITY>  [<extra columns>…]  <title>
 * Header on a TTY only; the title is the column cut to the terminal width.
 */
export function renderTaskTable(
  rows: TaskTableRow[],
  columns: TaskTableColumn[],
  opts: ListRenderOptions & { idHeader?: string } = {}
): string {
  const { idHeader = 'ID', ...env } = opts
  return renderListTable(
    rows.map(r => [
      r.id,
      r.status,
      r.priority,
      ...columns.map(c => r[c] ?? NONE),
      r.title,
    ]),
    {
      header: [
        idHeader,
        'STATUS',
        'PRIORITY',
        ...columns.map(c => TASK_COLUMN_HEADER[c]),
        'TITLE',
      ],
      flex: 3 + columns.length,
      ...env,
    }
  )
}

/**
 * Render a task list as a table. Each row:
 *   LUM-42  IN_PROGRESS  HIGH    project-name   Title here
 * Columns are padded (by display width) to the widest cell in the result set
 * so output lines up regardless of identifier or project-name length.
 */
export function formatTaskListTable(
  tasks: TaskRow[],
  opts: ListRenderOptions = {}
): string {
  if (tasks.length === 0) return emptyState('tasks')
  return renderTaskTable(
    tasks.map(t => ({
      id: `${t.teamIdentifier}-${t.number}`,
      status: t.status,
      priority: t.priority,
      project: sanitizeField(t.project.name),
      title: sanitizeField(t.title),
    })),
    ['project'],
    opts
  )
}
