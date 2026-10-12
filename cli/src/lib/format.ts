import { sanitizeField } from './sanitize'
import { renderListTable, type ListRenderOptions } from './list-table'

/**
 * Shared CLI time/duration formatters. Extracted from task-context.ts so the
 * session-start recovery card (hook-runner.ts) can reuse the exact same shape.
 */

export function formatDuration(ms: number): string {
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))}s`
  }
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`
}

export function relativeTime(then: Date, now: Date): string {
  const diffMs = now.getTime() - then.getTime()
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
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
      ...columns.map(c => r[c] ?? '-'),
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
  if (tasks.length === 0) return 'No tasks.'
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
