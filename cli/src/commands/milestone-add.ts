import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import {
  dedupeTaskRefs,
  formatBatchSummary,
  type BatchOutcome,
} from '../lib/milestone-batch'
import { errNotLoggedIn, httpFailed } from '../lib/errors'

export interface MilestoneAddOptions {
  project?: string
}

/**
 * Look up the milestone's canonical name. `resolveMilestoneId` already
 * returns the name when the identifier is a name; for a UUID it returns an
 * empty name, so we GET the milestone to fill it in.
 */
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
    throw new Error(`milestone ${id} not found (HTTP ${res.status})`)
  }
  const { milestone } = (await res.json()) as { milestone: { name: string } }
  return milestone.name
}

export async function milestoneAdd(
  identifier: string,
  tasks: string[],
  opts: MilestoneAddOptions
): Promise<number | void> {
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

  let milestoneName: string
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
    milestoneName = await resolveMilestoneName(
      base,
      creds.token,
      resolved.id,
      resolved.name
    )
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const outcomes: BatchOutcome[] = []
  for (const ref of refs) {
    try {
      const res = await fetch(
        `${base}/api/tasks/by-identifier/${encodeURIComponent(ref)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${creds.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ milestoneRef: milestoneName }),
        }
      )
      if (res.ok) {
        outcomes.push({ task: ref, status: 'ok' })
      } else {
        let msg = httpFailed('add', res.status)
        try {
          const body = (await res.json()) as { error?: string }
          if (body.error) msg = body.error
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

  process.stdout.write(
    formatBatchSummary({ milestoneName, verb: 'added', outcomes }) + '\n'
  )
  return outcomes.some(o => o.status === 'fail') ? 1 : undefined
}
