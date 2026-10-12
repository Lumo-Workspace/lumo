import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import {
  dedupeTaskRefs,
  partitionMembership,
  formatBatchSummary,
  type BatchOutcome,
} from '../lib/milestone-batch'
import { resolveSessionId } from '../lib/session-id'
import { errNotLoggedIn, httpFailed } from '../lib/errors'

export interface MilestoneTriageOptions {
  project?: string
  /** `--claimable` marks true; `--not-claimable` marks false. One is required. */
  claimable?: boolean
  notClaimable?: boolean
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

/**
 * `lumo milestone triage <milestone> <task...> --claimable|--not-claimable` —
 * the steward's batch agent-claimable annotation (LUM-646, F4/自治边界).
 *
 * Mirrors `milestone add/remove`: dedupe refs, partition against the
 * milestone's task set, PATCH each in-milestone task with the chosen claimable
 * direction, and skip anything not in the milestone (triage is milestone-
 * scoped). Best-effort — partial failures don't roll back. Setting the marker
 * is a governance action, so a STEWARD session passes the server-side binding
 * guard (task update is `allow-governance`).
 */
export async function milestoneTriage(
  identifier: string,
  tasks: string[],
  opts: MilestoneTriageOptions
): Promise<number | void> {
  // Exactly one direction must be chosen.
  if (opts.claimable && opts.notClaimable) {
    console.error(
      'Error: --claimable and --not-claimable are mutually exclusive.'
    )
    return 1
  }
  if (!opts.claimable && !opts.notClaimable) {
    console.error(
      'Error: choose a direction — pass --claimable or --not-claimable.'
    )
    return 1
  }
  const claimable = Boolean(opts.claimable)

  const refs = dedupeTaskRefs(tasks)
  if (refs.length === 0) {
    console.error('Error: provide at least one task (e.g. `LUM-1 LUM-2`).')
    return 1
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

  const sessionId = await resolveSessionId({ write: true })
  const outcomes: BatchOutcome[] = []
  for (const ref of present) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      }
      if (sessionId) headers['X-Lumo-Session-Id'] = sessionId
      const res = await fetch(
        `${base}/api/tasks/by-identifier/${encodeURIComponent(ref)}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ claimable }),
        }
      )
      if (res.ok) {
        outcomes.push({ task: ref, status: 'ok' })
      } else {
        let msg = httpFailed('triage', res.status)
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
    formatBatchSummary({
      milestoneName,
      verb: claimable ? 'marked claimable' : 'marked not-claimable',
      outcomes,
    }) + '\n'
  )
  return outcomes.some(o => o.status === 'fail') ? 1 : undefined
}
