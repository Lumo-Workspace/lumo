import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import { emitConfirmation, isConfirmed } from '../lib/confirmation'

/**
 * `lumo task delete <LUM-N> [--confirm]` (LUM-821). Since LUM-918 it moves
 * the task and its subtasks to the trash (restorable for 30 days from
 * settings → Trash) — still behind the exit-4 confirmation envelope.
 */

interface ShowTask {
  identifier: string
  title: string
  status: string
  subtasks?: Array<{ identifier: string }>
  pullRequests?: Array<{ number: number }>
}

/** Where a trashed task can be restored or erased (LUM-918). */
export const TRASH_HINT = 'restorable for 30 days from Settings → Trash'

/** The changes[] block for the confirmation envelope. */
export function describeTaskDelete(task: ShowTask): string[] {
  const lines = [
    `Will move ${task.identifier} "${sanitizeField(task.title)}" (${task.status}) to the trash — ${TRASH_HINT}, then permanently deleted`,
    'While in the trash it is hidden from lists, search, `lumo next` and task context; its comments, test cases and history are kept and come back on restore',
    'To erase it at once instead (e.g. a GDPR erasure request), delete it permanently from Settings → Trash afterwards',
  ]
  const subs = task.subtasks ?? []
  if (subs.length > 0) {
    lines.push(
      `${subs.length} ${subs.length === 1 ? 'subtask goes' : 'subtasks go'} to the trash with it: ${subs.map(s => s.identifier).join(', ')}`
    )
  }
  const prs = task.pullRequests ?? []
  if (prs.length > 0) {
    lines.push(
      `Linked PR(s) ${prs.map(p => `#${p.number}`).join(', ')} stay on GitHub; the link comes back on restore`
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
    `Moved ${r.data.deleted.identifier} "${sanitizeField(r.data.deleted.title)}" to the trash (${TRASH_HINT})\n`
  )
}
