import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { rankTasks, type NextTask, type RankedTask } from '../lib/rank-tasks'

export interface NextOptions {
  count?: string
}

interface ActiveSprintsResponse {
  sprintIds: string[]
}

interface TasksMeResponse {
  tasks: NextTask[]
}

/**
 * `lumo next [-n, --count <N>]` — recommend the next task(s) to work on.
 *
 * Chains two read-only endpoints: active sprint ids (for a ranking boost) and
 * "my tasks". The active-sprints call is non-fatal — if it fails we warn and
 * rank without the sprint boost rather than aborting.
 */
export async function nextCommand(opts: NextOptions): Promise<number | void> {
  const count = opts.count !== undefined ? parseInt(opts.count, 10) : 3
  if (Number.isNaN(count) || count < 1) {
    console.error(
      `Error: invalid --count "${opts.count}" (expected a positive integer)`
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const authHeaders = { Authorization: `Bearer ${creds.token}` }

  // 1. Active sprint ids — non-fatal. Failure just drops the sprint boost.
  let activeSprintIds = new Set<string>()
  try {
    const res = await fetch(`${base}/api/me/active-sprints`, {
      headers: authHeaders,
    })
    if (res.ok) {
      const data = (await res.json()) as ActiveSprintsResponse
      activeSprintIds = new Set(data.sprintIds)
    } else {
      console.error(
        `Warning: could not load active sprints (HTTP ${res.status}); ranking without sprint boost.`
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `Warning: could not load active sprints (${msg}); ranking without sprint boost.`
    )
  }

  // 2. My tasks — fatal on failure.
  let res: Response
  try {
    res = await fetch(`${base}/api/tasks/me`, { headers: authHeaders })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!res.ok) {
    console.error(`Error: task fetch failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as TasksMeResponse
  const open = data.tasks.filter(t => t.status !== 'DONE')
  const ranked = rankTasks(open, activeSprintIds, new Date()).slice(0, count)

  process.stdout.write(formatNextOutput(ranked, open.length) + '\n')
}

/**
 * Render the ranked recommendation block. `ranked` is already sliced to the
 * requested count; `totalOpen` is the count of all non-DONE tasks (for the
 * "(of N open)" header). Pure — no I/O.
 */
export function formatNextOutput(
  ranked: RankedTask[],
  totalOpen: number
): string {
  const first = ranked[0]
  if (!first) return 'No open tasks assigned to you. 🎉'

  const widths = {
    identifier: Math.max(...ranked.map(r => r.identifier.length)),
    status: Math.max(...ranked.map(r => r.task.status.length)),
    priority: Math.max(...ranked.map(r => r.task.priority.length)),
  }

  const plural = ranked.length === 1 ? '' : 's'
  const lines: string[] = [
    `Top ${ranked.length} recommended task${plural} (of ${totalOpen} open):`,
    '',
  ]

  ranked.forEach((r, i) => {
    lines.push(
      `${i + 1}. ${r.identifier.padEnd(widths.identifier)}  ` +
        `${r.task.status.padEnd(widths.status)}  ` +
        `${r.task.priority.padEnd(widths.priority)}  ` +
        sanitizeField(r.task.title)
    )
    lines.push(`     ↳ ${r.reasons.join(' · ')}`)
  })

  lines.push('')
  lines.push(
    `Next: lumo session attach ${first.identifier} && lumo task context ${first.identifier}`
  )
  if (ranked.length > 1) {
    lines.push('（也可换成列表里任意一个 LUM-N）')
  }

  return lines.join('\n')
}
