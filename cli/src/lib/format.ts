export interface TaskRow {
  id: string
  number: number
  title: string
  status: string
  priority: string
  teamIdentifier: string
  project: { id: string; name: string }
}

/**
 * Render a task list as a fixed-width table. Each row:
 *   LUM-42  IN_PROGRESS  HIGH    project-name   Title here
 * Columns are right-padded to the widest cell in the result set so output
 * lines up regardless of identifier or project-name length.
 */
export function formatTaskListTable(tasks: TaskRow[]): string {
  if (tasks.length === 0) return 'No tasks.'
  const rows = tasks.map(t => ({
    identifier: `${t.teamIdentifier}-${t.number}`,
    status: t.status,
    priority: t.priority,
    project: t.project.name,
    title: t.title,
  }))
  const widths = {
    identifier: Math.max(...rows.map(r => r.identifier.length)),
    status: Math.max(...rows.map(r => r.status.length)),
    priority: Math.max(...rows.map(r => r.priority.length)),
    project: Math.max(...rows.map(r => r.project.length)),
  }
  return rows
    .map(
      r =>
        `${r.identifier.padEnd(widths.identifier)}  ` +
        `${r.status.padEnd(widths.status)}  ` +
        `${r.priority.padEnd(widths.priority)}  ` +
        `${r.project.padEnd(widths.project)}  ` +
        r.title
    )
    .join('\n')
}
