import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'

export interface DeleteSprintOptions extends ConfirmFlags {
  team?: string
}

/** The changes[] block for the confirmation envelope (LUM-755). */
export function describeSprintDelete(
  number: number,
  name: string,
  taskCount: number
): string[] {
  const lines = [`Will delete sprint #${number} "${sanitizeField(name)}"`]
  if (taskCount > 0)
    lines.push(
      `${taskCount} tasks under it keep their data; only sprintId is cleared`
    )
  return lines
}

export async function sprintDelete(
  identifier: string,
  opts: DeleteSprintOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
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

  // Fetch sprint + progress for the refusal message (and to confirm it exists).
  let showRes: Response
  try {
    showRes = await fetch(`${base}/api/sprints/${resolved.id}`, {
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
    console.error(`Error: sprint fetch failed (HTTP ${showRes.status})`)
    return 1
  }
  const { sprint, progress } = (await showRes.json()) as {
    sprint: { number: number; name: string }
    progress: { total: number }
  }

  if (!isConfirmed(opts)) {
    return emitConfirmation({
      command: 'sprint delete',
      changes: describeSprintDelete(sprint.number, sprint.name, progress.total),
    })
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/sprints/${resolved.id}`, {
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
    let errMsg = `sprint delete failed (HTTP ${res.status})`
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
    `Deleted sprint #${sprint.number} "${sanitizeField(sprint.name)}"\n`
  )
}
