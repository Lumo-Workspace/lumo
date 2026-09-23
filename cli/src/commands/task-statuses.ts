import { apiCall, apiContext } from '../lib/test-case-api'

export interface TaskWorkflowCatalog {
  statuses: Array<{ value: string; transitionsTo: string[] }>
  priorities: string[]
  gatedStatuses: string[]
}

/** Render the server's workflow catalog (statuses → allowed transitions). */
export function formatTaskStatuses(c: TaskWorkflowCatalog): string {
  const w = Math.max(...c.statuses.map(s => s.value.length))
  const lines = ['Statuses (→ allowed transitions):']
  for (const s of c.statuses) {
    lines.push(`  ${s.value.padEnd(w)}  → ${s.transitionsTo.join(', ')}`)
  }
  lines.push('', `Priorities: ${c.priorities.join(', ')}`)
  if (c.gatedStatuses.length > 0) {
    lines.push(
      `Gated: ${c.gatedStatuses.join(', ')} — entering it needs the user's --confirm (exit-4 envelope) and a clear DONE gate`
    )
  }
  lines.push('CLI flags take these lowercase (e.g. --status in_progress).')
  return lines.join('\n')
}

/** `lumo task statuses` — status set, transitions, priorities (LUM-821). */
export async function taskStatuses(
  opts: { json?: boolean } = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<TaskWorkflowCatalog>(
    ctx,
    '/api/tasks/statuses',
    {},
    'task statuses'
  )
  if (!r.ok || !r.data) return 1
  if (opts.json) {
    process.stdout.write(JSON.stringify(r.data, null, 2) + '\n')
    return
  }
  process.stdout.write(formatTaskStatuses(r.data) + '\n')
}
