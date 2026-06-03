import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'

export interface MilestoneArchiveOptions {
  project?: string
}

export function formatArchiveResult(name: string): string {
  return `Archived "${sanitizeField(name)}"`
}

export async function milestoneArchive(
  identifier: string,
  opts: MilestoneArchiveOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    res = await fetch(`${base}/api/milestones/${milestoneId}/archive`, {
      method: 'POST',
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
    let errMsg = `milestone archive failed (HTTP ${res.status})`
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
  process.stdout.write(formatArchiveResult(milestone.name) + '\n')
}
