import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errNotLoggedIn, httpFailed } from '../lib/errors'

export interface MilestoneUnarchiveOptions {
  project?: string
}

export function formatUnarchiveResult(name: string): string {
  return `Unarchived "${sanitizeField(name)}"`
}

export async function milestoneUnarchive(
  identifier: string,
  opts: MilestoneUnarchiveOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let milestoneId: string
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
    milestoneId = resolved.id
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/milestones/${milestoneId}/unarchive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}` },
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
    let errMsg = httpFailed('milestone unarchive', res.status)
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) errMsg = body.error
    } catch {
      // non-JSON body; keep the status-only message
    }
    console.error(`Error: ${sanitizeField(errMsg)}`)
    return 1
  }

  const { milestone } = (await res.json()) as { milestone: { name: string } }
  process.stdout.write(formatUnarchiveResult(milestone.name) + '\n')
}
