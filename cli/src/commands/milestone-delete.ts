import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'

export interface DeleteMilestoneOptions {
  project?: string
  yes?: boolean
}

export function formatDeleteRefusal(name: string, taskCount: number): string {
  const head = `Refusing to delete milestone "${name}" without --yes.`
  const tail = `Re-run with --yes to confirm.`
  if (taskCount === 0) return `${head}\n${tail}`
  return `${head}\n${taskCount} tasks under it will keep their data; only milestoneId is cleared.\n${tail}`
}

interface TaskCounts {
  TODO: number
  IN_PROGRESS: number
  IN_REVIEW: number
  DONE: number
}

function totalTasks(counts: TaskCounts): number {
  return counts.TODO + counts.IN_PROGRESS + counts.IN_REVIEW + counts.DONE
}

export async function milestoneDelete(
  identifier: string,
  opts: DeleteMilestoneOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let milestoneId: string
  let resolvedName: string
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
    milestoneId = resolved.id
    resolvedName = resolved.name
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Always fetch the milestone first — we need name + taskCounts for the
  // refusal message, and the same data confirms the milestone exists.
  let showRes: Response
  try {
    showRes = await fetch(`${base}/api/milestones/${milestoneId}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }
  if (showRes.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!showRes.ok) {
    console.error(`Error: milestone fetch failed (HTTP ${showRes.status})`)
    return 1
  }
  const { milestone } = (await showRes.json()) as {
    milestone: { name: string; taskCounts: TaskCounts }
  }
  const name = resolvedName || milestone.name
  const total = totalTasks(milestone.taskCounts)

  if (!opts.yes) {
    console.error(formatDeleteRefusal(name, total))
    return 1
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/milestones/${milestoneId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${creds.token}` },
    })
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
    let errMsg = `milestone delete failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (errBody.error) errMsg = errBody.error
    } catch {
      // body wasn't JSON
    }
    console.error(`Error: ${errMsg}`)
    return 1
  }
  process.stdout.write(`Deleted milestone "${name}"\n`)
}
