import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { formatTaskListTable, type TaskRow } from '../lib/format'
import { sanitizeField } from '../lib/sanitize'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { errAuth, errHttp, errNotLoggedIn, httpFailed } from '../lib/errors'

export interface CloseSprintOptions extends ConfirmFlags {
  team?: string
  moveAll?: boolean
  backlogAll?: boolean
}

export type CloseDecision = 'moveToNext' | 'backToBacklog'

/**
 * Build the decisions map for POST /api/sprints/<id>/close.
 * Only non-DONE tasks get a decision entry; DONE tasks are excluded entirely.
 */
export function buildCloseDecisions(
  tasks: (TaskRow & { id: string })[],
  mode: 'move' | 'backlog'
): Record<string, CloseDecision> {
  const decision: CloseDecision =
    mode === 'move' ? 'moveToNext' : 'backToBacklog'
  const result: Record<string, CloseDecision> = {}
  for (const task of tasks) {
    if (task.status !== 'DONE') {
      result[task.id] = decision
    }
  }
  return result
}

/**
 * Format a refusal message when unfinished tasks exist and no mode flag was given.
 * Filters out DONE tasks before counting and rendering the list.
 */
export function formatUnfinishedRefusal(
  number: number,
  name: string,
  tasks: (TaskRow & { id: string })[]
): string {
  const unfinished = tasks.filter(t => t.status !== 'DONE')
  const lines: string[] = [
    `Refusing to close sprint #${number} "${sanitizeField(name)}": ${unfinished.length} task(s) not DONE.`,
    '',
    formatTaskListTable(unfinished),
    '',
    'To resolve, pass one of:',
    '  --move-all --confirm     move all unfinished tasks to the next sprint',
    '  --backlog-all --confirm  return all unfinished tasks to the backlog',
    '  Web UI                   decide task-by-task at lumo.so',
  ]
  return lines.join('\n')
}

/**
 * The changes[] block for the `--move-all` / `--backlog-all` confirmation
 * envelope (LUM-755): the sprint, and every unfinished task with where it goes.
 */
export function describeSprintClose(
  number: number,
  name: string,
  tasks: (TaskRow & { id: string })[],
  mode: 'move' | 'backlog'
): string[] {
  const unfinished = tasks.filter(t => t.status !== 'DONE')
  const lines = [`Will close sprint #${number} "${sanitizeField(name)}"`]
  if (unfinished.length === 0) {
    lines.push('No unfinished tasks — nothing is moved')
    return lines
  }
  const ids = unfinished.map(t => `${t.teamIdentifier}-${t.number}`).join(', ')
  const dest =
    mode === 'move' ? 'move to the next sprint' : 'return to the backlog'
  lines.push(
    sanitizeField(
      `${unfinished.length} unfinished task${unfinished.length === 1 ? '' : 's'} ${dest}: ${ids}`
    )
  )
  return lines
}

export async function sprintClose(
  identifier: string,
  opts: CloseSprintOptions
): Promise<number | void> {
  // CLI-side mutex: both flags together is an error.
  if (opts.moveAll && opts.backlogAll) {
    console.error(
      'Error: --move-all and --backlog-all are mutually exclusive. Pick one.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const workspaceSlug = creds.workspaceSlug ?? ''

  let resolved: { id: string; number: number; name: string }
  try {
    resolved = await resolveSprintId(
      base,
      creds.token,
      identifier,
      opts.team,
      workspaceSlug
    )
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Fetch sprint + tasks in parallel so we can validate unfinished tasks.
  let sprintRes: Response
  let tasksRes: Response
  try {
    ;[sprintRes, tasksRes] = await Promise.all([
      fetch(`${base}/api/sprints/${resolved.id}`, {
        headers: { Authorization: `Bearer ${creds.token}` },
      }),
      fetch(`${base}/api/sprints/${resolved.id}/tasks`, {
        headers: { Authorization: `Bearer ${creds.token}` },
      }),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (sprintRes.status === 401 || tasksRes.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!sprintRes.ok) {
    console.error(errHttp('sprint fetch', sprintRes.status))
    return 1
  }
  if (!tasksRes.ok) {
    console.error(errHttp('sprint tasks fetch', tasksRes.status))
    return 1
  }

  const { sprint } = (await sprintRes.json()) as {
    sprint: { number: number; name: string }
  }
  const { tasks } = (await tasksRes.json()) as {
    tasks: (TaskRow & { id: string })[]
  }

  const unfinished = tasks.filter(t => t.status !== 'DONE')

  // No mode flag: refuse if there are unfinished tasks.
  if (!opts.moveAll && !opts.backlogAll) {
    if (unfinished.length > 0) {
      console.error(formatUnfinishedRefusal(sprint.number, sprint.name, tasks))
      return 1
    }
    // All tasks done — post with empty decisions.
  }

  // LUM-755: a mode flag without --confirm → envelope listing every task
  // that would move, computed from the real sprint state; nothing is posted.
  if ((opts.moveAll || opts.backlogAll) && !isConfirmed(opts)) {
    return emitConfirmation({
      command: 'sprint close',
      changes: describeSprintClose(
        sprint.number,
        sprint.name,
        tasks,
        opts.moveAll ? 'move' : 'backlog'
      ),
    })
  }

  // Build decisions map.
  const decisions =
    opts.moveAll || opts.backlogAll
      ? buildCloseDecisions(tasks, opts.moveAll ? 'move' : 'backlog')
      : {}

  let res: Response
  try {
    res = await fetch(`${base}/api/sprints/${resolved.id}/close`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ decisions }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!res.ok) {
    let errMsg = httpFailed('sprint close', res.status)
    try {
      const errBody = (await res.json()) as { error?: string }
      if (errBody.error) errMsg = errBody.error
    } catch {
      // body wasn't JSON
    }
    console.error(`Error: ${sanitizeField(errMsg)}`)
    return 1
  }

  process.stdout.write(
    `Closed sprint #${sprint.number} "${sanitizeField(sprint.name)}"\n`
  )
}
