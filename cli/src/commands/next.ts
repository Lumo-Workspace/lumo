import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { NONE, renderTaskTable } from '../lib/format'
import type { ListRenderOptions } from '../lib/list-table'
import { rankTasks, type NextTask, type RankedTask } from '../lib/rank-tasks'
import { formatNextSteps, nextStepsSilenced } from '../lib/next-steps'
import { hint } from '../lib/feedback'
import {
  filterClaimable,
  formatClaimableExclusions,
} from '../lib/claimable-filter'
import { errAuth, errHttp, errNotLoggedIn, warn } from '../lib/errors'
import { emitJson, listEnvelope, stripInternalFields } from '../lib/json-output'

export interface NextOptions {
  count?: string
  /**
   * LUM-646: restrict recommendations to the autonomy boundary — only tasks
   * that are claimable AND unblocked (F3) AND within milestone budget (F2).
   */
  claimable?: boolean
  /** Print the ranked tasks (with their reasons) as JSON. */
  json?: boolean
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
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
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
        warn(
          `could not load active sprints (HTTP ${res.status}); ranking without sprint boost.`
        )
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      warn(
        `could not load active sprints (${msg}); ranking without sprint boost.`
      )
    )
  }

  // 2. My tasks — fatal on failure. `?claimable=1` asks the server to also
  //    compute the per-milestone F2 budget signal (only needed for the gate).
  const tasksUrl = opts.claimable
    ? `${base}/api/tasks/me?claimable=1`
    : `${base}/api/tasks/me`
  let res: Response
  try {
    res = await fetch(tasksUrl, { headers: authHeaders })
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
    console.error(errHttp('task fetch', res.status))
    return 1
  }

  const data = (await res.json()) as TasksMeResponse
  const open = data.tasks.filter(t => t.status !== 'DONE')

  // LUM-646: the autonomy gate. Only when --claimable is passed; otherwise the
  // standard LUM-645 ranking is untouched.
  if (opts.claimable) {
    const gate = filterClaimable(open)
    if (!gate.supported) {
      // Older server predating F4 — degrade to the standard ranking with a
      // one-line notice rather than silently returning nothing.
      console.error(
        warn(
          '`--claimable` needs an updated Lumo server; showing the standard ranking instead.'
        )
      )
    } else {
      const ranked = rankTasks(gate.kept, activeSprintIds, new Date()).slice(
        0,
        count
      )
      if (opts.json) {
        emitJson(
          nextJson(ranked, gate.kept.length, {
            claimable: true,
            excluded: gate.excluded,
          })
        )
        return
      }
      process.stdout.write(
        formatClaimableOutput(ranked, gate.kept.length, gate.excluded) + '\n'
      )
      return
    }
  }

  const ranked = rankTasks(open, activeSprintIds, new Date()).slice(0, count)
  if (opts.json) {
    emitJson(nextJson(ranked, open.length, { claimable: false }))
    return
  }
  process.stdout.write(formatNextOutput(ranked, open.length) + '\n')
}

/**
 * The `--json` envelope: the ranked tasks in rank order, each the server's
 * task row plus its `ref` (first) and ranking `reasons`. `poolSize` is the
 * number of tasks the ranking chose from (open, or claimable with
 * `--claimable`, which also carries the exclusion tally).
 */
export function nextJson(
  ranked: RankedTask[],
  poolSize: number,
  extra: {
    claimable: boolean
    excluded?: import('../lib/claimable-filter').ClaimableExclusions
  }
): Record<string, unknown> {
  return listEnvelope(
    'tasks',
    ranked.map(r =>
      stripInternalFields({
        ref: r.identifier,
        ...r.task,
        reasons: r.reasons,
      })
    ),
    {},
    { poolSize, ...extra }
  )
}

/**
 * Render the `--claimable` recommendation block. Like `formatNextOutput` but
 * scoped to the autonomy boundary: the header names the claimable count, and
 * an empty result reports the honest exclusion breakdown (why nothing is
 * claimable-and-workable) instead of the generic "no open tasks".
 */
export function formatClaimableOutput(
  ranked: RankedTask[],
  totalClaimable: number,
  excluded: import('../lib/claimable-filter').ClaimableExclusions
): string {
  if (ranked.length === 0) {
    const breakdown = formatClaimableExclusions(excluded)
    const base = 'No claimable, unblocked, in-budget tasks right now.'
    return breakdown ? `${base} (excluded: ${breakdown})` : base
  }

  return formatNextOutput(ranked, totalClaimable, 'claimable')
}

/**
 * Render the ranked recommendation block. `ranked` is already sliced to the
 * requested count; `totalOpen` is the count of all non-DONE tasks (for the
 * "(of N open)" header). Pure — no I/O.
 */
export function formatNextOutput(
  ranked: RankedTask[],
  totalOpen: number,
  /** Noun for the "(of N <noun>)" header — 'claimable' for the gated view. */
  poolNoun = 'open',
  opts: ListRenderOptions & {
    /** Print the trailing `Next:` block and hint (default: unless `--no-hints` / `LUMO_NO_HINTS`). */
    hints?: boolean
  } = {}
): string {
  const { hints = !nextStepsSilenced(), ...tableOpts } = opts
  const first = ranked[0]
  if (!first) return 'No open tasks assigned to you.'

  const plural = ranked.length === 1 ? '' : 's'
  const lines: string[] = [
    `Top ${ranked.length} recommended task${plural} (of ${totalOpen} ${poolNoun}):`,
    '',
  ]

  // LUM-1232 L-4: the ref is the first column (row order is the rank) and
  // the ranking reasons are a WHY column — no `1.` prefix, no `↳` sub-rows.
  // The priority is already its own column, so it is not repeated in WHY.
  const table = renderTaskTable(
    ranked.map(r => ({
      id: r.identifier,
      status: r.task.status,
      priority: r.task.priority,
      why:
        r.reasons
          .filter(x => x !== r.task.priority)
          .map(x => sanitizeField(x))
          .join(' · ') || NONE,
      title: sanitizeField(r.task.title),
    })),
    ['why'],
    tableOpts
  )
  lines.push(table)

  // LUM-1232 H-2: advice only — `--no-hints` / LUMO_NO_HINTS drops it.
  if (!hints) return lines.join('\n')

  lines.push('')
  // LUM-686: was a hand-written string here — the original drift source this
  // feature exists to remove. Same advice, now through the shared renderer.
  lines.push(
    formatNextSteps([
      {
        command: `lumo session attach ${first.identifier} && lumo task show ${first.identifier} --full`,
        why: 'start on the top-ranked task',
      },
    ])
  )
  if (ranked.length > 1) {
    lines.push(hint('any other task in the list works the same way.'))
  }

  return lines.join('\n')
}
