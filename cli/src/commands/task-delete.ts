import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import { emitConfirmation, isConfirmed } from '../lib/confirmation'

/**
 * `lumo task delete <LUM-N> [--confirm]` (LUM-821). A hard delete — there is
 * no archive for tasks — so it always walks the exit-4 confirmation envelope
 * first, naming what goes with the task.
 */

interface ShowTask {
  identifier: string
  title: string
  status: string
  subtasks?: Array<{ identifier: string }>
  pullRequests?: Array<{ number: number }>
}

/** The changes[] block for the confirmation envelope. */
export function describeTaskDelete(task: ShowTask): string[] {
  const lines = [
    `Will PERMANENTLY delete ${task.identifier} "${sanitizeField(task.title)}" (${task.status}) — there is no undo and no archive`,
    'Deleted with it: comments, acceptance criteria + verification runs, test cases + runs, artifacts, activity history, dependency edges',
    'Also deleted: its boundary crossings and gate signals — the audit trail that would otherwise block DONE',
    'Kept but unlinked: memories, sessions, linked PR records',
  ]
  const subs = task.subtasks ?? []
  if (subs.length > 0) {
    lines.push(
      `${subs.length} ${subs.length === 1 ? 'subtask stays' : 'subtasks stay'} but ${subs.length === 1 ? 'loses its' : 'lose their'} parent: ${subs.map(s => s.identifier).join(', ')}`
    )
  }
  const prs = task.pullRequests ?? []
  if (prs.length > 0) {
    lines.push(
      `Linked PR(s) ${prs.map(p => `#${p.number}`).join(', ')} lose their task link (nothing changes on GitHub)`
    )
  }
  return lines
}

export async function taskDelete(
  identifier: string,
  options: { confirm?: boolean }
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const path = `/api/tasks/by-identifier/${encodeURIComponent(identifier)}`

  if (!isConfirmed(options)) {
    const r = await apiCall<{ task: ShowTask }>(ctx, path, {}, 'task lookup')
    if (!r.ok || !r.data) return 1
    return emitConfirmation({
      command: 'task delete',
      changes: describeTaskDelete(r.data.task),
    })
  }

  const r = await apiCall<{ deleted: { identifier: string; title: string } }>(
    ctx,
    path,
    { method: 'DELETE' },
    'task delete'
  )
  if (!r.ok || !r.data) return 1
  process.stdout.write(
    `Deleted ${r.data.deleted.identifier} "${sanitizeField(r.data.deleted.title)}"\n`
  )
}
