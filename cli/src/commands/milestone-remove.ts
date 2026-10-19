import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import {
  dedupeTaskRefs,
  partitionMembership,
  formatBatchSummary,
  type BatchOutcome,
} from '../lib/milestone-batch'
import { errNotLoggedIn, httpFailed } from '../lib/errors'

export interface MilestoneRemoveOptions {
  project?: string
}

interface MilestoneTaskRow {
  id: string
  number: number
  teamIdentifier: string
}

/** GET the milestone's canonical name; needed only when a UUID was passed. */
async function resolveMilestoneName(
  base: string,
  token: string,
  id: string,
  knownName: string
): Promise<string> {
  if (knownName) return knownName
  const res = await fetch(`${base}/api/milestones/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `milestone ${id} not found`
        : httpFailed(`milestone ${id} lookup`, res.status)
    )
  }
  const { milestone } = (await res.json()) as { milestone: { name: string } }
  return milestone.name
}

export async function milestoneRemove(
  identifier: string,
  tasks: string[],
  opts: MilestoneRemoveOptions
): Promise<number | void> {
  const refs = dedupeTaskRefs(tasks)
  if (refs.length === 0) {
    console.error('Error: provide at least one task (e.g. `LUM-1 LUM-2`).')
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let milestoneId: string
  let milestoneName: string
  let milestoneTasks: MilestoneTaskRow[]
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
    milestoneId = resolved.id
    milestoneName = await resolveMilestoneName(
      base,
      creds.token,
      resolved.id,
      resolved.name
    )
    const tasksRes = await fetch(
      `${base}/api/milestones/${milestoneId}/tasks`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
    if (!tasksRes.ok) {
      throw new Error(httpFailed('milestone tasks fetch', tasksRes.status))
    }
    const body = (await tasksRes.json()) as { tasks: MilestoneTaskRow[] }
    milestoneTasks = body.tasks
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const { present, absent } = partitionMembership(refs, milestoneTasks)

  const outcomes: BatchOutcome[] = []
  for (const ref of present) {
    try {
      const res = await fetch(
        `${base}/api/tasks/by-identifier/${encodeURIComponent(ref)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${creds.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ milestoneRef: null }),
        }
      )
      if (res.ok) {
        outcomes.push({ task: ref, status: 'ok' })
      } else {
        let msg = httpFailed('remove', res.status)
        try {
          const errBody = (await res.json()) as { error?: string }
          if (errBody.error) msg = errBody.error
        } catch {
          // non-JSON body; keep the status-only message
        }
        outcomes.push({ task: ref, status: 'fail', detail: msg })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      outcomes.push({ task: ref, status: 'fail', detail: msg })
    }
  }
  for (const ref of absent) {
    outcomes.push({
      task: ref,
      status: 'skip',
      detail: 'not in this milestone',
    })
  }

  process.stdout.write(
    formatBatchSummary({ milestoneName, verb: 'removed', outcomes }) + '\n'
  )
  return outcomes.some(o => o.status === 'fail') ? 1 : undefined
}
