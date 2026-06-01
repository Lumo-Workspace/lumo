import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'

export interface DeleteSprintOptions {
  team?: string
  yes?: boolean
}

export function formatDeleteRefusal(
  number: number,
  name: string,
  taskCount: number
): string {
  const head = `Refusing to delete sprint #${number} "${sanitizeField(name)}" without --yes.`
  const tail = `Re-run with --yes to confirm.`
  if (taskCount === 0) return `${head}\n${tail}`
  return `${head}\n${taskCount} tasks under it will keep their data; only sprintId is cleared.\n${tail}`
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
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
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

  if (!opts.yes) {
    console.error(formatDeleteRefusal(sprint.number, sprint.name, progress.total))
    return 1
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
    console.error(`Error: ${errMsg}`)
    return 1
  }
  process.stdout.write(
    `Deleted sprint #${sprint.number} "${sanitizeField(sprint.name)}"\n`
  )
}
